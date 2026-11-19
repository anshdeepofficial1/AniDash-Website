// Hindi dub sources from animehindi.fun. Best effort: when the title or episode cannot be matched the
// response is empty and the player simply shows no Hindi button.
const SITE = "https://animehindi.fun";
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const EMBED_HOSTS = /^(ravok\.buzz|rubystm\.com|vidmoly\.(me|to|net)|cloudy\.upns\.one|strmup\.\w+|turbovid\.\w+|turbo\w*\.\w+|streamruby\.\w+|moly\.\w+)$/i;

export const slugify = t => String(t || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/['’`]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function page(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(8000), redirect: "follow" });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

export const episodeLinks = html => {
  const out = [];
  for (const m of String(html || "").matchAll(/(?:https?:\/\/animehindi\.fun)?\/episodes\/[a-z0-9][a-z0-9-]*/gi)) {
    const u = m[0].startsWith("http") ? m[0] : SITE + m[0];
    if (!out.includes(u)) out.push(u);
  }
  return out;
};

export const embedLinks = html => {
  const out = [];
  for (const m of String(html || "").matchAll(/https?:\/\/[^\s"'<>)\\]+/gi)) {
    let u;
    try { u = new URL(m[0]); } catch { continue; }
    if (!EMBED_HOSTS.test(u.hostname) || /\/d\/|[?&#]dl=|download|\/file\//i.test(m[0])) continue;
    if (!out.includes(u.href)) out.push(u.href);
  }
  return out;
};

async function findSeries(titles, movie) {
  const slugs = [...new Set(titles.map(slugify).filter(Boolean))];
  const tries = [];
  for (const s of slugs) {
    if (movie) tries.push(`${SITE}/movies/${s}`, `${SITE}/movies/${s}-hindi-dub`);
    tries.push(`${SITE}/series/${s}`, `${SITE}/series/${s}-hindi-dub`);
  }
  for (const url of tries.slice(0, 10)) {
    const html = await page(url);
    if (html && (episodeLinks(html).length || embedLinks(html).length)) return { url, html };
  }
  return null;
}

async function resolveEpisodeUrl(series, episode) {
  const seasons = [...new Set([...series.html.matchAll(/[?&]season=(\d{1,2})/g)].map(m => +m[1]))].sort((a, b) => a - b);
  if (seasons.length <= 1) return episodeLinks(series.html)[episode - 1] || null;
  const lists = await Promise.all(seasons.slice(0, 25).map(async s => episodeLinks(await page(`${series.url}?season=${s}`))));
  return lists.flat().filter((u, i, a) => a.indexOf(u) === i)[episode - 1] || null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const titles = [req.query.title, req.query.alt].map(x => String(x || "").slice(0, 150)).filter(Boolean);
  const episode = Math.max(1, Math.min(5000, parseInt(req.query.episode, 10) || 1));
  const movie = req.query.kind === "movie";
  const none = { sources: [], embeds: [], available: false };
  if (!titles.length) return res.status(200).json(none);
  try {
    const series = await findSeries(titles, movie);
    if (!series) return res.status(200).json(none);
    let epHtml = series.html;
    if (!movie || episodeLinks(series.html).length) {
      const epUrl = await resolveEpisodeUrl(series, episode);
      if (!epUrl) return res.status(200).json(none);
      epHtml = await page(epUrl);
    }
    const embeds = embedLinks(epHtml).slice(0, 4).map((url, i) => ({ id: "hindi-" + (i + 1), name: "Hindi " + (i + 1), url, type: "embed", isEmbed: true, isDub: true, lang: "hi" }));
    return res.status(200).json({ sources: [], embeds, available: embeds.length > 0 });
  } catch {
    return res.status(200).json(none);
  }
}
