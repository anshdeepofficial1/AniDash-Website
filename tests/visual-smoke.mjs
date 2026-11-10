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

let homeApiCalls = 0;
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname.startsWith("/api/")) {
      const url = new URL(req.url, "http://localhost");
      const action = url.searchParams.get("action");
      if (pathname === "/api/catalog") {
        const view = url.searchParams.get("view") || "home";
        if (view === "home") homeApiCalls += 1;
        const results = view === "search"
          ? { media: collection.filter(item => (item.title?.english || "").toLowerCase()
              .includes(String(url.searchParams.get("q") || "").toLowerCase())) }
          : { sections: {
              trending:collection, popular:collection, top:collection, airing:collection,
              upcoming:collection.slice(0,4), movies:collection.slice(0,5), hidden:collection.slice(0,4)
            } };
        res.writeHead(200, {"Content-Type":"application/json","Cache-Control":"no-store"});
        res.end(JSON.stringify(results));
        return;
      }
      const payload = pathname === "/api/news" ? { items: [{
          title: "Anime industry updates",
          url: "https://www.animenewsnetwork.com/",
          date: "2026-11-10T08:00:00Z", imageUrl: "", excerpt: "Test-only news fixture"
        }] }
        : action === "search" ? { results: [] }
        : action === "episodes" ? { episodes: Array.from({ length: 12 }, (_, i) => ({ number: i + 1, id: String(i + 1) })) }
        : action === "streams" ? { sources: [{ url: "https://example.com/test-video.mp4", type: "mp4", isDub: true, quality: "Auto" }] }
        : { episodes: [] };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    // Emulate Vercel SPA rewrites so a hard reload on /anime/21, /watch/21/2,
    // or any other clean route is tested as a real document request.
    const staticRoutes = /^\/(?:home|discover|library|history|account|news|notifications|settings|manga|manga-library|search|downloads)\/?$/;
    const dynamicRoutes = /^\/(?:anime|watch|section|manga-section|manga-detail)\/[^/.]+(?:\/[^/.]+)?\/?$/;
    const name = pathname === "/" || staticRoutes.test(pathname) || dynamicRoutes.test(pathname)
      ? "/index.html" : pathname;
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
  await page.goto(address + "/home", { waitUntil: "domcontentloaded" });
  try {
    await page.locator(".home-hero").waitFor({ timeout: 15000 });
  } catch (error) {
    console.error("Homepage diagnostic", JSON.stringify({
      errors,
      viewText: await page.locator("#view").innerText().catch(() => "view missing"),
      route: await page.evaluate(() => location.hash)
    }));
    throw error;
  }
  assert.equal(await page.locator(".native-home-header").count(), 1, "Native-profile header must exist");
  assert.equal(await page.locator("#home-news-panel").count(), 0, "Home news shelf must be removed");
  assert.equal(await page.locator('.native-home-header [data-route="/news"]').count(), 1,
    "News must remain in the top header");
  assert.equal(await page.locator('.mobile-dock [data-route="/downloads"]').count(), 0,
    "Downloads tab must not exist");
  assert.equal(await page.locator('.mobile-dock [data-route="/search"]').count(), 0,
    "Search is unified into Discover");
  await page.screenshot({ path: path.join(artifacts, "mobile-home.png") });
  assert.equal(await page.locator("#spotlight-count").textContent(), "1 / 10");
  await page.locator('[data-spotlight-next]').click();
  await page.waitForTimeout(100);
  console.log("Spotlight diagnostic:", await page.evaluate(() => ({
    current: document.querySelector("#spotlight-count")?.textContent,
    pathname: location.hash, matches: document.querySelectorAll("[data-spotlight-next]").length,
    visibleHero: document.querySelector("#spotlight-content")?.textContent?.slice(0,70)
  })), "Page errors:", errors);
  await page.waitForFunction(() => document.querySelector("#spotlight-count")?.textContent === "2 / 10",
    null, { timeout: 2500 });
  await page.screenshot({ path: path.join(artifacts, "mobile-spotlight-next.png") });
  assert.equal(await page.locator('[data-route="/section/trending"]').count(), 1);
  await page.locator('[data-route="/section/trending"]').first().click();
  await page.locator(".section-rank-item").first().waitFor({ timeout: 15000 });
  assert.match(await page.locator(".page-title").textContent(), /Trending Right Now/);
  await page.screenshot({ path: path.join(artifacts, "mobile-trending-ranked.png") });
  await page.goto(address + "/manga", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading",{name:"Manga"}).first().waitFor({timeout:15000});
  await page.locator('[data-manga]').first().waitFor({timeout:15000});
  await page.screenshot({ path: path.join(artifacts, "mobile-manga.png") });

  // Offline CBZ data remains durable, even though its Downloads screen is gone.
  const testCBZ = "UEsDBBQAAAAIAGU/aV07Lb2aPwAAAEYAAAAHAAAAMDAxLnBuZ+sM8HPn5ZLiYmBg4PX0cAkC0owgzMEGJOVFj3SCJVwcQzhkk3+cP/BBnoG1gcne89D/K0AJBk9XP5d1TglNAFBLAQIUAxQAAAAIAGU/aV07Lb2aPwAAAEYAAAAHAAAAAAAAAAAAAACAAQAAAAAwMDEucG5nUEsFBgAAAAABAAEANQAAAGQAAAAAAA==";
  await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const file = new File([bytes], "verified-offline.cbz", { type: "application/zip" });
    await window.AniDashStorage.saveMangaFile(file);
  }, testCBZ);
  await page.reload({ waitUntil: "domcontentloaded" });
  const restored = await page.evaluate(async () => {
    const files = await window.AniDashStorage.listMangaFiles();
    const blob = await window.AniDashStorage.getMangaFile(files[0].id);
    return { count: files.length, name: files[0].name, bytes: blob.size };
  });
  assert.equal(restored.count, 1);
  assert.equal(restored.name, "verified-offline.cbz");
  assert.ok(restored.bytes > 100);
  await page.goto(address + "/downloads", { waitUntil:"domcontentloaded" });
  await page.waitForURL("**/library", { timeout: 10000 });
  assert.equal(await page.locator(".download-details").count(), 0,
    "Old Downloads deep link should land in Library");

  await page.goto(address + "/home", { waitUntil: "domcontentloaded" });
  await page.locator(".home-hero").waitFor({ timeout: 15000 });
  // Save a guest watchlist entry, reload and verify durable browser storage.
  assert.equal(await page.locator('.sidebar-promo').count(), 0, "Provider promo should not appear in sidebar");
  assert.equal(await page.locator('.mobile-dock [data-route="/history"]').count(), 0, "Continue Watching nav is removed");
  const initialHomeCalls = homeApiCalls;
  await page.goto(address + "/notifications", { waitUntil: "domcontentloaded" });
  await page.locator('button[data-route="/home"]').first().click();
  await page.locator(".home-hero").waitFor({ timeout: 15000 });
  assert.equal(homeApiCalls, initialHomeCalls,
    "Returning from Notifications to Home must use saved catalogue");
  await page.locator('.home-hero [data-watchlist]').first().click();
  await page.goto(address + "/library", { waitUntil: "domcontentloaded" });
  await page.locator('[data-library-tab="PLANNING"]').click();
  await page.locator('.anime-card[data-anime="21"]').waitFor({ timeout: 15000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-library-tab="PLANNING"]').click();
  await page.locator('.anime-card[data-anime="21"]').waitFor({ timeout: 15000 });
  assert.ok((await page.evaluate(() => localStorage.getItem("anidash.watch.web.v1")) || "").includes("21"));
  await page.goto(address + "/account", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Your AniDash Account" }).waitFor({ timeout: 15000 });
  await page.getByText("Continue with MyAnimeList").waitFor({ timeout: 15000 });
  assert.equal(await page.locator('input[type="password"]').count(), 0, "No provider password field");
  await page.goto(address + "/settings", { waitUntil: "domcontentloaded" });
  await page.locator(".settings-screen [data-install]").click();
  await page.locator(".modal-backdrop").waitFor({ timeout: 4000 });
  await page.locator(".modal-card .close-modal").click();
  assert.equal(await page.locator(".modal-backdrop").count(), 0, "X must close install guide");
  await page.locator(".settings-screen [data-install]").click();
  await page.locator(".modal-actions [data-close]").click();
  assert.equal(await page.locator(".modal-backdrop").count(), 0, "Got it must close install guide");
  await page.locator('[data-setting="showMangaTab"]').check();
  assert.equal(await page.locator('.mobile-dock [data-optional-manga]').isVisible(), true,
    "Optional Manga nav must respond to setting");
  await page.locator('[data-setting="showMangaTab"]').uncheck();
  assert.equal(await page.locator('.mobile-dock [data-optional-manga]').isVisible(), false,
    "Disabled Manga nav must be hidden");
  await page.locator('[data-setting="preferredAudio"]').selectOption("sub");
  await page.locator('[data-setting="themeMode"]').selectOption("dark");
  assert.equal(await page.locator('body').getAttribute("data-theme"), "dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-setting="preferredAudio"]').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('[data-setting="preferredAudio"]').inputValue(), "sub");
  assert.equal(await page.locator('body').getAttribute("data-theme"), "dark");
  await page.locator('[data-setting="themeMode"]').selectOption("light");
  await page.goto(address + "/home", { waitUntil: "domcontentloaded" });
  await page.locator(".home-hero").waitFor({ timeout: 15000 });

  const dock = await page.locator(".mobile-dock").boundingBox();
  assert.ok(dock && dock.x >= 0 && dock.x + dock.width <= 391, "Floating dock must fit mobile viewport");
  await page.locator(".home-hero [data-anime]").first().click();
  await page.locator('#episode-list [data-play-episode="1|1"]').waitFor({ timeout: 15000 });
  assert.equal(await page.locator("#episode-view-mode").inputValue(), "grid",
    "Grid must be the default episode layout");
  assert.equal(await page.locator("#episode-group-mode").inputValue(), "arcs",
    "Verified One Piece episode groups must default to story arcs");
  assert.ok((await page.locator(".episode-arc-chip").allTextContents()).some(x => x.includes("East Blue")));
  await page.locator("#episode-view-mode").selectOption("list");
  assert.equal(await page.locator("body").getAttribute("data-episode-layout"), "list");
  await page.locator("#episode-view-mode").selectOption("grid");
  await page.screenshot({ path: path.join(artifacts, "mobile-anime-details.png") });

  await page.locator('#episode-list [data-play-episode="1|1"]').click();
  await page.locator("#anime-video").waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(artifacts, "mobile-player.png") });
  await page.locator('[data-category="sub"]').click();
  assert.equal(await page.locator('[data-category="sub"]').getAttribute("class").then(x => x.includes("active")), true);

  const desktop = await context.newPage();
  await desktop.setViewportSize({ width: 1440, height: 900 });
  desktop.on("pageerror", err => errors.push(err.message));
  await desktop.goto(address + "/home", { waitUntil: "domcontentloaded" });
  await desktop.locator(".home-hero").waitFor({ timeout: 15000 });
  const firstHeight = (await desktop.locator(".spotlight-shell").boundingBox()).height;
  await desktop.locator("[data-spotlight-next]").click();
  const secondHeight = (await desktop.locator(".spotlight-shell").boundingBox()).height;
  assert.ok(await desktop.locator(".spotlight-layer").count() >= 2,
    "Carousel should crossfade between two real slide layers");
  assert.ok(Math.abs(firstHeight - secondHeight) < 1, "Desktop carousel must not resize on slide change");
  await desktop.screenshot({ path: path.join(artifacts, "desktop-home.png") });
  const dims = await desktop.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  assert.ok(dims.documentWidth <= dims.viewportWidth + 1, "Desktop must not scroll horizontally");

  const tablet = await context.newPage();
  await tablet.setViewportSize({ width: 820, height: 1180 });
  tablet.on("pageerror", err => errors.push(err.message));
  await tablet.goto(address + "/home", { waitUntil:"domcontentloaded" });
  await tablet.locator(".home-hero").waitFor({ timeout:15000 });
  const tabletDock = await tablet.locator(".mobile-dock").boundingBox();
  assert.ok(tabletDock && tabletDock.x >= 0 && tabletDock.x + tabletDock.width <= 820,
    "iPad-size viewport must have an on-screen app dock");
  await tablet.screenshot({path: path.join(artifacts, "tablet-home.png")});
  // Regression: when both the shared cache endpoint and direct AniList are
  // rate-limited, Home and Discover must retain functional same-route retry.
  const rateContext = await browser.newContext({ viewport:{ width:390, height:844 } });
  const ratePage = await rateContext.newPage();
  ratePage.on("pageerror", error => errors.push(error.message));
  await rateContext.route("**/api/catalog?**", route => route.fulfill({
    status:503, contentType:"application/json",
    body:JSON.stringify({ error:"AniList is busy. Try again shortly.", retryAfter:30 })
  }));
  await rateContext.route("https://graphql.anilist.co/**", route => route.fulfill({
    status:429, contentType:"application/json",
    headers:{"access-control-allow-origin":"*","retry-after":"30"},
    body:JSON.stringify({ errors:[{message:"Too many requests"}] })
  }));
  await ratePage.goto(address + "/home", { waitUntil:"domcontentloaded" });
  await ratePage.locator("[data-retry-home]").waitFor({timeout:15000});
  await ratePage.locator("[data-retry-home]").click();
  await ratePage.locator("[data-retry-home]").waitFor({timeout:15000});
  assert.equal(await ratePage.locator(".native-home-header").count(), 1,
    "Rate-limited Home should remain navigable and retryable");
  await ratePage.goto(address + "/discover", { waitUntil:"domcontentloaded" });
  await ratePage.locator("[data-retry-discover]").waitFor({timeout:15000});
  await ratePage.locator("[data-retry-discover]").click();
  await ratePage.locator("[data-retry-discover]").waitFor({timeout:15000});
  assert.equal(await ratePage.locator("#search-page-input").count(), 1,
    "Rate-limited Discover retains its integrated search input");
  await rateContext.close();
  // Clean paths are independently reloadable and compatible with Back/Forward.
  const navPage = await context.newPage();
  navPage.on("pageerror", error => errors.push(error.message));
  await navPage.goto(address + "/home", { waitUntil: "domcontentloaded" });
  await navPage.locator(".home-hero").waitFor({ timeout: 15000 });
  assert.equal(new URL(navPage.url()).hash, "");
  await navPage.locator('.mobile-dock [data-route="/discover"]').click();
  await navPage.waitForURL("**/discover", { timeout: 8000 });
  await navPage.locator("#search-page-input").waitFor({timeout:8000});
  await navPage.locator('.mobile-dock [data-route="/library"]').click();
  await navPage.waitForURL("**/library", { timeout: 8000 });
  await navPage.goBack();
  await navPage.waitForURL("**/discover", { timeout: 8000 });
  await navPage.locator("#search-page-input").waitFor({timeout:8000});
  await navPage.goBack();
  await navPage.waitForURL("**/home", { timeout:8000 });
  await navPage.locator(".home-hero").waitFor({timeout:8000});
  await navPage.goForward();
  await navPage.waitForURL("**/discover", {timeout:8000});
  assert.equal(new URL(navPage.url()).hash, "");
  await navPage.goto(address + "/anime/21", { waitUntil:"domcontentloaded" });
  await navPage.locator("#episode-list .episode-item").first().waitFor({timeout:15000});
  await navPage.reload({waitUntil:"domcontentloaded"});
  await navPage.locator("#episode-list .episode-item").first().waitFor({timeout:15000});
  assert.equal(new URL(navPage.url()).pathname, "/anime/21");
  await navPage.goto(address + "/watch/21/2", {waitUntil:"domcontentloaded"});
  await navPage.locator("#anime-video").waitFor({timeout:15000});
  assert.equal(new URL(navPage.url()).hash, "");
  await navPage.goto(address + "/discover?q=ONE%20PIECE", {waitUntil:"domcontentloaded"});
  await navPage.locator("#discover-results .anime-card").first().waitFor({timeout:15000});
  assert.equal(new URL(navPage.url()).pathname, "/discover");
  // Existing saved #/anime/21 links are rewritten client-side without
  // creating a second history entry or showing the hash to the user.
  await navPage.goto(address + "/#/anime/21", {waitUntil:"domcontentloaded"});
  await navPage.waitForURL("**/anime/21", {timeout:10000});
  await navPage.locator("#episode-list .episode-item").first().waitFor({timeout:15000});
  assert.equal(new URL(navPage.url()).hash, "");
  await navPage.goto(address + "/search?q=ONE%20PIECE", {waitUntil:"domcontentloaded"});
  await navPage.waitForURL("**/discover?q=ONE%20PIECE", {timeout:10000});
  await navPage.goto(address + "/downloads", {waitUntil:"domcontentloaded"});
  await navPage.waitForURL("**/library", {timeout:10000});
  await navPage.close();
  assert.deepEqual(errors, [], "No uncaught browser page errors");
  console.log("Visual checks passed. Screenshots: " + artifacts);
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
