/* Server-side catalogue aggregation. One cached HTTP request replaces the
   homepage's seven simultaneous AniList GraphQL calls. Public metadata only. */
const ANILIST_URL = "https://graphql.anilist.co";
const FIELDS = [
  "id idMal synonyms",
  "title { romaji english native }",
  "coverImage { extraLarge large medium }",
  "bannerImage format status episodes duration averageScore popularity",
  "genres season seasonYear startDate { year month day }",
  "nextAiringEpisode { episode airingAt timeUntilAiring }",
  "siteUrl isAdult"
].join(" ");
const HOME_SECTIONS = [
  ["trending", "TRENDING_DESC", ""],
  ["popular", "POPULARITY_DESC", ""],
  ["top", "SCORE_DESC", ""],
  ["airing", "TRENDING_DESC", ", status: RELEASING"],
  ["upcoming", "POPULARITY_DESC", ", status: NOT_YET_RELEASED"],
  ["movies", "POPULARITY_DESC", ", format: MOVIE"],
  ["hidden", "SCORE_DESC", ", averageScore_greater: 75, popularity_lesser: 35000"]
];
const homeQuery = "query HomeCatalogue { " + HOME_SECTIONS.map(([key,sort,extra]) =>
  key + ": Page(page:1,perPage:18) { media(type:ANIME,sort:" + sort +
  ",isAdult:false" + extra + ") { " + FIELDS + " } }"
).join("\n") + " }";
const searchQuery = "query SearchCatalogue($term:String!) { Page(page:1,perPage:24) { " +
  "media(type:ANIME,search:$term,sort:SEARCH_MATCH,isAdult:false) { " + FIELDS + " } } }";
const memory = new Map();
const inFlight = new Map();
const CACHE_MS = 4 * 60_000;
const STALE_MS = 24 * 60 * 60_000;

async function queryAniList(query, variables = {}) {
  const response = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(11500)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.errors) {
    const retry = Number(response.headers.get("retry-after") || 0);
    const error = new Error(response.status === 429 ? "AniList rate limit reached" : "AniList catalogue unavailable");
    error.retryAfter = Number.isFinite(retry) ? Math.min(120, Math.max(0, retry)) : 0;
    throw error;
  }
  if (!body?.data || typeof body.data !== "object") throw new Error("AniList returned an invalid catalogue");
  return body.data;
}
function requestOnce(key, query, variables) {
  if (inFlight.has(key)) return inFlight.get(key);
  const request = queryAniList(query, variables).then(data => {
    memory.set(key, { data, updatedAt: Date.now() });
    return { data, stale: false };
  }).catch(error => {
    const cached = memory.get(key);
    if (cached && Date.now() - cached.updatedAt < STALE_MS) {
      return { data: cached.data, stale: true };
    }
    throw error;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
function send(res, status, payload, ttl = 0) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", ttl
    ? "public, s-maxage=" + ttl + ", stale-while-revalidate=900"
    : "no-store");
  return res.status(status).json(payload);
}
export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });
  const kind = String(req.query?.view || "home").trim().toLowerCase();
  const search = kind === "search";
  if (kind !== "home" && !search) return send(res, 400, { error: "Invalid catalogue view" });
  const term = search ? String(req.query?.q || "").trim().slice(0, 80) : "";
  if (search && term.length < 2) return send(res, 400, { error: "Enter at least two characters" });
  const key = search ? "search:" + term.toLowerCase() : "home";
  const cached = memory.get(key);
  if (cached && Date.now() - cached.updatedAt < CACHE_MS)
    return send(res, 200, { ...cached.data, stale: false }, 180);
  try {
    const result = await requestOnce(key, search ? searchQuery : homeQuery, search ? { term } : {});
    if (search) {
      const media = result.data?.Page?.media;
      if (!Array.isArray(media)) throw new Error("Search response missing results");
      return send(res, 200, { media, stale: result.stale }, 90);
    }
    const sections = Object.fromEntries(HOME_SECTIONS.map(([name]) => [
      name, Array.isArray(result.data?.[name]?.media) ? result.data[name].media : []
    ]));
    if (!Object.values(sections).some(rows => rows.length)) throw new Error("Home catalogue response is empty");
    return send(res, 200, { sections, stale: result.stale }, 180);
  } catch (error) {
    const retry = Number(error.retryAfter || 0);
    if (retry) res.setHeader("Retry-After", String(retry));
    return send(res, 503, {
      error: retry ? "Anime catalogue is busy; saved titles remain available." : "Anime catalogue temporarily unavailable.",
      retryAfter: retry
    });
  }
}
