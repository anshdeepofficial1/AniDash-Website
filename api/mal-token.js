// Secure, same-origin token-exchange relay for MyAnimeList code + PKCE.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const expected = "https://" + req.headers.host;
  if (req.headers.origin && req.headers.origin !== expected &&
      !(req.headers.host?.startsWith("localhost") && req.headers.origin === "http://" + req.headers.host)) {
    return res.status(403).json({ error: "Cross-origin token exchange denied" });
  }
  const id = String(process.env.MAL_WEB_CLIENT_ID || "").trim();
  if (!id) return res.status(503).json({ error: "MyAnimeList login is not configured" });
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const grant = body.grant_type;
  if (grant !== "authorization_code" && grant !== "refresh_token") {
    return res.status(400).json({ error: "Unsupported grant type" });
  }
  const fields = new URLSearchParams({ grant_type: grant, client_id: id });
  const secret = String(process.env.MAL_WEB_CLIENT_SECRET || "").trim();
  if (secret) fields.set("client_secret", secret);
  if (grant === "authorization_code") {
    const code = String(body.code || "");
    const verifier = String(body.code_verifier || "");
    const redirect = String(body.redirect_uri || "");
    const siteOrigin = "https://" + req.headers.host;
    if (!code || code.length > 2048 || !/^[a-zA-Z0-9._~-]{43,128}$/.test(verifier) ||
        redirect !== siteOrigin + "/") {
      return res.status(400).json({ error: "Invalid authorization code, PKCE verifier or callback" });
    }
    fields.set("code", code); fields.set("code_verifier", verifier); fields.set("redirect_uri", redirect);
  } else {
    const refresh = String(body.refresh_token || "");
    if (!refresh || refresh.length > 4096) return res.status(400).json({ error: "Invalid refresh token" });
    fields.set("refresh_token", refresh);
  }
  try {
    const response = await fetch("https://myanimelist.net/v1/oauth2/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: fields.toString(), signal: AbortSignal.timeout(12000)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(401).json({ error: json.error_description || json.error || "MyAnimeList authorization failed" });
    return res.status(200).json({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_in: json.expires_in,
      token_type: json.token_type
    });
  } catch (_) { return res.status(502).json({ error: "MyAnimeList temporarily unavailable" }); }
}
