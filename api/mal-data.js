// Strict MAL API whitelist to avoid exposing general-purpose credential proxy.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "PUT"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  const origin = "https://" + req.headers.host;
  if (req.method === "PUT" && req.headers.origin && req.headers.origin !== origin &&
      !(req.headers.host?.startsWith("localhost") && req.headers.origin === "http://" + req.headers.host)) {
    return res.status(403).json({ error: "Cross-origin mutation denied" });
  }
  const auth = String(req.headers.authorization || "");
  if (!/^Bearer [a-zA-Z0-9._~+\/-]{20,4096}=?$/.test(auth)) {
    return res.status(401).json({ error: "MyAnimeList login required" });
  }
  const action = String(req.query?.action || "");
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 100));
  const offset = Math.max(0, Math.min(10000, Number(req.query?.offset) || 0));
  let endpoint, method = "GET", body;
  if (req.method === "GET" && action === "profile") {
    endpoint = "/v2/users/@me?fields=id,name,picture";
  } else if (req.method === "GET" && action === "list") {
    endpoint = "/v2/users/@me/animelist?limit=" + limit + "&offset=" + offset +
      "&fields=list_status,num_episodes,main_picture,alternative_titles,media_type";
  } else if (req.method === "PUT" && action === "progress") {
    const mediaId = Number(req.query?.id);
    if (!Number.isSafeInteger(mediaId) || mediaId < 1) return res.status(400).json({ error: "Invalid MAL ID" });
    const input = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const progress = Number(input.progress);
    if (!Number.isSafeInteger(progress) || progress < 0 || progress > 50000) {
      return res.status(400).json({ error: "Invalid episode progress" });
    }
    endpoint = "/v2/anime/" + mediaId + "/my_list_status";
    method = "PUT";
    body = new URLSearchParams({ num_watched_episodes: String(progress),
      status: String(input.status || "watching").match(/^(watching|completed|on_hold|dropped|plan_to_watch)$/)?.[0] || "watching" }).toString();
  } else return res.status(400).json({ error: "Unsupported MAL operation" });
  try {
    const response = await fetch("https://api.myanimelist.net" + endpoint, {
      method, headers: { Authorization: auth, Accept: "application/json",
        ...(method === "PUT" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      ...(body ? { body } : {}), signal: AbortSignal.timeout(10000)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status >= 500 ? 502 : response.status)
      .json({ error: json.error || "MyAnimeList request failed" });
    return res.status(200).json(json);
  } catch (_) { return res.status(502).json({ error: "MyAnimeList API temporarily unavailable" }); }
}
