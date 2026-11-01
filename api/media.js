const ALLOWED_HOSTS = new Set([
  "neko.justanime.to",
  "nexabloom.top",
  "give6beforegtav.site",
  "megaplay.buzz",
  "zokoanime.video",
  "animegg.org",
  "kwik.cx",
  "kwik.si",
  "kwik.to",
  "kwik.li",
  "megacloud.blog",
  "megacloud.tv",
  "rapid-cloud.co",
  "rapid-cloud.ru",
  "vidnest.fun"
]);
const STREAM_PROXY_HOST = "neko.justanime.to";

function allowedHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return [...ALLOWED_HOSTS].some(domain => host === domain || host.endsWith("." + domain));
}

function safeTarget(raw) {
  const target = new URL(String(raw || ""));
  if (target.protocol !== "https:" || !allowedHost(target.hostname)) {
    throw new Error("Media host is not on AniDash's allow-list");
  }
  return target;
}

function unwrapExternalProxy(target) {
  if (target.hostname !== STREAM_PROXY_HOST || !target.pathname.includes("m3u8-proxy")) {
    return { target, original: null };
  }
  const raw = target.searchParams.get("url");
  if (!raw) throw new Error("The stream proxy URL is missing its media URL");
  const original = safeTarget(raw);
  let custom = {};
  try {
    custom = JSON.parse(target.searchParams.get("headers") || "{}");
  } catch (_) {}
  const safeHeaders = {};
  for (const [key, value] of Object.entries(custom)) {
    if (/^(referer|origin|user-agent|accept)$/i.test(key) && typeof value === "string" && value.length <= 500) {
      safeHeaders[key] = value;
    }
  }
  return { target: original, original, safeHeaders };
}

function headersFor(target, req, custom = {}) {
  const isJustAnime = target.hostname === "neko.justanime.to" || target.hostname.endsWith(".justanime.to");
  const isKwik = /^kwik\./i.test(target.hostname) || target.hostname.endsWith(".kwik.cx");
  const referer = custom.referer || custom.Referer || (isJustAnime ? "https://justanime.to/" : isKwik ? "https://kwik.cx/" : "https://" + target.hostname + "/");
  const origin = custom.origin || custom.Origin || (() => {
    try { return new URL(referer).origin; } catch { return "https://" + target.hostname; }
  })();
  const headers = {
    Accept: custom.accept || custom.Accept || "*/*",
    Origin: origin,
    Referer: referer,
    "User-Agent": custom["user-agent"] || custom["User-Agent"] || req.headers["user-agent"] || "Mozilla/5.0 AniDash-Web"
  };
  if (req.headers.range) headers.Range = req.headers.range;
  return headers;
}

async function fetchAllowed(target, req, custom = {}) {
  let current = target;
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (!allowedHost(current.hostname)) throw new Error("Media redirect left AniDash's allow-list");
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: headersFor(current, req, custom),
      signal: AbortSignal.timeout(22000)
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    current = safeTarget(new URL(location, current).toString());
  }
  throw new Error("Too many media redirects");
}

function getPublicBase(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) throw new Error("Could not determine the AniDash media proxy host");
  return protocol + "://" + host;
}

function proxyUrl(base, target, hls) {
  return base + "/api/media?url=" + encodeURIComponent(target.toString()) + "&hls=" + (hls ? "1" : "0");
}

function rewritePlaylist(playlist, baseUrl, publicBase) {
  let nextIsPlaylist = false;
  return playlist.split(/\r?\n/).map(line => {
    const value = line.trim();
    if (!value) return line;
    if (value.startsWith("#")) {
      const playlistTag = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF):/i.test(value);
      const rewritten = line.replace(/URI="([^"]+)"/g, (_, raw) => {
        let target;
        try { target = safeTarget(new URL(raw, baseUrl).toString()); } catch { return 'URI="' + raw.replace(/"/g, "") + '"'; }
        return 'URI="' + proxyUrl(publicBase, target, playlistTag) + '"';
      });
      nextIsPlaylist = /^#EXT-X-STREAM-INF:/i.test(value);
      return rewritten;
    }
    let target;
    try { target = safeTarget(new URL(value, baseUrl).toString()); }
    catch { return line; }
    const isPlaylist = nextIsPlaylist || /\.m3u8(?:$|\?)/i.test(target.pathname + target.search);
    nextIsPlaylist = false;
    return proxyUrl(publicBase, target, isPlaylist);
  }).join("\n");
}

async function pipeBody(response, res) {
  if (!response.body) return res.end();
  try {
    const { Readable } = await import("node:stream");
    Readable.fromWeb(response.body).pipe(res);
  } catch (_) {
    res.end(Buffer.from(await response.arrayBuffer()));
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ error: "Use GET or HEAD" });
  }
  try {
    const requested = safeTarget(req.query.url);
    const unwrapped = unwrapExternalProxy(requested);
    const target = unwrapped.target;
    const upstream = await fetchAllowed(target, req, unwrapped.safeHeaders || {});
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).end();
    }

    const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
    const isPlaylist = req.query.hls === "1" ||
      contentType.includes("mpegurl") ||
      /\.m3u8(?:$|\?)/i.test(target.pathname + target.search);

    if (isPlaylist) {
      const body = await upstream.text();
      if (!body.trim().startsWith("#EXTM3U")) {
        return res.status(502).json({ error: "The upstream did not return a valid HLS playlist" });
      }
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=5, s-maxage=5");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).send(rewritePlaylist(body, target, getPublicBase(req)));
    }

    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=120");
    res.status(upstream.status);
    if (req.method === "HEAD") return res.end();
    return pipeBody(upstream, res);
  } catch (error) {
    const status = /allow-list|invalid URL|protocol/i.test(error?.message || "") ? 403
      : error?.name === "TimeoutError" || error?.name === "AbortError" ? 504 : 400;
    return res.status(status).json({ error: error?.message || "Media proxy failed" });
  }
}
