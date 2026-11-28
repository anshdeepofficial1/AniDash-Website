import { endpoint } from "../server/device-pair.js";
// This function also hosts the device-pairing protocol: Vercel Hobby allows only 12 functions per deployment.
// vercel.json rewrites /api/device-pair/<action> to /api/auth-config?pair=<action>, so public URLs are unchanged.
const PAIR = Object.fromEntries(["create", "session", "approve", "status", "account", "anilist", "logout", "devices", "device-revoke", "management"].map(a => [a, endpoint(a)]));

// AniList client IDs are public. Never return an OAuth client secret.
export default function handler(req, res) {
  if (req.query?.pair !== undefined) {
    const run = Object.prototype.hasOwnProperty.call(PAIR, String(req.query.pair)) ? PAIR[String(req.query.pair)] : null;
    if (!run) { res.setHeader("Cache-Control", "no-store"); return res.status(404).json({ success: false }); }
    return run(req, res);
  }
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
