const API = "https://core.justanime.to/api";
const SITE = "https://justanime.to";
const UA = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const SERVER_OPTIONS = {
  sub: [
    { id: "auto", name: "Automatic (Best available)" },
    { id: "megaplay", name: "Momo (HLS)" },
    { id: "zokoanime", name: "Zoko (HLS)" },
    { id: "animegg", name: "Gigi (MP4)" },
    { id: "anineko", name: "Neko (HLS)" }
  ],
  dub: [
    { id: "auto", name: "Automatic (Best available)" },
    { id: "megaplay", name: "Momo (HLS)" },
    { id: "zokoanime", name: "Zoko (HLS)" },
    { id: "animegg", name: "Gigi (MP4)" },
    { id: "anineko", name: "Neko (HLS)" }
  ]
};

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, s-maxage=25, stale-while-revalidate=90"
};

function send(res, status, body, cacheControl) {
  Object.entries(jsonHeaders).forEach(([key, value]) => res.setHeader(key, value));
  if (cacheControl) res.setHeader("Cache-Control", cacheControl);
  return res.status(status).json(body);
}

function positiveInt(value, fallback = 1, max = 100) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback;
}


const RELAY_BASE = String(process.env.JUSTANIME_RELAY_URL || "https://anidashweb.vercel.app/api/justanime").replace(/\/$/, "");

function allowedJustAnimePath(path) {
  const value = String(path || "");
  return /^\/search\?(?:[^#]*)$/.test(value) ||
    /^\/anime\/\d{1,12}\/episodes\?page=\d{1,2}$/.test(value) ||
    /^\/watch\/\d{1,12}\/episode\/\d{1,5}(?:\.\d{1,3})?(?:\/(?:megaplay|zokoanime|animegg|anineko\/(?:sub|dub)(?:\/hd1)?))?$/.test(value);
}

async function requestJson(url, timeout = 8500, signal) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: SITE,
      Referer: SITE + "/",
      "User-Agent": UA
    },
    redirect: "follow",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout)
  });
  const body = await response.text();
  if (!response.ok) throw new Error("HTTP " + response.status);
  let payload;
  try { payload = JSON.parse(body); }
  catch { throw new Error("JustAnime returned a non-JSON response"); }
  if (!payload || typeof payload !== "object" || payload.error) {
    throw new Error(payload?.error || "JustAnime returned an invalid response");
  }
  return payload;
}

async function getJson(req, path, timeout = 8500) {
  const safePath = String(path || "");
  if (!allowedJustAnimePath(safePath)) throw new Error("Invalid JustAnime API path");

  const directController = new AbortController();
  const relayController = new AbortController();
  let finished = false;
  const direct = requestJson(API + safePath, timeout, directController.signal);
  const relay = (async () => {
    // Give the primary API a brief head start, but don't wait for its full
    // timeout before opening the known-good AniDash relay.
    await new Promise(resolve => setTimeout(resolve, 300));
    if (finished || relayController.signal.aborted) {
      throw new Error("Relay request cancelled after another route responded");
    }
    const relayUrl = new URL(RELAY_BASE);
    relayUrl.searchParams.set("path", safePath);
    return requestJson(relayUrl.toString(), timeout, relayController.signal);
  })();

  try {
    const payload = await Promise.any([direct, relay]);
    finished = true;
    directController.abort();
    relayController.abort();
    return payload;
  } catch (error) {
    finished = true;
    directController.abort();
    relayController.abort();
    const reasons = Array.isArray(error?.errors) ? error.errors : [];
    const detail = reasons.map(item => item?.message).filter(Boolean).slice(0, 2).join("; ");
    throw new Error("JustAnime API and relay failed" + (detail ? ": " + detail : ""));
  }
}

function getPath(animeId, episode, suffix = "") {
  const id = String(animeId || "").trim();
  const ep = String(episode ?? "").trim();
  if (!/^\d{1,12}$/.test(id)) throw new Error("JustAnime requires the numeric AniList anime ID");
  if (!/^\d{1,5}(?:\.\d{1,3})?$/.test(ep) || Number(ep) <= 0) {
    throw new Error("Invalid JustAnime episode number");
  }
  const safeSuffix = String(suffix || "");
  if (safeSuffix && !/^\/(?:megaplay|zokoanime|animegg|anineko\/(?:sub|dub)(?:\/hd1)?)$/.test(safeSuffix)) {
    throw new Error("Unknown JustAnime server");
  }
  return "/watch/" + id + "/episode/" + ep + safeSuffix;
}

