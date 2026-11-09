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
  const location = { hash: initialHash, protocol: "http:" };
  const localStorage = {
    getItem: () => null, setItem() {}
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
    document, window, location, localStorage, fetch,
    URL, URLSearchParams, AbortController,
    setTimeout, clearTimeout,
    navigator: { userAgent: "Node test" },
    confirm: () => false,
    console
  };
  vm.runInNewContext(source, context, { filename: "app.js" });
  return { elements, listeners, urls, getElement };
}

async function flushUI() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
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
  assert.match(html, /DUB · ENGLISH/);
  assert.match(html, /Episode 2/);
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
