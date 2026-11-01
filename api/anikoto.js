const DEFAULT_SITE_BASES = [
  "https://anikototv.to",
  "https://anikoto.cz",
  "https://anikoto.me",
  "https://anikoto.net",
  "https://anikototv.se"
];
const SITE_BASES = [
  process.env.ANIKOTO_BASE_URL
    ? String(process.env.ANIKOTO_BASE_URL).replace(/\/$/, "")
    : null,
  ...DEFAULT_SITE_BASES
].filter((value, index, rows) => value && rows.indexOf(value) === index);
const API_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36";
const KWIK_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, s-maxage=25, stale-while-revalidate=90"
};

function send(res, status, body, cacheControl) {
  Object.entries(jsonHeaders).forEach(([key, value]) => res.setHeader(key, value));
  if (cacheControl) res.setHeader("Cache-Control", cacheControl);
  return res.status(status).json(body);
}

function siteHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function isAnikotoHost(url) {
  const host = siteHost(url);
  return SITE_BASES.some(base => {
    const domain = siteHost(base);
    return host === domain || host.endsWith("." + domain);
  });
}

async function requestText(url, headers = {}, timeout = 7000) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": API_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      Cookie: "__ddg1=;__ddg2_=",
      Referer: SITE_BASES[0] + "/",
      ...headers
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error("AniKoto returned HTTP " + response.status);
  const finalUrl = response.url || url;
  if (!isAnikotoHost(finalUrl)) throw new Error("AniKoto redirected to an unsupported host");
  return { text: await response.text(), url: finalUrl };
}

async function requestJson(url, headers = {}, timeout = 7000) {
  const result = await requestText(url, { Accept: "application/json, text/plain, */*", ...headers }, timeout);
  const payload = JSON.parse(result.text);
  if (!payload || payload.error) throw new Error(payload?.error || "Invalid AniKoto response");
  return payload;
}

function makeApiUrl(base, params) {
  const url = new URL(base + "/api");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.toString();
}

async function requestAcrossSites(params) {
  try {
    return await Promise.any(SITE_BASES.map(async base => {
      const payload = await requestJson(makeApiUrl(base, params), { Referer: base + "/" }, 4500);
      return { payload, base };
    }));
  } catch (error) {
    const reasons = Array.isArray(error?.errors) ? error.errors : [];
    const detail = reasons.map(item => item?.message).filter(Boolean).slice(0, 2).join("; ");
    throw new Error("All verified AniKoto mirrors failed" + (detail ? ": " + detail : ""));
  }
}

function normalizeTitle(item) {
  return {
    id: String(item?.session || item?.id || ""),
    title: String(item?.title || item?.name || "Unknown"),
    image: String(item?.poster || item?.image || item?.cover || ""),
    type: String(item?.type || ""),
    year: item?.year ?? "",
    episodes: item?.episodes ?? null
  };
}

async function search(query) {
  let clean = String(query || "").replace(/-/g, " ");
  const normalized = clean.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized === "one piece the movie") clean = "One Piece Movie 1";
  const { payload } = await requestAcrossSites({ m: "search", q: clean });
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return { results: rows.map(normalizeTitle).filter(item => item.id && item.title !== "Unknown") };
}