function normaliseAnime(item) {
  const rawTitle = item?.title || item?.name || "Unknown";
  const title = typeof rawTitle === "string"
    ? rawTitle
    : (rawTitle.english || rawTitle.romaji || rawTitle.native || "Unknown");
  return {
    id: String(item?.id || item?.animeId || item?.slug || ""),
    title: String(title),
    image: String(item?.cover || item?.poster || item?.image || ""),
    type: String(item?.type || ""),
    year: item?.year ?? item?.releaseDate ?? "",
    episodes: item?.episodes ?? item?.number ?? null
  };
}

function normaliseEpisode(item, index) {
  const number = Number(item?.number ?? item?.episode ?? item?.episodeNumber ?? index + 1);
  return {
    id: String(number),
    number,
    title: String(item?.title || item?.name || "Episode " + number),
    thumbnail: String(item?.image || item?.thumbnail || item?.snapshot || ""),
    date: String(item?.airDate || item?.date || ""),
    isFiller: item?.filler === true || item?.filler === 1 || item?.isFiller === true ||
      String(item?.type || "").toLowerCase() === "filler"
  };
}

function normalizeTracks(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(item => item && item.lang !== "thumbnails" && item.kind !== "thumbnails")
    .map(item => ({
      url: String(item.url || item.file || ""),
      lang: String(item.lang || item.label || "English"),
      type: "subtitles"
    }))
    .filter(item => item.url);
}

async function search(req, query, page) {
  const params = new URLSearchParams({ query: String(query), page: String(page) });
  const payload = await getJson(req, "/search?" + params.toString(), 9000);
  const rows = Array.isArray(payload.results) ? payload.results
    : Array.isArray(payload.data) ? payload.data
    : Array.isArray(payload.data?.results) ? payload.data.results
    : [];
  const results = rows.map(normaliseAnime).filter(item => item.id && item.title !== "Unknown");
  return {
    results,
    page,
    hasMore: payload.hasNextPage === true || payload.pageInfo?.hasNextPage === true ||
      Number(payload.totalPages || 1) > page
  };
}

async function episodes(req, animeId) {
  const id = String(animeId || "").trim();
  if (!/^\d{1,12}$/.test(id)) throw new Error("JustAnime requires the numeric AniList anime ID");

  async function fetchPage(page) {
    return getJson(req, "/anime/" + id + "/episodes?page=" + page, 10000);
  }

  const first = await fetchPage(1);
  const firstRows = Array.isArray(first.episodes) ? first.episodes : [];
  if (!firstRows.length) throw new Error("JustAnime returned no episodes for this anime");

  const totalPages = Number(first.totalPages || first.pageInfo?.lastPage || 0);
  const hasNextPage = first.hasNextPage === true || first.pageInfo?.hasNextPage === true;
  const pages = [first];

  if (totalPages > 1) {
    const lastPage = Math.min(25, Math.max(1, Math.floor(totalPages)));
    const additional = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, index) =>
        fetchPage(index + 2).catch(() => null)
      )
    );
    pages.push(...additional.filter(Boolean));
  } else if (hasNextPage || firstRows.length >= 100) {
    for (let page = 2; page <= 25; page++) {
      let next;
      try { next = await fetchPage(page); } catch { break; }
      const rows = Array.isArray(next.episodes) ? next.episodes : [];
      if (!rows.length) break;
      pages.push(next);
      if (next.hasNextPage !== true && rows.length < 100) break;
    }
  }

  const unique = new Map();
  pages.flatMap(value => Array.isArray(value.episodes) ? value.episodes : [])
    .map(normaliseEpisode)
    .filter(item => Number.isFinite(item.number) && item.number > 0)
    .sort((a, b) => a.number - b.number)
    .forEach(item => { if (!unique.has(item.number)) unique.set(item.number, item); });

  const list = [...unique.values()];
  return {
    episodes: list,
    totalEpisodes: Number(first.totalEpisodes || list.length),
    animeId: id
  };
}

