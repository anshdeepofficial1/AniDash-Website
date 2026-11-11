import test from "node:test";
import assert from "node:assert/strict";
import mediaProxy from "../api/media.js";

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; }
  };
}

function request(url) {
  return {
    method: "GET",
    query: { url, hls: "1" },
    headers: { host: "anidash-test.vercel.app", "x-forwarded-proto": "https" }
  };
}

test("Neko relay network error falls back to vetted original HLS host", async () => {
  const oldFetch = globalThis.fetch;
  const original = "https://fetch.nexabloom.top/hls/master.m3u8";
  const relay = "https://neko.justanime.to/m3u8-proxy?url=" + encodeURIComponent(original) +
    "&headers=" + encodeURIComponent(JSON.stringify({ Referer: "https://megaplay.buzz/" }));
  const seen = [];
  globalThis.fetch = async input => {
    const url = String(input);
    seen.push(url);
    if (url.startsWith("https://neko.justanime.to/")) throw new TypeError("fetch failed");
    assert.equal(url, original);
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: key => key.toLowerCase() === "content-type" ? "application/vnd.apple.mpegurl" : null },
      text: async () => "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:5.0,\nsegment1.ts\n"
    };
  };
  try {
    const res = response();
    await mediaProxy(request(relay), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /^#EXTM3U/);
    assert.ok(res.body.includes(encodeURIComponent("https://fetch.nexabloom.top/hls/segment1.ts")));
    assert.ok(!res.body.includes("m3u8-proxy"), "segment URLs must use working direct proxy route");
    assert.equal(seen.length, 2, "attempt external relay, then direct origin");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("unreachable media hosts return upstream 502, not misleading bad request 400", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  try {
    const res = response();
    await mediaProxy(request("https://fetch.nexabloom.top/hls/master.m3u8"), res);
    assert.equal(res.statusCode, 502);
    assert.match(String(res.body.error), /fetch failed/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});


test("Gigi's verified redirect to vidcache.net stays within the safe host list", async () => {
  const oldFetch = globalThis.fetch;
  const original = "https://www.animegg.org/watch/394.mp4";
  const redirected = "https://cdn.vidcache.net/videos/394.mp4";
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(String(url));
    if (String(url) === original) {
      return {
        status: 302, ok: false,
        headers: { get: key => key === "location" ? redirected : null }
      };
    }
    assert.equal(String(url), redirected);
    return {
      status: 206, ok: true, url: redirected,
      headers: { get: key => key === "content-type" ? "video/mp4" : null },
      body: null
    };
  };
  try {
    const req = request(original);
    req.query.hls = "0";
    req.method = "HEAD";
    req.headers.range = "bytes=0-0";
    const res = response();
    await mediaProxy(req, res);
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers["content-type"], "video/mp4");
    assert.deepEqual(requests, [original, redirected]);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
