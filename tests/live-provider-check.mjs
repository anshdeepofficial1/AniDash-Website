// Optional live diagnostic against the real upstream. Never uses mock data.
// This is intentionally separate from deterministic unit tests: third-party
// hosts may fail from CI due to geo-blocks, anti-bot challenges or outages.
import justAnime from "../api/justanime.js";
import mediaProxy from "../api/media.js";

const mediaId = "21";   // One Piece (AniList)
const episode = "394";
const req = {
  method: "GET",
  query: { action: "streams", id: mediaId, episode, category: "dub", server: "auto" },
  headers: { host: "anidash-test.vercel.app", "x-forwarded-host": "anidash-test.vercel.app", "x-forwarded-proto": "https" }
};
const res = {
  statusCode: 200,
  headers: {},
  body: null,
  setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; }
};

console.log("Checking live One Piece episode 394 English dub server discovery...");
await justAnime(req, res);
const servers = Array.isArray(res.body?.servers) ? res.body.servers : [];
const sources = Array.isArray(res.body?.sources) ? res.body.sources : [];
// No raw stream URLs, cookies or tokens in build logs.
console.log(JSON.stringify({
  status: res.statusCode,
  category: "dub",
  episode: 394,
  sources: sources.length,
  serverLabels: servers.map(row => row.name),
  failure: res.statusCode !== 200 ? String(res.body?.error || "Upstream unavailable").slice(0, 350) : null
}, null, 2));
if (res.statusCode !== 200 || sources.length === 0) process.exitCode = 1;

// Resolve link metadata and probe each returned media response, not just the
// first mirror. A broken HLS host should not conceal a healthy MP4 fallback.
// Use HEAD in AniDash's proxy to avoid sending video bytes to CI.
let mediaReady = false;
for (const candidate of sources.slice(0, 6)) {
  if (!String(candidate.url || "").includes("/api/media?")) continue;
  const proxy = new URL(candidate.url);
  const mediaReq = {
    method: "HEAD",
    query: Object.fromEntries(proxy.searchParams.entries()),
    headers: { ...req.headers, ...(candidate.isM3U8 ? {} : { range: "bytes=0-0" }) }
  };
  const mediaRes = {
    statusCode: 200, headers: {}, body: null,
    setHeader(k,v) { this.headers[k.toLowerCase()] = v; },
    status(k) { this.statusCode = k; return this; },
    json(v) { this.body = v; return this; },
    send(v) { this.body = v; return this; },
    end() { return this; }
  };
  await mediaProxy(mediaReq, mediaRes);
  const kind = candidate.isM3U8 ? "HLS" : "MP4";
  const contentType = String(mediaRes.headers["content-type"] || "").toLowerCase();
  const validPlaylist = !candidate.isM3U8 || (
    contentType.includes("mpegurl") && String(mediaRes.body || "").startsWith("#EXTM3U")
  );
  const validMedia = (mediaRes.statusCode === 200 || mediaRes.statusCode === 206) &&
    validPlaylist && (candidate.isM3U8 || /video|octet-stream/.test(contentType));
  mediaReady ||= validMedia;
  console.log(JSON.stringify({
    mediaProbe: String(candidate.server || candidate.type || "server"),
    kind, status: mediaRes.statusCode,
    contentType: contentType || "none",
    validMedia,
    sourceHost: (() => { try { return new URL(candidate.originalUrl).hostname; } catch { return "invalid"; } })(),
    proxyError: mediaRes.statusCode >= 400 ? String(mediaRes.body?.error || "Upstream error").slice(0, 150) : null
  }));
}

// Diagnose redirect hosts and manifest format without logging signed URLs
// or fetching video bytes. These are upstream facts, not mocked availability.
for (const candidate of sources.slice(0, 4)) {
  try {
    const source = new URL(candidate.originalUrl);
    const hls = candidate.isM3U8 === true;
    const referer = /gigi/i.test(String(candidate.server)) ?
      "https://www.animegg.org/" : "https://megaplay.buzz/";
    const response = await fetch(source, {
      method: hls ? "GET" : "HEAD", redirect: "manual",
      headers: {
        Referer: referer,
        Origin: new URL(referer).origin,
        Accept: hls ? "application/vnd.apple.mpegurl,*/*" : "*/*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(4500)
    });
    const redirectTo = response.headers.get("location");
    const redirectHost = redirectTo
      ? new URL(redirectTo, source).hostname : null;
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    const text = hls && response.ok && /text|mpegurl|json/.test(type)
      ? await response.text() : "";
    console.log(JSON.stringify({
      upstreamProbe: String(candidate.server || "server"),
      sourceHost: source.hostname,
      status: response.status,
      type,
      redirectHost,
      manifest: text.startsWith("#EXTM3U"),
      textHint: text && !text.startsWith("#EXTM3U") ? text.slice(0, 55).replace(/https?:\/\/\S+/g, "[url]") : null
    }));
  } catch (error) {
    console.log(JSON.stringify({
      upstreamProbe: String(candidate.server || "server"),
      networkError: String(error?.message || error).slice(0, 100)
    }));
  }
}

if (!mediaReady) process.exitCode = 1;
