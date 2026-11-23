import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAnimetsu } from "../server/animetsu.js";

const mediaUrl = (url, hls, headers) => `relay:${hls ? "hls" : "file"}:${url}:${headers.Referer}`;

test("animetsu: relative proxy URLs, subs and skips are normalised", () => {
  const out = normalizeAnimetsu({
    sources: [{ url: "/v2/x/master.m3u8", quality: "master", type: "m3u8", need_proxy: true }, { url: "https://cdn.example/a.mp4", quality: "720p", type: "mp4" }],
    subs: [{ url: "/s/fr.vtt", lang: "French" }, { url: "/s/en.vtt", lang: "English" }, { url: "/t/thumb.vtt", lang: "thumbnails" }],
    skips: { intro: { start: 10, end: 90 }, ending: { start: 0, end: 0 } }
  }, "Kiwi", "dub", mediaUrl);
  assert.equal(out.sources.length, 2);
  assert.match(out.sources[0].url, /^relay:hls:https:\/\/mega-cloud\.top\/proxy\/v2\/x\/master\.m3u8:https:\/\/animetsu\.live\//);
  assert.equal(out.sources[0].quality, "Auto");
  assert.equal(out.sources[0].isDub, true);
  assert.equal(out.sources[1].isM3U8, false);
  assert.deepEqual(out.tracks.map(t => t.lang), ["English", "French"]);
  assert.deepEqual(out.intro, { start: 10, end: 90 });
  assert.equal(out.outro, null);
});
