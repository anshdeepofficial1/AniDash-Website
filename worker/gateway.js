// AniDash Gateway — a tiny Cloudflare Worker (free plan) that makes AniDash's provider *API / playlist* requests
// from Cloudflare's network instead of Vercel's. It stores nothing, hosts no media and has no episode data.
//
// Guard rails: shared-secret auth, GET only, HTTPS only, fixed host allowlist, manual redirect following
// (each hop re-checked), response size cap, no cookies forwarded, no request logging.
// Video segments are NOT proxied here (they would exhaust the free request quota); AniDash's /api/media handles those.

export const ALLOWED = [
  "justanime.to", "animetsu.net", "animetsu.live", "mega-cloud.top", "hianime.to",
  "shonenx-aniwatch-instance.vercel.app", "anidashweb.vercel.app", "api.ani.zip",
  "animepahe.pw", "anikoto.pw", "anikoto.net", "anikoto.me", "anikoto.cz", "anikototv.to", "anikototv.se", "anikototvapi.vercel.app",
  "kwik.cx", "kwik.si", "kwik.to", "kwik.li",
  "megaplay.buzz", "megavid.buzz", "anixo.buzz", "animex.one", "zokoanime.video", "animegg.org", "vidnest.fun", "animehindi.fun",
  "megacloud.blog", "megacloud.tv", "rapid-cloud.co", "rapid-cloud.ru",
]
const FORWARD = ["referer", "origin", "user-agent", "accept", "accept-language", "range"]
const MAX_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 3

export const hostAllowed = host => { host = String(host || "").toLowerCase(); return ALLOWED.some(d => host === d || host.endsWith("." + d)) }
export function parseTarget(raw) {
  let u; try { u = new URL(String(raw)) } catch { return null }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null
  return hostAllowed(u.hostname) ? u : null
}
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "")
  let d = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return d === 0
}
const reply = (status, msg) => new Response(JSON.stringify({ error: msg }), { status, headers: { "content-type": "application/json", "x-gw-error": "1", "cache-control": "no-store" } })

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return reply(405, "GET only")
    if (!env.GATEWAY_KEY || !safeEqual(request.headers.get("x-anidash-key"), env.GATEWAY_KEY)) return reply(401, "unauthorized")
    let target = parseTarget(new URL(request.url).searchParams.get("url"))
    if (!target) return reply(400, "target not allowed")
    const headers = new Headers()
    for (const name of FORWARD) { const v = request.headers.get("x-fwd-" + name); if (v && v.length <= 600) headers.set(name, v) }
    if (!headers.has("user-agent")) headers.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
    try {
      let res
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        res = await fetch(target.toString(), { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(12000) })
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          const next = parseTarget(new URL(res.headers.get("location"), target).toString())
          if (!next) return reply(502, "redirect target not allowed")
          target = next; continue
        }
        break
      }
      const len = Number(res.headers.get("content-length") || 0)
      if (len > MAX_BYTES) return reply(502, "response too large")
      const buf = await res.arrayBuffer()
      if (buf.byteLength > MAX_BYTES) return reply(502, "response too large")
      const out = new Headers({ "cache-control": "no-store", "x-gw-upstream": String(res.status) })
      const ct = res.headers.get("content-type"); if (ct) out.set("content-type", ct)
      return new Response(buf, { status: res.status, headers: out })
    } catch (e) {
      return reply(504, "upstream unreachable: " + String(e?.message || e).slice(0, 80))
    }
  },
}