async function relayPath(path) {
  if (!allowedJustAnimePath(path)) throw new Error("Invalid JustAnime path");
  const response = await fetch(API + path, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: SITE,
      Referer: SITE + "/",
      "User-Agent": UA
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error("JustAnime upstream returned HTTP " + response.status);
  try { return JSON.parse(body); }
  catch { throw new Error("JustAnime upstream returned an invalid response"); }
}

function mediaUrl(req, raw, isHls, playbackHeaders = {}) {
  try {
    const target = new URL(String(raw));
    if (target.protocol !== "https:") return String(raw);
    const allowed = [
      "neko.justanime.to", "nexabloom.top", "give6beforegtav.site",
      "megaplay.buzz", "zokoanime.video", "animegg.org",
      "kwik.cx", "kwik.si", "kwik.to", "kwik.li",
      "megacloud.blog", "megacloud.tv", "rapid-cloud.co", "rapid-cloud.ru",
      "vidnest.fun", "norami.top", "kryntal.top", "akirax.buzz", "vid-tube.site"
    ];
    if (!allowed.some(host => target.hostname === host || target.hostname.endsWith("." + host))) {
      return target.toString();
    }

    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
    if (!host) return target.toString();

    const safeHeaders = {};
    for (const [key, value] of Object.entries(playbackHeaders || {})) {
      if (/^(referer|origin|user-agent|accept)$/i.test(key) && typeof value === "string" && value.length <= 600) {
        safeHeaders[key.toLowerCase()] = value;
      }
    }

    const useNativeJustAnimeProxy = [
      "neko.justanime.to", "nexabloom.top", "give6beforegtav.site"
    ].some(domain => target.hostname === domain || target.hostname.endsWith("." + domain));

    let mediaTarget = target.toString();
    if (useNativeJustAnimeProxy) {
      mediaTarget = "https://neko.justanime.to/m3u8-proxy?url=" +
        encodeURIComponent(target.toString()) +
        "&headers=" + encodeURIComponent(JSON.stringify(safeHeaders));
    }
    const headerParam = useNativeJustAnimeProxy || !Object.keys(safeHeaders).length
      ? ""
      : "&headers=" + encodeURIComponent(JSON.stringify(safeHeaders));
    return proto + "://" + host + "/api/media?url=" + encodeURIComponent(mediaTarget) +
      "&hls=" + (isHls ? "1" : "0") + headerParam;
  } catch {
    return String(raw || "");
  }
}

function headerValue(sources, names, fallback) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const key = Object.keys(source).find(candidate => names.some(name => candidate.toLowerCase() === name.toLowerCase()));
    if (key && typeof source[key] === "string" && source[key]) return source[key];
  }
  return fallback;
}

function normalizeBlock(payload, endpoint, category, req) {
  if (!payload) return null;
  let raw;
  let actualCategory = category;
  if (payload.sub || payload.dub) {
    raw = category === "dub" ? payload.dub : (payload.sub || payload.hsub);
    if (!raw || !Array.isArray(raw.sources) || raw.sources.length === 0) return null;
  } else {
    const endpointCategory = endpoint.includes("/dub") ? "dub" : "sub";
    if (endpoint.includes("/anineko/") && endpointCategory !== category) return null;
    raw = payload;
    actualCategory = endpointCategory;
  }

  const serverName = endpoint.includes("megaplay") ? "Momo"
    : endpoint.includes("zokoanime") ? "Zoko"
    : endpoint.includes("anineko") ? "Neko"
    : endpoint.includes("animegg") ? "Gigi" : "JustAnime";

  const referer = endpoint.includes("megaplay") ? "https://megaplay.buzz/"
    : endpoint.includes("zoko") ? "https://zokoanime.video/"
    : endpoint.includes("animegg") ? "https://www.animegg.org/"
    : "https://justanime.to/";

  const sources = (Array.isArray(raw.sources) ? raw.sources : []).map(item => {
    const url = String(item?.url || "");
    const isM3U8 = item?.isM3U8 === true || /\.m3u8(?:$|\?)/i.test(url);
    return {
      url: mediaUrl(req, url, isM3U8, {
        Referer: headerValue([item?.headers, raw?.headers, payload?.headers], ["referer"], referer),
        Origin: headerValue([item?.headers, raw?.headers, payload?.headers], ["origin"], new URL(referer).origin),
        "User-Agent": headerValue([item?.headers, raw?.headers, payload?.headers], ["user-agent"], UA),
        Accept: headerValue([item?.headers, raw?.headers, payload?.headers], ["accept"], "*/*")
      }),
      originalUrl: url,
      quality: String(item?.quality || "Auto"),
      type: serverName,
      isM3U8,
      isDub: actualCategory === "dub"
    };
  }).filter(item => item.url);

  if (!sources.length) return null;
  const tracks = normalizeTracks(raw.subtitles || raw.tracks || payload.subtitles || []);
  const intro = raw.intro || payload.intro || payload.sub?.intro || payload.dub?.intro || null;
  const outro = raw.outro || payload.outro || payload.sub?.outro || payload.dub?.outro || null;
  const headers = raw.headers || payload.headers || {};

  return {
    server: serverName,
    sources,
    tracks,
    intro: intro && Number(intro.end) > Number(intro.start) ? intro : null,
    outro: outro && Number(outro.end) > Number(outro.start) ? outro : null,
    headers
  };
}

