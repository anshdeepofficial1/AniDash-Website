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
    const payload = await getJson(endpoint, 8500);
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
    const action = String(req.query.action || "");
    if (action === "search") {
      const query = String(req.query.query || "").trim().slice(0, 100);
      if (!query) return send(res, 400, { error: "A search query is required" });
      return send(res, 200, await search(query, positiveInt(req.query.page, 1, 25)));
    }
    if (action === "episodes") {
      return send(res, 200, await episodes(req.query.id));
    }
    if (action === "servers") {
      const category = req.query.category === "dub" ? "dub" : "sub";
      return send(res, 200, { servers: SERVER_OPTIONS[category] });
    }
    if (action === "streams") {
      const animeId = String(req.query.id || "");
      const episode = String(req.query.episode || "");
      if (!animeId || !episode) return send(res, 400, { error: "Anime ID and episode number are required" });
      return send(res, 200, await streams(req, animeId, episode, req.query.server, req.query.category), "no-store");
    }
    return send(res, 400, { error: "Unknown JustAnime action" });
  } catch (error) {
    return send(res, 502, { error: error?.message || "JustAnime is temporarily unavailable" });
  }
}
