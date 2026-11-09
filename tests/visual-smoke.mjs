// Headless browser smoke test. All catalogue fixtures are test-only;
// the production website always calls AniList and real built-in providers.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const artifacts = path.join(root, "test-artifacts");
const anime = {
  id: 21, idMal: 21,
  title: { english: "ONE PIECE", romaji: "One Piece", native: "ワンピース" },
  coverImage: { extraLarge: "https://example.com/cover.jpg", large: "https://example.com/cover.jpg" },
  bannerImage: "https://example.com/banner.jpg",
  episodes: 12, duration: 24, averageScore: 88, format: "TV", status: "RELEASING",
  genres: ["Action", "Adventure"], season: "FALL", seasonYear: 2026,
  startDate: { year: 1999, month: 10, day: 20 },
  description: "Follow a grand adventure across the seas.",
  studios: { nodes: [{ name: "Toei Animation" }] },
  relations: { edges: [] }
};
const collection = Array.from({ length: 14 }, (_, i) => ({
  ...anime,
  id: i + 21,
  title: { english: i === 0 ? "ONE PIECE" : "Anime " + (i + 1), romaji: "Anime " + (i + 1) }
}));
const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#63b69e"/><stop offset="1" stop-color="#255c47"/></linearGradient></defs><rect width="640" height="800" fill="url(#g)"/><circle cx="475" cy="222" r="180" fill="#d0ece0" opacity=".35"/><circle cx="100" cy="690" r="280" fill="#153c31" opacity=".4"/></svg>';

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname.startsWith("/api/")) {
      const url = new URL(req.url, "http://localhost");
      const action = url.searchParams.get("action");
      const payload = action === "search" ? { results: [] }
        : action === "episodes" ? { episodes: Array.from({ length: 12 }, (_, i) => ({ number: i + 1, id: String(i + 1) })) }
        : action === "streams" ? { sources: [{ url: "https://example.com/test-video.mp4", type: "mp4", isDub: true, quality: "Auto" }] }
        : { episodes: [] };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    const name = pathname === "/" ? "/index.html" : pathname;
    const absolute = path.resolve(root, "." + name);
    if (!absolute.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const mime = name.endsWith(".html") ? "text/html" : name.endsWith(".js") ? "text/javascript" :
      name.endsWith(".css") ? "text/css" : name.endsWith(".png") ? "image/png" :
      name.endsWith(".webmanifest") ? "application/manifest+json" : "text/plain";
    res.writeHead(200, { "Content-Type": mime });
    res.end(await readFile(absolute));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

await mkdir(artifacts, { recursive: true });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true });
const errors = [];

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", err => errors.push(err.message));
  await context.route("https://graphql.anilist.co/**", async route => {
    const body = route.request().postDataJSON?.() || {};
    const single = typeof body.query === "string" && body.query.includes("Media(id:");
    const data = single ? { Media: anime } : { Page: { media: collection, pageInfo: { hasNextPage: false } } };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ data })
    });
  });
  await context.route("https://example.com/**", route =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: imageSvg })
  );
  await page.goto(address + "/#/home", { waitUntil: "domcontentloaded" });
  await page.locator(".home-hero").waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(artifacts, "mobile-home.png") });

  const dock = await page.locator(".mobile-dock").boundingBox();
  assert.ok(dock && dock.x >= 0 && dock.x + dock.width <= 391, "Floating dock must fit mobile viewport");
  await page.locator(".home-hero [data-anime]").first().click();
  await page.locator('#episode-list [data-play-episode="1|1"]').waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(artifacts, "mobile-anime-details.png") });

  await page.locator('#episode-list [data-play-episode="1|1"]').click();
  await page.locator("#anime-video").waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(artifacts, "mobile-player.png") });
  await page.locator('[data-category="sub"]').click();
  assert.equal(await page.locator('[data-category="sub"]').getAttribute("class").then(x => x.includes("active")), true);

  const desktop = await context.newPage();
  await desktop.setViewportSize({ width: 1440, height: 900 });
  desktop.on("pageerror", err => errors.push(err.message));
  await desktop.goto(address + "/#/home", { waitUntil: "domcontentloaded" });
  await desktop.locator(".home-hero").waitFor({ timeout: 15000 });
  await desktop.screenshot({ path: path.join(artifacts, "desktop-home.png") });
  const dims = await desktop.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  assert.ok(dims.documentWidth <= dims.viewportWidth + 1, "Desktop must not scroll horizontally");

  assert.deepEqual(errors, [], "No uncaught browser page errors");
  console.log("Visual checks passed. Screenshots: " + artifacts);
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
