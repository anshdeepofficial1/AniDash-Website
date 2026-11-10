import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL("../" + name, import.meta.url), "utf8");
const vercel = JSON.parse(read("vercel.json"));
const manifest = JSON.parse(read("manifest.webmanifest"));
const index = read("index.html");
const app = read("app.js");
const sw = read("sw.js");
const anilist = read("anilist-account.js");
const mal = read("mal-account.js");

function pathMatchesRule(path, source) {
  const pattern = "^" + source.split("/").map(segment =>
    segment.startsWith(":") ? "[^/]+" : segment
  ).join("/") + "$";
  return new RegExp(pattern).test(path);
}

test("every public SPA route has a Vercel rewrite without intercepting APIs or assets", () => {
  assert.equal(vercel.cleanUrls, true);
  const routes = [
    "/home", "/discover", "/library", "/history", "/account", "/news",
    "/notifications", "/settings", "/manga", "/manga-library", "/search",
    "/downloads", "/anime/21", "/watch/21", "/watch/21/390",
    "/section/trending", "/manga-section/popular", "/manga-detail/2"
  ];
  for (const path of routes) {
    assert.ok(vercel.rewrites.some(rule =>
      rule.destination === "/" && pathMatchesRule(path, rule.source)
    ), "No app-shell rewrite for " + path);
  }
  for (const path of ["/api/catalog", "/api/news", "/icons/anidash-icon.png", "/styles.css", "/sw.js"]) {
    assert.equal(vercel.rewrites.some(rule => pathMatchesRule(path, rule.source)), false,
      "A rewrite would intercept " + path);
  }
});
test("no visible application link or app shortcut contains hash routing", () => {
  assert.doesNotMatch(index, /href="#\//);
  assert.equal(manifest.start_url, "/home");
  for (const shortcut of manifest.shortcuts) {
    assert.doesNotMatch(shortcut.url, /#\//);
    assert.ok(shortcut.url.startsWith("/"));
  }
});
test("History API navigation supports legacy bookmarks and direct reloads", () => {
  assert.match(app, /addEventListener\("popstate", onRouteChange\)/);
  assert.match(app, /history\[replace \? "replaceState" : "pushState"\]/);
  assert.match(app, /migrateLegacyHashRoute\(\)/);
  assert.doesNotMatch(app, /location\.hash\s*=\s*"#\//);
  assert.match(sw, /request\.mode === "navigate"/);
  assert.match(sw, /caches\.match\("\/index\.html"\)/);
});
test("OAuth callbacks clear access-token fragments while retaining root redirect registration", () => {
  assert.match(anilist, /history\.replaceState\(null, "", "\/account"\)/);
  assert.match(mal, /history\.replaceState\(null, "", "\/account"\)/);
  assert.match(mal, /redirect_uri: redirect/);
});
