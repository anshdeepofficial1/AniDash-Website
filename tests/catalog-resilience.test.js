import test from "node:test";
import assert from "node:assert/strict";
import catalogueHandler from "../api/catalog.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(body) { this.body = body; return this; }
  };
}
const media = [{ id: 21, title: { english: "One Piece" }, coverImage: { large: "https://example.com/one-piece.jpg" } }];
const sections = ["trending", "popular", "top", "airing", "upcoming", "movies", "hidden"];
let calls = 0;
let latestQuery = "";
const originalFetch = globalThis.fetch;

test("home catalogue aggregates all sections into one cached request", async () => {
  globalThis.fetch = async (_url, options) => {
    calls++;
    latestQuery = JSON.parse(options.body).query;
    return { ok: true, status: 200, headers: new Headers(),
      json: async () => ({ data: Object.fromEntries(sections.map(key => [key, { media }])) }) };
  };
  try {
    const first = response();
    await catalogueHandler({ method: "GET", query: { view: "home" } }, first);
    assert.equal(first.statusCode, 200);
    assert.equal(calls, 1, "One upstream GraphQL request, not seven");
    for (const key of sections) {
      assert.equal(first.body.sections[key][0].id, 21);
      assert.match(latestQuery, new RegExp(key + ": Page\\("));
    }
    const second = response();
    await catalogueHandler({ method: "GET", query: { view: "home" } }, second);
    assert.equal(second.statusCode, 200);
    assert.equal(calls, 1, "In-memory cache must eliminate repeat fetches");
    assert.match(second.headers["Cache-Control"], /s-maxage/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("search uses variables, caches results and validates input", async () => {
  globalThis.fetch = async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.equal(request.variables.term, "One Piece");
    return { ok: true, status: 200, headers: new Headers(),
      json: async () => ({ data: { Page: { media } } }) };
  };
  try {
    const invalid = response();
    await catalogueHandler({ method:"GET", query:{view:"search",q:"x"} }, invalid);
    assert.equal(invalid.statusCode, 400);
    const result = response();
    await catalogueHandler({ method:"GET", query:{view:"search",q:"One Piece"} }, result);
    assert.equal(result.statusCode,200);
    assert.equal(result.body.media[0].id, 21);
    const before = calls;
    const again = response();
    await catalogueHandler({ method:"GET", query:{view:"search",q:"One Piece"} }, again);
    assert.equal(calls,before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AniList HTTP 429 reports bounded retry guidance instead of an empty catalogue", async () => {
  globalThis.fetch = async () => ({
    ok:false, status:429,
    headers:new Headers({ "retry-after":"10" }),
    json:async () => ({ errors:[{message:"Too many requests"}] })
  });
  try {
    const limited = response();
    await catalogueHandler({ method:"GET", query:{view:"search",q:"Rate limit test"} }, limited);
    assert.equal(limited.statusCode,503);
    assert.equal(limited.body.retryAfter,10);
    assert.equal(limited.headers["Retry-After"],"10");
    assert.match(limited.body.error,/busy/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
