// Animetsu provider (the same source the AniDash app uses as "Gojo"). Independent of JustAnime,
// so playback keeps working when JustAnime's origin is down.
const API = "https://animetsu.net/v2/api/anime";
const PROXY = "https://mega-cloud.top/proxy";
const SITE = "https://animetsu.live";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const HEADERS = { Accept: "application/json, text/plain, */*", Origin: SITE, Referer: SITE + "/", "User-Agent": UA };

async function getJson(url, timeout = 8000) {
  const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return JSON.parse(await response.text());
}

const absolute = value => {
  const url = String(value || "");
  return url.startsWith("/") ? PROXY + url : url;
};

function skip(range) {
  return range && Number(range.end) > Number(range.start) ? { start: Number(range.start), end: Number(range.end) } : null;
}

export function normalizeAnimetsu(json, serverName, category, mediaUrl) {
  const playback = { Referer: SITE + "/", Origin: SITE, "User-Agent": UA, Accept: "*/*" };
  const sources = (Array.isArray(json?.sources) ? json.sources : []).map(item => {
    const url = absolute(item?.url);
    const type = String(item?.type || "").toLowerCase();
    const isM3U8 = type.includes("m3u8") || type.includes("hls") || type.includes("mpegurl") || /\.m3u8(?:$|\?)/i.test(url);
    const quality = String(item?.quality || "Auto");
    return {
      url: mediaUrl(url, isM3U8, playback),
      originalUrl: url,
      quality: quality === "master" ? "Auto" : quality,
      server: "Animetsu" + (serverName ? " " + serverName : ""),
      serverId: "animetsu",
      type: "Animetsu",
      isM3U8,
      isDub: category === "dub"
    };
  }).filter(item => item.url);
  const tracks = (Array.isArray(json?.subs) ? json.subs : [])
    .map(sub => ({ url: absolute(sub?.url), lang: String(sub?.lang || "English"), type: "subtitles" }))
    .filter(sub => sub.url && !/thumb/i.test(sub.lang + sub.url));
  tracks.sort((a, b) => (/^english/i.test(b.lang) ? 1 : 0) - (/^english/i.test(a.lang) ? 1 : 0));
  return { sources, tracks, intro: skip(json?.skips?.intro), outro: skip(json?.skips?.ending) };
}

export async function animetsuStreams(id, episode, category, mediaUrl) {
  const cat = category === "dub" ? "dub" : "sub";
  let servers = [];
  try {
    const list = await getJson(`${API}/servers/${id}/${episode}`, 6000);
    servers = (Array.isArray(list) ? list : []).map(item => ({ id: String(item?.id || ""), name: String(item?.tip || item?.id || "") })).filter(item => item.id);
  } catch (_) { /* fall back to the default server below */ }

  const attempts = (servers.length ? servers.slice(0, 4) : [{ id: "", name: "" }]).map(async server => {
    const query = new URLSearchParams({ source_type: cat });
    if (server.id) query.set("server", server.id);
    const json = await getJson(`${API}/oppai/${id}/${episode}?${query}`);
    const block = normalizeAnimetsu(json, server.name, cat, mediaUrl);
    if (!block.sources.length) throw new Error("No " + cat.toUpperCase() + " streams");
    return block;
  });
  const settled = await Promise.allSettled(attempts);
  const blocks = settled.filter(item => item.status === "fulfilled").map(item => item.value);
  if (!blocks.length) throw new Error("Animetsu has no " + cat.toUpperCase() + " stream for this episode");
  const first = blocks[0];
  return {
    server: "Animetsu",
    serverId: "animetsu",
    sources: blocks.flatMap(block => block.sources),
    tracks: first.tracks,
    intro: first.intro,
    outro: first.outro,
    headers: {}
  };
}
