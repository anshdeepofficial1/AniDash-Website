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

// A successful resolver response does not prove that the HLS playlist proxy
// can retrieve the media. Check one returned stream with the same code Vercel
// executes, without reading or logging copyrighted video bytes.
const hlsCandidate = sources.find(item => item.isM3U8 && String(item.url || "").includes("/api/media?"));
if (hlsCandidate) {
  const proxy = new URL(hlsCandidate.url);
  const mediaReq = {
    method: "HEAD",
    query: Object.fromEntries(proxy.searchParams.entries()),
    headers: { ...req.headers, range: "bytes=0-0" }
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
  const isPlaylist = String(mediaRes.headers["content-type"] || "").includes("mpegurl");
  const validPlaylist = isPlaylist && String(mediaRes.body || "").startsWith("#EXTM3U");
  console.log(JSON.stringify({
    mediaProbe: "HLS manifest",
    status: mediaRes.statusCode,
    contentType: String(mediaRes.headers["content-type"] || "none"),
    validPlaylist,
    sourceHost: (() => { try { return new URL(hlsCandidate.originalUrl).hostname; } catch { return "invalid"; } })(),
    proxyError: mediaRes.statusCode !== 200 ? String(mediaRes.body?.error || "Upstream error").slice(0, 200) : null
  }));
  if (mediaRes.statusCode !== 200 || !validPlaylist) process.exitCode = 1;
} else {
  console.log("HLS manifest probe skipped: no proxied HLS source was returned.");
}

