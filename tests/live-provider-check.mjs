// Optional live diagnostic against the real upstream. Never uses mock data.
// This is intentionally separate from deterministic unit tests: third-party
// hosts may fail from CI due to geo-blocks, anti-bot challenges or outages.
import justAnime from "../api/justanime.js";

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