async function streams(req, animeId, episode, server, category) {
  const cleanCategory = category === "dub" ? "dub" : "sub";
  const explicit = String(server || "auto").toLowerCase();
  let endpoints;
  if (explicit === "auto" || explicit === "default") {
    endpoints = [
      getPath(animeId, episode, "/megaplay"),
      getPath(animeId, episode),
      getPath(animeId, episode, "/zokoanime"),
      getPath(animeId, episode, "/animegg"),
      getPath(animeId, episode, "/anineko/" + cleanCategory + "/hd1"),
      getPath(animeId, episode, "/anineko/" + cleanCategory)
    ];
  } else if (explicit === "megaplay" || explicit === "momo") {
    endpoints = [getPath(animeId, episode, "/megaplay")];
  } else if (explicit === "zokoanime" || explicit === "zoko") {
    endpoints = [getPath(animeId, episode, "/zokoanime")];
  } else if (explicit === "animegg" || explicit === "gigi") {
    endpoints = [getPath(animeId, episode, "/animegg")];
  } else if (explicit === "anineko" || explicit === "neko") {
    endpoints = [getPath(animeId, episode, "/anineko/" + cleanCategory)];
  } else {
    throw new Error("Unknown JustAnime server");
  }

  async function tryEndpoint(endpoint) {
    const payload = await getJson(req, endpoint, 8500);
    const parsed = normalizeBlock(payload, endpoint, cleanCategory, req);
    if (!parsed || !parsed.sources.length) throw new Error("No " + cleanCategory.toUpperCase() + " streams at " + endpoint);
    return {
      ...parsed,
      intro: parsed.intro || payload.intro || payload.sub?.intro || payload.dub?.intro || null,
      outro: parsed.outro || payload.outro || payload.sub?.outro || payload.dub?.outro || null,
      servers: SERVER_OPTIONS[cleanCategory]
    };
  }

  if (explicit !== "auto" && explicit !== "default") {
    return tryEndpoint(endpoints[0]);
  }

  // Android uses a small concurrent race with fallback hosts. The web serverless
  // route races the same fixed endpoints so a slow first host does not consume
  // the whole function timeout.
  try {
    return await Promise.any(endpoints.map(tryEndpoint));
  } catch (error) {
    const reasons = Array.isArray(error?.errors) ? error.errors : [];
    const detail = reasons.map(item => item?.message).filter(Boolean).slice(0, 2).join("; ");
    throw new Error("No playable " + cleanCategory.toUpperCase() + " stream was returned by JustAnime" + (detail ? ": " + detail : ""));
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET" });
  try {
    // A path-only request is the same-origin relay used by the Android provider
    // when direct requests to the JustAnime API are unavailable.
    if (req.query.path) {
      const payload = await relayPath(String(req.query.path));
      return send(res, 200, payload, "no-store");
    }

    const action = String(req.query.action || "");
    if (action === "search") {
      const query = String(req.query.query || "").trim().slice(0, 100);
      if (!query) return send(res, 400, { error: "A search query is required" });
      const page = positiveInt(req.query.page, 1, 25);
      return send(res, 200, await search(req, query, page));
    }
    if (action === "episodes") {
      return send(res, 200, await episodes(req, String(req.query.id || "")));
    }
    if (action === "servers") {
      const category = req.query.category === "dub" ? "dub" : "sub";
      return send(res, 200, { servers: SERVER_OPTIONS[category], category });
    }
    if (action === "streams") {
      const animeId = String(req.query.id || "");
      const episode = String(req.query.episode || req.query.episodeId || "");
      if (!animeId || !episode) {
        return send(res, 400, { error: "Anime ID and episode number are required" });
      }
      return send(
        res,
        200,
        await streams(req, animeId, episode, req.query.server, req.query.category),
        "no-store"
      );
    }
    return send(res, 400, { error: "Unknown JustAnime action" });
  } catch (error) {
    return send(res, 502, { error: error?.message || "JustAnime is temporarily unavailable" }, "no-store");
  }
}
