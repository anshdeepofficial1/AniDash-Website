import { browserSession } from "../server/device-pair.js";
// Strict MAL API whitelist to avoid exposing general-purpose credential proxy.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "PUT", "DELETE"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  const origin = "https://" + req.headers.host;
  if (req.method !== "GET" && req.headers.origin && req.headers.origin !== origin &&
      !(req.headers.host?.startsWith("localhost") && req.headers.origin === "http://" + req.headers.host)) {
    return res.status(403).json({ error: "Cross-origin mutation denied" });
  }
  let auth = String(req.headers.authorization || "");
  if (!auth) { try { const s=await browserSession(req,res); if(s?.accounts?.myanimelist?.accessToken) auth="Bearer "+s.accounts.myanimelist.accessToken; } catch (_) { return res.status(503).json({error:"Session unavailable"}); } }
  if (req.method !== "GET" && !req.headers.authorization && req.headers.origin !== origin) return res.status(403).json({error:"Cross-origin mutation denied"});
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
  } else if (!req.headers.authorization && (req.method==="PUT"&&action==="status" || req.method==="DELETE"&&action==="delete")) {
    const id=Number(req.query?.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:"Invalid MAL ID"});
    endpoint="/v2/anime/"+id+"/my_list_status";method=req.method;
    if(method==="PUT"){let input;try{input=typeof req.body==="string"?JSON.parse(req.body):req.body||{}}catch{return res.status(400).json({error:"Invalid request"})}const status=input.status;if(!["watching","completed","on_hold","dropped","plan_to_watch"].includes(status))return res.status(400).json({error:"Invalid status"});body=new URLSearchParams({status}).toString()}
  } else return res.status(400).json({ error: "Unsupported MAL operation" });
  try {
    const response = await fetch("https://api.myanimelist.net" + endpoint, {
      method, headers: { Authorization: auth, Accept: "application/json",
        ...(method === "PUT" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      ...(body ? { body } : {}), signal: AbortSignal.timeout(10000)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status >= 500 ? 502 : response.status)
      .json({ error: "MyAnimeList request failed" });
    return res.status(200).json(json);
  } catch (_) { return res.status(502).json({ error: "MyAnimeList API temporarily unavailable" }); }
}