async function episodes(animeId) {
  const session = String(animeId || "").trim();
  if (!/^[\w-]{1,160}$/.test(session)) throw new Error("Invalid AniKoto anime ID");

  let firstResult;
  try {
    firstResult = await Promise.any(SITE_BASES.map(async base => {
      const payload = await requestJson(
        makeApiUrl(base, { m: "release", id: session, sort: "episode_asc" }),
        { Referer: base + "/" },
        4500
      );
      if (!Array.isArray(payload.data)) throw new Error("AniKoto mirror did not return an episode array");
      return { payload, base };
    }));
  } catch (error) {
    const reasons = Array.isArray(error?.errors) ? error.errors : [];
    const detail = reasons.map(item => item?.message).filter(Boolean).slice(0, 2).join("; ");
    throw new Error("AniKoto episode list is unavailable on verified mirrors" + (detail ? ": " + detail : ""));
  }

  const allRows = [...firstResult.payload.data];
  const lastPage = Math.min(30, Math.max(1, Number(firstResult.payload.last_page || 1)));
  if (lastPage > 1) {
    const pages = await Promise.all(Array.from({ length: lastPage - 1 }, (_, index) =>
      requestJson(
        makeApiUrl(firstResult.base, { m: "release", id: session, sort: "episode_asc", page: index + 2 }),
        { Referer: firstResult.base + "/" },
        4500
      ).catch(() => null)
    ));
    pages.filter(Boolean).forEach(page => { if (Array.isArray(page.data)) allRows.push(...page.data); });
  }

  const flattened = allRows.flat();
  const rows = flattened.map((item, index) => {
    const epSession = String(item?.session || "");
    const rawNumber = Number(item?.episode);
    const number = Number.isFinite(rawNumber) && rawNumber > 0 ? rawNumber : index + 1;
    return {
      id: session + "+" + epSession,
      number,
      title: String(item?.title || "").trim() || "Episode " + number,
      thumbnail: String(item?.snapshot || ""),
      date: "",
      isFiller: Number(item?.filler || 0) !== 0
    };
  }).filter(item => item.id.endsWith("+") === false);
  rows.sort((a, b) => a.number - b.number);
  const unique = new Map();
  rows.forEach(item => { if (!unique.has(item.number)) unique.set(item.number, item); });
  const episodes = [...unique.values()];
  return { episodes, totalEpisodes: episodes.length };
}

function readAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^{}()|[\]\\]/g, "\\$&");
  const match = String(tag).match(new RegExp("(?:^|\\s)" + escaped + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function decodeHtml(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function base62ToNumber(value) {
  let number = 0;
  for (const char of String(value)) {
    const index = KWIK_ALPHABET.indexOf(char);
    if (index < 0) return Number.NaN;
    number = number * KWIK_ALPHABET.length + index;
  }
  return number;
}

function unpackPacker(script) {
  const match = String(script).match(/\}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!match) throw new Error("The Kwik player no longer uses the expected packed-script format");
  const payload = match[1].replace(/\\\\/g, "\\").replace(/\\'/g, "'");
  const symbolTable = match[4].split("|");
  return payload.replace(/\b\w+\b/g, word => {
    const index = base62ToNumber(word);
    return Number.isFinite(index) && index < symbolTable.length && symbolTable[index] ? symbolTable[index] : word;
  });
}

async function extractKwik(link, base) {
  let parsed;
  try { parsed = new URL(link, base); } catch { throw new Error("The AniKoto player returned an invalid Kwik URL"); }
  const kwikHosts = ["kwik.cx", "kwik.si", "kwik.to", "kwik.li"];
  const isKwikHost = host => kwikHosts.some(domain => host === domain || host.endsWith("." + domain));
  if (parsed.protocol !== "https:" || !isKwikHost(parsed.hostname)) {
    if (/\.(?:m3u8|mp4)(?:$|\?)/i.test(parsed.pathname + parsed.search)) {
      return { url: parsed.toString(), isM3U8: /\.m3u8/i.test(parsed.pathname), quality: "Auto" };
    }
    throw new Error("AniKoto returned a video host that is not in the Kwik allow-list");
  }
  const response = await fetch(parsed.toString(), {
    headers: { "User-Agent": API_USER_AGENT, Accept: "text/html,*/*", Referer: "https://animepahe.pw/" },
    redirect: "follow",
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error("Kwik returned HTTP " + response.status);
  const pageUrl = response.url || parsed.toString();
  const finalUrl = new URL(pageUrl);
  if (finalUrl.protocol !== "https:" || !isKwikHost(finalUrl.hostname)) {
    throw new Error("Kwik redirected to an unsupported host");
  }
  const pageHtml = await response.text();
  const scripts = [...pageHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  let streamUrl = "";
  for (const script of scripts) {
    if (!/eval\s*\(\s*function\s*\(p,a,c,k,e,d\)/.test(script)) continue;
    try {
      const unpacked = unpackPacker(script);
      const found = unpacked.match(/(?:const|let|var)\s+source\s*=\s*['"]([^'"]+\.m3u8(?:\?[^'"]*)?)['"]/i)
        || unpacked.match(/(?:file|src)\s*:\s*['"]([^'"]+\.m3u8(?:\?[^'"]*)?)['"]/i);
      if (found) { streamUrl = decodeHtml(found[1]).replace(/[{}]/g, ""); break; }
    } catch (_) {}
  }
  if (!streamUrl) throw new Error("Could not extract a browser-playable stream from Kwik");
  const source = new URL(streamUrl, pageUrl);
  if (source.protocol !== "https:") throw new Error("Kwik returned an insecure media URL");
  return { url: source.toString(), isM3U8: /\.m3u8(?:$|\?)/i.test(source.toString()), quality: "Auto" };
}


function mediaUrl(req, raw, isHls, playbackHeaders = {}) {
  try {
    const target = new URL(String(raw));
    if (target.protocol !== "https:") return target.toString();
    const hosts = ["neko.justanime.to", "nexabloom.top", "give6beforegtav.site", "kwik.cx", "kwik.si", "kwik.to", "kwik.li", "norami.top", "kryntal.top", "akirax.buzz", "vid-tube.site"];
    if (!hosts.some(host => target.hostname === host || target.hostname.endsWith("." + host))) return target.toString();
    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
    if (!host) return target.toString();
    const safeHeaders = {};
    for (const [key, value] of Object.entries(playbackHeaders || {})) {
      if (/^(referer|origin|user-agent|accept)$/i.test(key) && typeof value === "string" && value.length <= 600) {
        safeHeaders[key.toLowerCase()] = value;
      }
    }
    const headerParam = Object.keys(safeHeaders).length ? "&headers=" + encodeURIComponent(JSON.stringify(safeHeaders)) : "";
    return proto + "://" + host + "/api/media?url=" + encodeURIComponent(target.toString()) + "&hls=" + (isHls ? "1" : "0") + headerParam;
  } catch {
    return String(raw || "");
  }
}

async function streams(req, animeSession, episodeId, category) {
  const parts = String(episodeId || "").split("+");
  if (parts.length !== 2 || parts[0] !== String(animeSession) || !parts[1]) {
    throw new Error("AniKoto episode session is missing. Reload the episode list and try again.");
  }
  const pageResult = await Promise.any(SITE_BASES.map(async candidateBase => {
    const playUrl = new URL(candidateBase + "/play/" + encodeURIComponent(parts[0]) + "/" + encodeURIComponent(parts[1]));
    const page = await requestText(playUrl.toString(), { Referer: candidateBase + "/" }, 3500);
    return { base: candidateBase, page };
  })).catch(error => {
    const reasons = Array.isArray(error?.errors) ? error.errors : [];
    const detail = reasons.map(item => item?.message).filter(Boolean).slice(0, 2).join("; ");
    throw new Error("AniKoto player page unavailable on verified mirrors" + (detail ? ": " + detail : ""));
  });
  const base = pageResult.base;
  const page = pageResult.page;
  const menu = page.text;
  const buttons = [...menu.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map(match => ({
    tag: match[0].match(/^<button\b[^>]*>/i)?.[0] || match[0],
    text: match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  }));
  const requestDub = category === "dub";
  const candidates = buttons.map(button => {
    const link = decodeHtml(readAttribute(button.tag, "data-src"));
    const audio = String(readAttribute(button.tag, "data-audio")).toLowerCase();
    const resolution = readAttribute(button.tag, "data-resolution");
    return { link, isDub: audio === "eng", quality: resolution ? resolution + "p" : (button.text || "Auto") };
  }).filter(item => item.link && item.isDub === requestDub);
  if (!candidates.length) throw new Error("AniKoto has no " + (requestDub ? "DUB" : "SUB") + " stream listed for this episode");

  const resolved = await Promise.allSettled(candidates.map(async candidate => {
    const extracted = await extractKwik(candidate.link, base);
    const isM3U8 = extracted.isM3U8;
    return {
      url: mediaUrl(req, extracted.url, isM3U8, {
        Referer: "https://kwik.cx/",
        Origin: "https://kwik.cx",
        "User-Agent": API_USER_AGENT,
        Accept: "*/*"
      }),
      originalUrl: extracted.url,
      quality: candidate.quality || extracted.quality || "Auto",
      type: "Kwik",
      isM3U8,
      isDub: requestDub
    };
  }));
  const sources = resolved.filter(item => item.status === "fulfilled").map(item => item.value);
  if (!sources.length) {
    const failure = resolved.find(item => item.status === "rejected")?.reason;
    throw new Error(failure?.message || "AniKoto stream extraction failed");
  }
  return {
    sources,
    tracks: [],
    servers: [{ id: "anikoto", name: "AniKoto • Kwik" }],
    intro: null,
    outro: null
  };
}

async function getAniKotoEmbedFallback(anilistId, malId, episode, category) {
  if (!/^\d+$/.test(anilistId) && !/^\d+$/.test(malId)) return [];
  const safeEpisode = Math.max(1, Math.min(9999, Number.parseInt(episode, 10) || 1));
  const endpoint = new URL("https://anikototvapi.vercel.app/api/stream/embeds");
  if (/^\d+$/.test(anilistId)) endpoint.searchParams.set("anilist", anilistId);
  if (/^\d+$/.test(malId)) endpoint.searchParams.set("mal", malId);
  endpoint.searchParams.set("ep", String(safeEpisode));
  endpoint.searchParams.set("lang", category === "dub" ? "dub" : "sub");

  const response = await fetch(endpoint.toString(), {
    headers: { Accept: "application/json", "User-Agent": API_USER_AGENT },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error("AniKoto embed fallback returned HTTP " + response.status);
  const payload = await response.json();
  const rows = Array.isArray(payload?.results?.providers) ? payload.results.providers : [];
  const allowed = new Set(["megaplay.buzz", "anixo.buzz", "megavid.buzz"]);
  return rows.map(item => {
    let url;
    try { url = new URL(String(item?.url || "")); } catch { return null; }
    if (url.protocol !== "https:" || !allowed.has(url.hostname.toLowerCase())) return null;
    return {
      id: String(item.id || url.hostname),
      name: String(item.name || item.id || "AniKoto partner"),
      url: url.toString(),
      type: "embed",
      isEmbed: true,
      iframeReady: true,
      isDub: category === "dub"
    };
  }).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET" });
  try {
    const action = String(req.query.action || "");
    if (action === "search") {
      const query = String(req.query.query || "").trim().slice(0, 100);
      if (!query) return send(res, 400, { error: "A search query is required" });
      return send(res, 200, await search(query));
    }
    if (action === "episodes") {
      return send(res, 200, await episodes(req.query.id));
    }
    if (action === "servers") {
      return send(res, 200, { servers: [{ id: "anikoto", name: "AniKoto • Kwik" }] });
    }
    if (action === "streams") {
      const category = req.query.category === "dub" ? "dub" : "sub";
      const embedTask = getAniKotoEmbedFallback(
        String(req.query.anilistId || ""),
        String(req.query.malId || ""),
        String(req.query.episode || "1"),
        category
      ).catch(() => []);
      try {
        const resolved = await streams(req, req.query.id, req.query.episodeId, category);
        const embeds = await embedTask;
        return send(res, 200, { ...resolved, embeds }, "no-store");
      } catch (streamError) {
        const embeds = await embedTask;
        if (embeds.length) {
          return send(res, 200, {
            sources: [],
            embeds,
            fallback: true,
            fallbackReason: streamError?.message || "AniKoto direct stream extraction was blocked"
          }, "no-store");
        }
        throw streamError;
      }
    }
    return send(res, 400, { error: "Unknown AniKoto action" });
  } catch (error) {
    return send(res, 502, { error: error?.message || "AniKoto is temporarily unavailable" });
  }
}
