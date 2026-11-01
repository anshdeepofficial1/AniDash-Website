import crypto from "node:crypto";

const API_BASE = String(process.env.HIANIME_API_URL || "https://shonenx-aniwatch-instance.vercel.app/api/v2/hianime").replace(/\/$/, "");
const SITE_BASE = String(process.env.HIANIME_SITE_URL || "https://hianime.ms").replace(/\/$/, "");
const VIDNEST_BASE = "https://new.vidnest.fun";
const VIDNEST_SECRET = process.env.VIDNEST_SECRET || "wSnEvGgWkkxb7nO1yyFgMxhDvogX_Q7Dr0Fi1E4qvn0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60"
};

function send(res, status, body) {
  Object.entries(jsonHeaders).forEach(([key, value]) => res.setHeader(key, value));
  return res.status(status).json(body);
}

async function requestJson(url, timeout = 6000) {
  const response = await fetch(url, {
    headers: { Accept: "application/json, text/plain, */*", "User-Agent": UA },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error("HiAnime API returned HTTP " + response.status);
  return response.json();
}

async function requestText(url, timeout = 6000) {
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml,*/*", "User-Agent": UA, Referer: SITE_BASE + "/" },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error("HiAnime catalogue returned HTTP " + response.status);
  return { html: await response.text(), url: response.url || url };
}

function mediaUrl(req, raw, isHls) {
  try {
    const target = new URL(String(raw));
    if (target.protocol !== "https:") return String(raw);
    const hosts = [
      "neko.justanime.to", "nexabloom.top", "give6beforegtav.site",
      "megaplay.buzz", "megacloud.blog", "megacloud.tv",
      "rapid-cloud.co", "rapid-cloud.ru", "vidnest.fun"
    ];
    if (!hosts.some(host => target.hostname === host || target.hostname.endsWith("." + host))) return target.toString();
    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
    if (!host) return target.toString();
    return proto + "://" + host + "/api/media?url=" + encodeURIComponent(target.toString()) + "&hls=" + (isHls ? "1" : "0");
  } catch {
    return String(raw || "");
  }
}

function extractArray(payload, candidates) {
  for (const path of candidates) {
    const value = path.split(".").reduce((obj, key) => obj?.[key], payload);
    if (Array.isArray(value)) return value;
  }
  return Array.isArray(payload) ? payload : [];
}

function normaliseAnime(item) {
  const title = item?.name || item?.title?.english || item?.title?.romaji || item?.title || "Unknown";
  return {
    id: String(item?.id || item?.animeId || item?.slug || ""),
    title: String(title),
    image: item?.poster || item?.cover || item?.image || "",
    type: item?.type || "",
    year: item?.releaseDate || item?.year || "",
    episodes: item?.episodes?.sub || item?.episodes?.total || item?.episodes || null,
    anilistId: item?.anilistId || item?.anilist_id || null
  };
}

function parseHtmlSearch(html) {
  const cards = html.match(/<div[^>]+class=["'][^"']*flw-item[^"']*["'][\s\S]*?<\/div>\s*<\/div>/gi) || [];
  const out = [];
  const seen = new Set();
  for (const card of cards) {
    const anchor = card.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*film-name|<a\b[^>]*class=["'][^"']*film-name[^"']*["'][^>]*href=["']([^"']+)/i);
    const href = anchor?.[1] || anchor?.[2] || card.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1] || "";
    const title = card.match(/class=["'][^"']*film-name[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
    const poster = card.match(/(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i)?.[1] || "";
    if (!href || !title) continue;
    let id = href.replace(/\/$/, "").split("/").pop().split("?")[0];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, image: poster, type: "", year: "", episodes: null, anilistId: null });
  }
  return out;
}

async function search(query, page) {
  const url = new URL(API_BASE + "/search");
  url.searchParams.set("keyword", query);
  url.searchParams.set("page", String(page));
  try {
    const payload = await requestJson(url.toString());
    const rows = extractArray(payload, ["data.animes", "data.results", "animes", "results", "data"]);
    const results = rows.map(normaliseAnime).filter(item => item.id && item.title !== "Unknown");
    if (results.length) return { results, page, hasMore: payload?.data?.hasNextPage === true || payload?.data?.pageInfo?.hasNextPage === true };
  } catch (_) {}
  const htmlUrl = new URL(SITE_BASE + "/search");
  htmlUrl.searchParams.set("keyword", query);
  htmlUrl.searchParams.set("page", String(page));
  const pageData = await requestText(htmlUrl.toString());
  const results = parseHtmlSearch(pageData.html);
  if (!results.length) throw new Error("The original HiAnime catalogue endpoint is unavailable or returned no matches.");
  return { results, page, hasMore: false };
}

function normaliseEpisode(item, index) {
  const number = Number(item?.number ?? item?.episodeNumber ?? item?.episode ?? index + 1);
  return {
    id: String(item?.episodeId || item?.id || item?.idEpisode || number),
    number,
    title: String(item?.title || item?.name || "Episode " + number),
    thumbnail: String(item?.image || item?.thumbnail || ""),
    date: String(item?.airDate || item?.date || ""),
    isFiller: item?.isFiller === true || item?.filler === true || item?.filler === 1,
    anilistId: item?.anilistId || null
  };
}

async function resolveAniListId(animeId, givenId) {
  if (givenId && /^\d+$/.test(String(givenId))) return String(givenId);
  if (/^\d+$/.test(String(animeId))) return String(animeId);
  try {
    const detail = await requestText(SITE_BASE + "/details/" + encodeURIComponent(animeId), 6000);
    const patterns = [
      /<[^>]+id=["']syncData["'][^>]*>([\s\S]*?)<\//i,
      /["']anilist_id["']\s*:\s*["']?(\d+)/i,
      /(?:vidnest\.fun|tryembed[^/]*)(?:\/embed)?\/anime\/(\d+)\//i
    ];
    for (const pattern of patterns) {
      const match = detail.html.match(pattern);
      if (!match) continue;
      if (pattern === patterns[0]) {
        try {
          const sync = JSON.parse(match[1]);
          if (sync.anilist_id) return String(sync.anilist_id);
        } catch (_) {}
      } else if (match[1]) return String(match[1]);
    }
  } catch (_) {}
  return null;
}

async function episodes(animeId, anilistId) {
  try {
    const payload = await requestJson(API_BASE + "/anime/" + encodeURIComponent(animeId) + "/episodes");
    const rows = extractArray(payload, ["data.episodes", "episodes", "data"]);
    if (rows.length) {
      const list = rows.map(normaliseEpisode).filter(item => Number.isFinite(item.number) && item.number > 0).sort((a, b) => a.number - b.number);
      return { episodes: list, totalEpisodes: Number(payload?.data?.totalEpisodes || list.length) };
    }
  } catch (_) {}
  const mappedId = await resolveAniListId(animeId, anilistId);
  if (!mappedId) throw new Error("HiAnime episode API is unavailable and no AniList mapping could be resolved.");
  const mapping = await requestJson("https://api.ani.zip/mappings?anilist_id=" + encodeURIComponent(mappedId), 12000);
  const raw = mapping?.episodes && typeof mapping.episodes === "object" ? mapping.episodes : {};
  const list = Object.entries(raw).map(([numberText, value]) => {
    const number = Number(numberText);
    const title = value?.title || {};
    return {
      id: String(number),
      number,
      title: String(title.en || title["x-jat"] || title.ja || "Episode " + number),
      thumbnail: String(value?.image || ""),
      date: "",
      isFiller: false,
      anilistId: mappedId
    };
  }).filter(item => Number.isFinite(item.number) && item.number > 0).sort((a, b) => a.number - b.number);
  return { episodes: list, totalEpisodes: list.length, anilistId: mappedId };
}

function safeEpisodeId(animeId, episodeId) {
  const anime = String(animeId || "");
  const value = String(episodeId || "");
  if (!value) return anime;
  if (value.startsWith(anime + "?")) return value;
  if (value.startsWith("?")) return anime + value;
  if (value.includes("?ep=")) {
    const suffix = value.slice(value.indexOf("?"));
    return anime + suffix;
  }
  return anime + "?ep=" + encodeURIComponent(value);
}

async function servers(animeId, episodeId, category) {
  const key = category === "dub" ? "dub" : "sub";
  try {
    const actual = safeEpisodeId(animeId, episodeId);
    const url = new URL(API_BASE + "/episode/servers");
    url.searchParams.set("animeEpisodeId", actual);
    const payload = await requestJson(url.toString());
    const rows = Array.isArray(payload?.data?.[key]) ? payload.data[key] : [];
    const result = rows.map(item => {
      const id = String(item?.serverName || item?.serverId || "");
      return { id, name: id ? id.toUpperCase() : "Server" };
    }).filter(item => item.id);
    return { servers: result.length ? result : fallbackServers(), category: key };
  } catch (_) {
    return { servers: fallbackServers(), category: key };
  }
}
function fallbackServers() {
  return [
    { id: "aniwave", name: "AniWave • HLS" },
    { id: "hianime-hd-2", name: "HiAnime HD-2" },
    { id: "megaplay", name: "MegaPlay" }
  ];
}

function decodeBase64Url(value) {
  return Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function fetchVidNest(path) {
  const nonceParam = crypto.randomBytes(16).toString("base64url");
  const url = VIDNEST_BASE + "/" + path + "?_n=" + encodeURIComponent(nonceParam);
  const envelope = await requestJson(url, 10000);
  if (envelope?.v !== 2 || !envelope?.d) return envelope;
  const nonce = String(envelope.n || "");
  const encrypted = decodeBase64Url(envelope.d);
  if (encrypted.length <= 28) throw new Error("HiAnime returned an invalid encrypted stream envelope");
  const iv = encrypted.subarray(0, 12);
  const encryptedBody = encrypted.subarray(12, encrypted.length - 16);
  const authTag = encrypted.subarray(encrypted.length - 16);
  const key = crypto.createHash("sha256").update(nonce + "|" + VIDNEST_SECRET).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(encryptedBody), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

function normaliseSources(req, rawSources, category, label) {
  return (Array.isArray(rawSources) ? rawSources : []).map(item => {
    const url = String(item?.url || item?.file || "");
    const isM3U8 = item?.isM3U8 === true || /\.m3u8(?:$|\?)/i.test(url);
    return {
      url: mediaUrl(req, url, isM3U8),
      originalUrl: url,
      quality: String(item?.quality || "Auto"),
      type: String(item?.type || label),
      isM3U8,
      isDub: category === "dub"
    };
  }).filter(item => item.url);
}

function normaliseTracks(rows) {
  return (Array.isArray(rows) ? rows : []).filter(item => item && item.lang !== "thumbnails" && item.kind !== "thumbnails").map(item => ({
    url: String(item.url || item.file || ""),
    lang: String(item.lang || item.label || "Subtitles"),
    type: "subtitles"
  })).filter(item => item.url);
}

async function streams(req, animeId, episodeId, anilistId, serverName, category) {
  const lang = category === "dub" ? "dub" : "sub";
  const actualEpisodeId = safeEpisodeId(animeId, episodeId);
  const server = String(serverName || "hd-1");
  try {
    const url = new URL(API_BASE + "/episode/sources");
    url.searchParams.set("animeEpisodeId", actualEpisodeId);
    url.searchParams.set("server", server);
    url.searchParams.set("category", lang);
    const payload = await requestJson(url.toString(), 12000);
    const data = payload?.data;
    const sources = normaliseSources(req, data?.sources, lang, server);
    if (sources.length) {
      return {
        sources,
        tracks: normaliseTracks(data.tracks || data.subtitles),
        servers: fallbackServers(),
        intro: data.intro || null,
        outro: data.outro || null
      };
    }
  } catch (_) {}

  const mappedId = await resolveAniListId(animeId, anilistId);
  if (!mappedId) throw new Error("HiAnime source API is unavailable and the episode could not be mapped to AniList.");
  const episodeNo = String(episodeId).match(/(\d+(?:\.\d+)?)(?!.*\d)/)?.[1] || "1";
  const requested = server.toLowerCase();
  const paths = [];
  if (requested.includes("hianime") || requested.includes("hd-2")) {
    paths.push("hianime/anime/" + mappedId + "/" + episodeNo + "/" + lang + "/hd-2");
  } else if (requested.includes("megaplay")) {
    paths.push("animehub/" + mappedId + "/" + episodeNo + "/" + lang);
  } else {
    paths.push("aniwave_hls/" + mappedId + "/" + episodeNo + "/" + lang);
  }
  paths.push("aniwave_hls/" + mappedId + "/" + episodeNo + "/" + lang);
  paths.push("hianime/anime/" + mappedId + "/" + episodeNo + "/" + lang + "/hd-2");
  paths.push("animehub/" + mappedId + "/" + episodeNo + "/" + lang);

  try {
    return await Promise.any([...new Set(paths)].map(async path => {
      const data = await fetchVidNest(path);
      const raw = data?.sources || data?.multiSrc || [];
      const parsed = normaliseSources(req, raw, lang, path.startsWith("aniwave") ? "AniWave" : path.startsWith("hianime") ? "HiAnime HD-2" : "MegaPlay");
      if (!parsed.length) throw new Error("No streams returned");
      return {
        sources: parsed,
        tracks: normaliseTracks(data.subtitles || data.tracks),
        servers: fallbackServers(),
        intro: data.intro || null,
        outro: data.outro || null
      };
    }));
  } catch (error) {
    const reasons = Array.isArray(error?.errors) ? error.errors : [];
    const detail = reasons.map(item => item?.message).filter(Boolean).slice(0, 2).join("; ");
    throw new Error("HiAnime stream resolution failed" + (detail ? ": " + detail : ""));
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET" });
  try {
    const action = String(req.query.action || "");
    if (action === "search") {
      const query = String(req.query.query || "").trim().slice(0, 100);
      if (!query) return send(res, 400, { error: "A search query is required" });
      const page = Math.max(1, Math.min(20, Number.parseInt(req.query.page || "1", 10) || 1));
      return send(res, 200, await search(query, page));
    }
    if (action === "episodes") {
      return send(res, 200, await episodes(String(req.query.id || ""), String(req.query.anilistId || "")));
    }
    if (action === "servers") {
      const result = await servers(String(req.query.id || ""), String(req.query.episodeId || ""), String(req.query.category || "sub"));
      return send(res, 200, result);
    }
    if (action === "streams") {
      const result = await streams(
        req,
        String(req.query.id || ""),
        String(req.query.episodeId || ""),
        String(req.query.anilistId || ""),
        String(req.query.server || "hd-1"),
        String(req.query.category || "sub")
      );
      return send(res, 200, result);
    }
    return send(res, 400, { error: "Unknown HiAnime action" });
  } catch (error) {
    return send(res, 502, { error: error?.message || "HiAnime is temporarily unavailable" });
  }
}
