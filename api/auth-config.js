// AniList client IDs are public. Never return an OAuth client secret.
export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const clientId = String(process.env.ANILIST_WEB_CLIENT_ID || "").trim();
  const valid = /^\d{1,20}$/.test(clientId);
  return res.status(200).json({
    enabled: valid,
    clientId: valid ? clientId : ""
  });
}
