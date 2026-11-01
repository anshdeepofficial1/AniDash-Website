const USER_AGENT = "Mozilla/5.0 (compatible; AniDashWatch/1.0; +https://anidashweb.vercel.app)";

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", status === 200 ? "public, s-maxage=3600, stale-while-revalidate=86400" : "no-store");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET" });
  const anilistId = String(req.query.anilistId || "").trim();
  if (!/^\d{1,12}$/.test(anilistId)) return send(res, 400, { error: "A numeric AniList ID is required" });

  try {
    const url = "https://api.ani.zip/mappings?anilist_id=" + encodeURIComponent(anilistId);
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(6500)
    });
    if (!response.ok) return send(res, 502, { error: "AniList episode mapping returned HTTP " + response.status });
    const payload = await response.json();
    const raw = payload?.episodes && typeof payload.episodes === "object" ? payload.episodes : {};
    const episodes = Object.entries(raw).map(([key, value]) => {
      const number = Number(key);
      if (!Number.isFinite(number) || number <= 0 || !value || typeof value !== "object") return null;
      const titles = value.title && typeof value.title === "object" ? value.title : {};
      return {
        id: String(number),
        number,
        title: String(titles.en || titles["x-jat"] || titles.ja || "Episode " + number),
        thumbnail: String(value.image || ""),
        date: "",
        isFiller: false
      };
    }).filter(Boolean).sort((a, b) => a.number - b.number);
    if (!episodes.length) return send(res, 404, { error: "AniList has no episode mapping for this anime", anilistId });
    return send(res, 200, { anilistId, totalEpisodes: episodes.length, episodes });
  } catch (error) {
    return send(res, error?.name === "TimeoutError" || error?.name === "AbortError" ? 504 : 502, {
      error: error?.message || "AniList episode mapping is temporarily unavailable"
    });
  }
}
