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

function send(res, status, body) {
  Object.entries(jsonHeaders).forEach(([key, value]) => res.setHeader(key, value));
  return res.status(status).json(body);
}

function positiveInt(value, fallback = 1, max = 100) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback;
}

function mediaUrl(req, raw, isHls) {
  try {
    const target = new URL(String(raw));
    if (target.protocol !== "https:") return String(raw);
    const allowed = [
      "neko.justanime.to", "nexabloom.top", "give6beforegtav.site",
      "megaplay.buzz", "zokoanime.video", "animegg.org"
    ];
    const hostAllowed = allowed.some(host => target.hostname === host || target.hostname.endsWith("." + host));
    if (!hostAllowed) return target.toString();
    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
    if (!host) return target.toString();
    return proto + "://" + host + "/api/media?url=" + encodeURIComponent(target.toString()) + "&hls=" + (isHls ? "1" : "0");
  } catch {
    return String(raw || "");
  }
}

async function getJson(path) {
  const response = await fetch(API + path, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: SITE,
      Referer: SITE + "/",
      "User-Agent": UA
    },
    signal: AbortSignal.timeout(14000)
  });
  if (!response.ok) throw new Error("JustAnime returned HTTP " + response.status);
  const data = await response.json();
  if (!data || typeof data !== "object" || data.error) {
    throw new Error(data?.error || "JustAnime returned an invalid response");
  }
  return data;
}

function getPath(id, episode, suffix = "") {
  const cleanId = String(id).replace(/[^0-9]/g, "");
  const cleanEpisode = String(episode).replace(/[^0-9.]/g, "");
  if (!cleanId || !cleanEpisode) throw new Error("Invalid JustAnime anime or episode ID");
  return "/watch/" + cleanId + "/episode/" + cleanEpisode + suffix;
}

function normalizeSearch(item) {
  const title = item?.title && typeof item.title === "object"
    ? (item.title.english || item.title.romaji || item.title.native || "Unknown")
    : (item?.title || item?.name || "Unknown");
  const id = item?.id ?? item?.animeId;
  return {
    id: id == null ? "" : String(id),
    title: String(title),
    image: item?.cover || item?.poster || item?.image || "",
    type: item?.type || "",
    year: item?.year ?? "",
    episodes: item?.episodes ?? null
  };
}

async function search(query, page) {
  const url = new URL(API + "/search");
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  const data = await getJson(url.pathname + url.search);
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    results: results.map(normalizeSearch).filter(item => item.id && item.title !== "Unknown"),
    page,
    hasMore: data.hasNextPage === true || (Number(data.totalPages) > page)
  };
}

async function episodes(animeId) {
  const id = String(animeId).replace(/[^0-9]/g, "");
  if (!id) throw new Error("Invalid JustAnime anime ID");
  const first = await getJson("/anime/" + id + "/episodes?page=1");
  const pages = [first];
  let totalPages = Number(first.totalPages || first.pageInfo?.lastPage || 0);
  if (!totalPages && first.hasNextPage) totalPages = 25;
  totalPages = Math.min(25, Math.max(1, totalPages || 1));
  if (totalPages > 1) {
    const remaining = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        getJson("/anime/" + id + "/episodes?page=" + (index + 2)).catch(() => null)
      )
    );
    pages.push(...remaining.filter(Boolean));
  }
  const flattened = pages.flatMap(page => Array.isArray(page.episodes) ? page.episodes : []);
  const seen = new Set();
  const list = flattened.map((item, index) => {
    const number = Number(item.number ?? index + 1);
    return {
      id: String(number),
      number,
      title: item.title || "Episode " + number,
      thumbnail: item.image || "",
      date: item.airDate || "",
      isFiller: item.filler === true || item.filler === 1 || item.isFiller === true || String(item.type || "").toLowerCase() === "filler"
    };
  }).filter(item => Number.isFinite(item.number) && item.number > 0 && !seen.has(item.number) && seen.add(item.number));
  list.sort((a, b) => a.number - b.number);
  return { episodes: list, totalEpisodes: list.length };
}

function normalizeTracks(raw, fallback = []) {
  const values = Array.isArray(raw) ? raw : fallback;
  return values.map(item => ({
    url: String(item?.url || item?.file || ""),
    lang: String(item?.lang || item?.label || "English"),
    type: "subtitles"
  })).filter(item => item.url);
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
      url: mediaUrl(req, url, isM3U8),
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
    endpoints = [getPath(animeId, episode, "/anineko/" + cleanCategory + "/hd1"), getPath(animeId, episode, "/anineko/" + cleanCategory)];
  } else {
    throw new Error("Unknown JustAnime server");
  }

  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const payload = await getJson(endpoint);
      const parsed = normalizeBlock(payload, endpoint, cleanCategory, req);
      if (parsed) {
        const intro = parsed.intro || payload.intro || payload.sub?.intro || payload.dub?.intro || null;
        const outro = parsed.outro || payload.outro || payload.sub?.outro || payload.dub?.outro || null;
        return { ...parsed, intro, outro, servers: SERVER_OPTIONS[cleanCategory] };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("No playable " + cleanCategory.toUpperCase() + " stream was returned by JustAnime" + (lastError ? ": " + lastError.message : ""));
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
      return send(res, 200, await streams(req, animeId, episode, req.query.server, req.query.category));
    }
    return send(res, 400, { error: "Unknown JustAnime action" });
  } catch (error) {
    return send(res, 502, { error: error?.message || "JustAnime is temporarily unavailable" });
  }
}
