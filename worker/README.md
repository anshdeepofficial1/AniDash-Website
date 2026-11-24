# AniDash Gateway (Cloudflare Worker, free)

Sends provider **API/playlist** requests from Cloudflare's network instead of Vercel's datacenter IPs. Stores nothing, hosts no media, no episode data. Optional: without it AniDash works exactly as before.

## Setup (dashboard only, no CLI)
1. Cloudflare dashboard → **Workers & Pages → Create → Create Worker** → name `anidash-gateway` → Deploy.
2. **Edit code** → replace everything with `worker/gateway.js` → **Deploy**.
3. Worker → **Settings → Variables and Secrets → Add** → type **Secret**, name `GATEWAY_KEY`, value = a long random string (32+ chars) → Deploy.
4. Copy the Worker URL (`https://anidash-gateway.<you>.workers.dev`).
5. Vercel → project → **Settings → Environment Variables** (Preview first): `GATEWAY_URL` = that URL, `GATEWAY_KEY` = same secret → redeploy.
6. Open `/api/justanime?action=matrix&id=21&episode=440` — the JSON shows `"gateway": true`.

## Limits
Free plan: 100,000 requests/day. Only JSON/playlists go through the Worker; video segments do not. If the Worker is down, AniDash falls back to the direct route. Providers that also block Cloudflare IPs stay blocked.
