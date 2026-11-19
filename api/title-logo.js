// Title logo (clear-logo) lookup for the player loading animation.
// Needs a free TMDB API key in the TMDB_API_KEY environment variable; without it the app
// falls back to an animated text wordmark of the title.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=2592000");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const key = String(process.env.TMDB_API_KEY || "").trim();
  const title = String(req.query.title || "").trim().slice(0, 150);
  const kind = req.query.kind === "movie" ? "movie" : "tv";
  if (!key || !title) return res.status(200).json({ logo: null });
  const auth = key.length > 60 ? { headers: { Authorization: "Bearer " + key } } : {};
  const q = key.length > 60 ? "" : "&api_key=" + encodeURIComponent(key);
  try {
    const get = async url => {
      const r = await fetch(url, { ...auth, signal: AbortSignal.timeout(6000) });
      return r.ok ? r.json() : null;
    };
    const base = "https://api.themoviedb.org/3";
    const found = await get(`${base}/search/${kind}?query=${encodeURIComponent(title)}${q}`);
    const hit = found?.results?.[0];
    if (!hit) return res.status(200).json({ logo: null });
    const imgs = await get(`${base}/${kind}/${hit.id}/images?include_image_language=en,ja,null${q}`);
    const logos = (imgs?.logos || []).filter(l => l.file_path && !l.file_path.endsWith(".svg"));
    logos.sort((a, b) => (b.iso_639_1 === "en") - (a.iso_639_1 === "en") || b.vote_average - a.vote_average);
    const best = logos[0];
    return res.status(200).json({ logo: best ? "https://image.tmdb.org/t/p/w500" + best.file_path : null });
  } catch {
    return res.status(200).json({ logo: null });
  }
}
