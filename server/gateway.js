// Routes provider API/playlist requests through the optional Cloudflare gateway (worker/gateway.js).
// Enabled only when GATEWAY_URL and GATEWAY_KEY are set in Vercel. If the gateway itself is down, falls back to a direct request.
const FORWARD = ["referer", "origin", "user-agent", "accept", "accept-language", "range"]

export function gatewayConfigured(env = process.env) { return !!(env.GATEWAY_URL && env.GATEWAY_KEY) }

export async function gatewayFetch(url, init = {}, env = process.env, doFetch = fetch) {
  if (!gatewayConfigured(env)) return doFetch(url, init)
  let base
  try { base = new URL(env.GATEWAY_URL); if (base.protocol !== "https:") throw new Error("not https") } catch { return doFetch(url, init) }
  const headers = { "x-anidash-key": env.GATEWAY_KEY }
  const given = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : (init.headers || {})
  for (const [k, v] of Object.entries(given)) if (FORWARD.includes(k.toLowerCase()) && typeof v === "string") headers["x-fwd-" + k.toLowerCase()] = v
  base.searchParams.set("url", String(url))
  try {
    const res = await doFetch(base.toString(), { method: "GET", headers, signal: init.signal, redirect: "follow" })
    // x-gw-error marks a failure of the gateway itself (not of the provider): try the direct route instead.
    if (res.headers.get("x-gw-error") && res.status !== 400) return doFetch(url, init)
    return res
  } catch {
    return doFetch(url, init)
  }
}
