import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const media = {
  id: 21, idMal: 21,
  title: { english: "Sample Anime", romaji: "Sample Anime" },
  coverImage: { extraLarge: "https://example.com/cover.jpg" },
  bannerImage: "https://example.com/banner.jpg",
  genres: ["Adventure"], format: "TV", status: "FINISHED",
  episodes: 12, averageScore: 88, seasonYear: 2024,
  studios: { nodes: [{ name: "Demo Studio" }] },
  relations: { edges: [] },
  description: "A sample anime used to verify AniDash page behavior."
};

function createBrowser(initialHash) {
  const elements = new Map();
  const listeners = new Map();
  const urls = [];
  const getElement = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        innerHTML: "", value: "", style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        focus() {}, addEventListener() {}, getAttribute() { return null; }
      });
    }
    return elements.get(selector);
  };
  const document = {
    body: { dataset: {} },
    querySelector: selector => getElement(selector),
    querySelectorAll: () => [],
    createElement: () => ({
      className: "", textContent: "", style: {}, remove() {},
      setAttribute() {}, appendChild() {}
    }),
    addEventListener: (name, handler) => listeners.set(name, handler)
  };
  const window = {
    setTimeout, clearTimeout,
    addEventListener: (name, handler) => listeners.set(name, handler)
  };
  const location = {
    hash: initialHash.startsWith("#") ? initialHash : "",
    pathname: initialHash.startsWith("#") ? "/" : initialHash,
    search: "", protocol: "http:", origin: "http://localhost"
  };
  const updateLocation = path => {
    const next = new URL(path, location.origin);
    location.pathname = next.pathname;
    location.search = next.search;
    location.hash = next.hash;
  };
  const history = {
    pushState(_state, _unused, path) { updateLocation(path); },
    replaceState(_state, _unused, path) { updateLocation(path); }
  };
  const localData = new Map();
  const localStorage = {
    getItem: key => localData.get(key) || null,
    setItem: (key, value) => localData.set(key, String(value))
  };
  const fetch = input => {
    const url = String(input);
    urls.push(url);
    if (url === "https://graphql.anilist.co") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { Media: media } })
      });
    }
    // Simulate unresponsive upstream providers. Rendering must not await these.
    return new Promise(() => {});
  };
  const context = {
    document, window, location, history, localStorage, fetch,
    URL, URLSearchParams, AbortController,
    setTimeout, clearTimeout,
    navigator: { userAgent: "Node test" },
    confirm: () => false,
    console
  };
  vm.runInNewContext(readFileSync(new URL("../seanime-ui.js", import.meta.url), "utf8"), context, { filename: "seanime-ui.js" });
  vm.runInNewContext(source, context, { filename: "app.js" });
  return { elements, listeners, urls, localData, getElement };
}

async function flushUI() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

test("client script parses and mounts the intended application", () => {
  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(source, /function instantMediaSources\(/);
  assert.match(source, /function getPreparedMediaSources\(/);
});

test("anime details and episode buttons appear while all provider requests hang", async () => {
  const browser = createBrowser("#/anime/21");
  await flushUI();
  const html = browser.getElement("#view").innerHTML;
  assert.match(html, /Sample Anime/);
  assert.match(html, /Episodes/);
  assert.match(browser.getElement("#episode-list").innerHTML, /data-play-episode="1\|1"/);
  assert.match(html, /Start watching/);
  assert.doesNotMatch(html, /Checking JustAnime, HiAnime and AniKoto/);
  assert.ok(browser.urls.some(url => url.startsWith("/api/")), "provider discovery should run independently");
});

test("player appears before stream resolution and DUB/SUB switching does not throw", async () => {
  const browser = createBrowser("#/watch/21/2");
  await flushUI();
  const html = browser.getElement("#view").innerHTML;
  assert.match(html, /id="anime-video"/);
  assert.match(html, /English dub/);
  assert.doesNotMatch(html, /Paste stream link|JustAnime|HiAnime|AniKoto/);
  assert.match(html, /id="available-streams-panel" hidden/);
  assert.match(html, /Episode 2/);
  const saved = JSON.parse(browser.localData.get("anidash.watch.web.v1"));
  assert.equal(saved.history["21"].episode, 2, "episode should be saved before stream becomes playable");
  assert.doesNotMatch(html, /Checking JustAnime, HiAnime and AniKoto in parallel/);
  const click = browser.listeners.get("click");
  const target = {
    hasAttribute: key => key === "data-category",
    getAttribute: key => key === "data-category" ? "sub" : null
  };
  await assert.doesNotReject(async () => click({
    target: { closest: () => target },
    preventDefault() {}
  }));
});


test("premium player keeps episodes, language and sources in distinct regions", async () => {
  const browser = createBrowser("#/watch/21/2");
  await flushUI();
  const html = browser.getElement("#view").innerHTML;
  assert.match(html, /class="player-main"/);
  assert.match(html, /class="player-source-stack"/);
  assert.match(html, /class="player-panel player-episodes-panel"/);
  assert.match(html, /id="player-episode-range"/);
  assert.match(html, /id="category-pills"/);
  assert.match(html, /id="available-streams-panel" hidden/);
  assert.match(browser.getElement("#player-episode-items").innerHTML, /data-player-episode="2"/);
});

test("episode 394 opens in the 301–400 range and highlights the current chip", async () => {
  const prior = media.episodes;
  media.episodes = 450;
  try {
    const browser = createBrowser("#/watch/21/394");
    await flushUI();
    const rangeHtml = browser.getElement("#player-episode-range").innerHTML;
    const gridHtml = browser.getElement("#player-episode-items").innerHTML;
    assert.match(rangeHtml, /value="4" selected>301–400/);
    assert.match(gridHtml, /class="player-episode active" data-player-episode="394"/);
    assert.match(browser.getElement("#player-episode-pagination").innerHTML, /301–400 of 450/);
    assert.doesNotMatch(gridHtml, /player-episode-title/);
  } finally {
    media.episodes = prior;
  }
});


test("player names each returned server rather than the adapter that fetched it", () => {
  const start = source.indexOf("  function renderPlayerOptions() {");
  const end = source.indexOf("\n  function fallbackToNextProvider(", start);
  assert.ok(start > -1 && end > start, "resolver option renderer must exist");
  const fragment = source.slice(start, end);
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, { innerHTML: "", textContent: "", hidden: false });
    }
    return elements.get(selector);
  };
  const sandbox = {
    $, escapeHtml: value => String(value),
    state: { player: {
      match: { provider: { id: "justanime" } },
      candidateIndex: 0, intro: null, outro: null,
      candidates: [
        { server: "Momo", quality: "1080p" },
        { server: "Gigi", quality: "720p" },
        { name: "MegaPlay", type: "embed" }
      ]
    } }
  };
  vm.runInNewContext(fragment + "\nrenderPlayerOptions();", sandbox);
  const labels = elements.get("#quality-pills").innerHTML;
  assert.match(labels, /Momo · 1080p/);
  assert.match(labels, /Gigi · 720p/);
  assert.match(labels, /MegaPlay/);
  assert.doesNotMatch(labels, /JustAnime|HiAnime|AniKoto|Stream 1/);
  assert.equal(elements.get("#available-streams-panel").hidden, false);
});
