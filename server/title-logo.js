// Title logo (clear-logo) lookup for the player loading animation.
// 1) ani.zip mappings by AniList id (no key needed), 2) TMDB if TMDB_API_KEY is set,
// 3) otherwise the app falls back to an animated text wordmark of the title.
// Only found logos are cached for long; misses are cached briefly so a later fix shows up quickly.
const HIT = "public, s-maxage=604800, stale-while-revalidate=2592000";
const MISS = "public, s-maxage=300";
export async function titleLogoHandler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const send = logo => { res.setHeader("Cache-Control", logo ? HIT : MISS); return res.status(200).json({ logo }); };
  const aniId = /^\d{1,9}$/.test(String(req.query.id || "")) ? String(req.query.id) : "";
  if (aniId) {
    try {
      const r = await fetch("https://api.ani.zip/mappings?anilist_id=" + aniId, { signal: AbortSignal.timeout(6000) });
      const j = r.ok ? await r.json() : null;
      const logo = (Array.isArray(j?.images) ? j.images : []).find(i => /^clearlogo$/i.test(i?.coverType || "") && /^https:\/\//.test(i?.url || ""));
      if (logo) return send(logo.url);
    } catch { /* fall through to TMDB */ }
  }
  const key = String(process.env.TMDB_API_KEY || "").trim();
  const title = String(req.query.title || "").trim().slice(0, 150);
  const kind = req.query.kind === "movie" ? "movie" : "tv";
  if (!key || !title) return send(null);
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
    if (!hit) return send(null);
    const imgs = await get(`${base}/${kind}/${hit.id}/images?include_image_language=en,ja,null${q}`);
    const logos = (imgs?.logos || []).filter(l => l.file_path && !l.file_path.endsWith(".svg"));
    logos.sort((a, b) => (b.iso_639_1 === "en") - (a.iso_639_1 === "en") || b.vote_average - a.vote_average);
    const best = logos[0];
    return send(best ? "https://image.tmdb.org/t/p/w500" + best.file_path : null);
  } catch {
    return send(null);
  }
}
