// Public OAuth client ID only. Never expose the MAL client secret.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const clientId = String(process.env.MAL_WEB_CLIENT_ID || "").trim();
  return res.status(200).json({ enabled: /^[a-zA-Z0-9_-]{8,128}$/.test(clientId),
    clientId: /^[a-zA-Z0-9_-]{8,128}$/.test(clientId) ? clientId : "" });
}
