import test from "node:test";
import assert from "node:assert/strict";

import justAnime from "../api/justanime.js";
import hiAnime from "../api/hianime.js";
import aniKoto from "../api/anikoto.js";

function makeFetchResponse(payload, status = 200) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body)
  };
}

function makeRequest(query) {
  return {
    method: "GET",
    query,
    headers: {
      host: "anidash-test.vercel.app",
      "x-forwarded-host": "anidash-test.vercel.app",
      "x-forwarded-proto": "https"
    }
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

async function invoke(handler, query) {
  const response = makeResponse();
  await handler(makeRequest(query), response);
  return response;
}

test("built-in provider routes retain episode and playback fallbacks", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];

  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.includes("/anime/21/episodes?page=1")) {
        return makeFetchResponse({
          episodes: [{ number: 1, title: "Episode One" }],
          totalEpisodes: 1
        });
      }

      if (url.includes("/watch/21/episode/1/megaplay")) {
        return makeFetchResponse({
          sub: {
            sources: [{
              url: "https://megaplay.buzz/hls/master.m3u8",
              quality: "1080p"
            }]
          }
        });
      }

      if (url.includes("/anime/one-piece/episodes")) {
        return makeFetchResponse({ error: "legacy API down" }, 503);
      }

      if (url.startsWith("https://api.ani.zip/mappings?anilist_id=21")) {
        return makeFetchResponse({
          episodes: {
            "1": { title: { en: "Episode One" } }
          }
        });
      }

      if (url.startsWith("https://anikototvapi.vercel.app/api/stream/embeds")) {
        return makeFetchResponse({ error: "shared API paused" }, 503);
      }

      throw new Error("Unexpected test URL: " + url);
    };

    const justAnimeEpisodes = await invoke(justAnime, {
      action: "episodes",
      id: "21"
    });
    assert.equal(justAnimeEpisodes.statusCode, 200);
    assert.equal(justAnimeEpisodes.body.episodes[0].number, 1);

    const justAnimeStreams = await invoke(justAnime, {
      action: "streams",
      id: "21",
      episode: "1",
      episodeId: "1",
      server: "megaplay",
      category: "sub"
    });
    assert.equal(justAnimeStreams.statusCode, 200);
    assert.equal(justAnimeStreams.body.sources.length, 1);
    assert.equal(justAnimeStreams.body.sources[0].isM3U8, true);
    assert.match(justAnimeStreams.body.sources[0].url, /\/api\/media\?/);

    const hiAnimeEpisodes = await invoke(hiAnime, {
      action: "episodes",
      id: "one-piece",
      anilistId: "21"
    });
    assert.equal(hiAnimeEpisodes.statusCode, 200);
    assert.equal(hiAnimeEpisodes.body.episodes[0].number, 1);
    assert.ok(requestedUrls.some(url => url.startsWith("https://api.ani.zip/mappings?anilist_id=21")));

    const aniKotoEmbeds = await invoke(aniKoto, {
      action: "streams",
      id: "21",
      episode: "1",
      episodeId: "1",
      anilistId: "21",
      malId: "21",
      category: "sub"
    });
    assert.equal(aniKotoEmbeds.statusCode, 200);
    assert.equal(aniKotoEmbeds.body.mode, "direct-embed-api");
    assert.equal(aniKotoEmbeds.body.embeds.length, 3);
    assert.ok(aniKotoEmbeds.body.embeds.some(item => item.url.includes("megaplay.buzz")));
    assert.ok(aniKotoEmbeds.body.embeds.some(item => item.url.includes("anixo.buzz")));
    assert.ok(aniKotoEmbeds.body.embeds.some(item => item.url.includes("megavid.buzz")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
