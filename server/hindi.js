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

export const hostLabel = url => { try { const p = new URL(url).hostname.replace(/^www\./, "").split("."); const n = p.length > 2 && p[0] === "cloudy" ? p[0] : p[0]; return n.charAt(0).toUpperCase() + n.slice(1); } catch { return "Player"; } };

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

const WORD_SEASONS = { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };

// "Season 2", "2nd Season", "Third Season", "S2" anywhere in the titles.
export function seasonFromTitles(titles) {
  for (const t of titles) {
    const s = String(t || "");
    let m = s.match(/season\s*(\d{1,2})/i) || s.match(/(\d{1,2})(?:st|nd|rd|th)\s+season/i) || s.match(/\bs(\d{1,2})\b/i);
    if (m) return +m[1];
    m = s.match(/\b(second|third|fourth|fifth|sixth)\s+season/i);
    if (m) return WORD_SEASONS[m[1].toLowerCase()];
  }
  return 0;
}

// Series name without the season or subtitle: "Dr. Stone: Stone Wars" -> "Dr. Stone".
export const baseTitle = t => String(t || "")
  .replace(/\((?:tv|\d{4})\)/gi, " ")
  .replace(/\b(?:the\s+)?final\s+season\b/gi, " ")
  .replace(/\b\d{1,2}(?:st|nd|rd|th)\s+season\b/gi, " ")
  .replace(/\bseason\s*\d{1,2}\b/gi, " ")
  .replace(/\bpart\s*\d{1,2}\b/gi, " ")
  .split(/\s*[:\u2013\u2014]\s+|\s+-\s+/)[0]
  .trim();

export function candidateUrls(titles, movie) {
  const slugs = [];
  for (const t of titles) for (const s of [slugify(t), slugify(baseTitle(t))]) if (s && !slugs.includes(s)) slugs.push(s);
  const urls = [];
  for (const s of slugs) {
    if (movie) urls.push(`${SITE}/movies/${s}`, `${SITE}/movies/${s}-hindi-dub`);
    urls.push(`${SITE}/series/${s}`, `${SITE}/series/${s}-hindi-dub`);
  }
  return urls.slice(0, 14);
}

async function findSeries(titles, movie) {
  const urls = candidateUrls(titles, movie);
  const pages = await Promise.all(urls.map(page));
  for (let i = 0; i < urls.length; i++) {
    const html = pages[i];
    if (html && (episodeLinks(html).length || embedLinks(html).length)) return { url: urls[i], html };
  }
  return null;
}

// Pick which site season an AniList entry corresponds to. Returns the episode page URL or null.
export function pickEpisode(lists, { explicit = 0, total = 0, episode = 1, baseTitleHasSubtitle = false }) {
  const seasons = [...lists.keys()].sort((a, b) => a - b);
  if (!seasons.length) return null;
  const at = s => lists.get(s)?.[episode - 1] || null;
  if (seasons.length === 1) return at(seasons[0]);
  if (explicit && lists.has(explicit)) return at(explicit);
  const all = seasons.flatMap(s => lists.get(s));
  const biggest = Math.max(...seasons.map(s => lists.get(s).length));
  if (!total || total > biggest) return all.filter((u, i, a) => a.indexOf(u) === i)[episode - 1] || null; // long runner, absolute numbering
  const matches = seasons.filter(s => lists.get(s).length === total);
  if (matches.length === 1) return at(matches[0]);
  if (!matches.length && !baseTitleHasSubtitle && total <= lists.get(seasons[0]).length) return at(seasons[0]);
  if (matches.length > 1 && !baseTitleHasSubtitle) return at(matches[0]);
  return null; // ambiguous: better no Hindi button than the wrong season
}

async function resolveEpisodeUrl(series, opts) {
  const seasons = [...new Set([...series.html.matchAll(/[?&]season=(\d{1,2})/g)].map(m => +m[1]))].sort((a, b) => a - b);
  const lists = new Map();
  if (seasons.length <= 1) lists.set(seasons[0] || 1, episodeLinks(series.html));
  else {
    const pagesBySeason = await Promise.all(seasons.slice(0, 25).map(async s => [s, episodeLinks(await page(`${series.url}?season=${s}`))]));
    for (const [s, l] of pagesBySeason) if (l.length) lists.set(s, l);
  }
  return pickEpisode(lists, opts);
}

export async function hindiHandler(req, res) {
  // Only a real hit is cached for long. An empty answer may come from a failed best-effort probe, so it
  // is re-checked after a minute instead of locking the language out for an hour.
  const cache = hit => res.setHeader("Cache-Control", hit ? "public, s-maxage=3600, stale-while-revalidate=86400" : "public, s-maxage=60");
  cache(false);
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const titles = [req.query.title, req.query.alt].map(x => String(x || "").slice(0, 150)).filter(Boolean);
  const total = Math.max(0, Math.min(5000, parseInt(req.query.total, 10) || 0));
  const episode = Math.max(1, Math.min(5000, parseInt(req.query.episode, 10) || 1));
  const movie = req.query.kind === "movie";
  const none = { sources: [], embeds: [], available: false };
  if (!titles.length) return res.status(200).json(none);
  try {
    const series = await findSeries(titles, movie);
    if (!series) return res.status(200).json(none);
    let epHtml = series.html;
    if (!movie || episodeLinks(series.html).length) {
      const epUrl = await resolveEpisodeUrl(series, { explicit: seasonFromTitles(titles), total, episode, baseTitleHasSubtitle: titles.some(t => baseTitle(t) !== String(t).trim()) });
      if (!epUrl) return res.status(200).json(none);
      epHtml = await page(epUrl);
    }
    const links = embedLinks(epHtml).slice(0, 4);
    const seen = {};
    const embeds = links.map(url => {
      const base = hostLabel(url);
      seen[base] = (seen[base] || 0) + 1;
      const name = seen[base] > 1 ? base + " " + seen[base] : base;
      return { id: "hi-" + name.toLowerCase().replace(/\s+/g, "-"), name, url, type: "embed", isEmbed: true, lang: "hi", langName: "Hindi" };
    });
    cache(embeds.length > 0);
    return res.status(200).json({ sources: [], embeds, available: embeds.length > 0 });
  } catch {
    return res.status(200).json(none);
  }
}
