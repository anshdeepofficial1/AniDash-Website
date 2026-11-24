// Embedded-player progress adapter. Only providers that publish a documented postMessage API are trusted.
// Nothing here fabricates progress: a position is accepted only from a validated message sent by the
// approved provider origin through the provider's own iframe window.

export type EmbedCapability = { name: string; origin: string; progress: boolean; seek: boolean; startAt: boolean; note: string }

export const EMBED_PLAYERS: EmbedCapability[] = [
  { name: "MegaPlay", origin: "https://megaplay.buzz", progress: true, seek: false, startAt: false,
    note: "Documented postMessage events (time, complete, watching-log). Exact position is saved; the player has no documented seek or start-time option, so resuming means scrubbing to the saved time." },
  { name: "Megavid", origin: "https://megavid.buzz", progress: false, seek: false, startAt: false,
    note: "No documented player events could be confirmed. Playback works but exact position is not tracked." },
  { name: "AniXo", origin: "https://anixo.buzz", progress: false, seek: false, startAt: false,
    note: "No documented player events could be confirmed. Playback works but exact position is not tracked." },
]

export function embedOrigin(url: string): string | null {
  try { const u = new URL(url); return u.protocol === "https:" ? u.origin : null } catch { return null }
}
export function embedCapability(url: string): EmbedCapability | null {
  const o = embedOrigin(url); return o ? EMBED_PLAYERS.find(p => p.origin === o) || null : null
}

export type EmbedProgress = { position: number; duration: number; ended: boolean }

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null

/** Returns a normalised progress record, or null for anything untrusted or malformed. */
export function parseEmbedMessage(origin: string, data: unknown, approved: EmbedCapability | null): EmbedProgress | null {
  if (!approved || !approved.progress || origin !== approved.origin) return null
  let msg: any = data
  if (typeof msg === "string") { if (msg.length > 4096) return null; try { msg = JSON.parse(msg) } catch { return null } }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null
  if (msg.event === "complete") return { position: 0, duration: 0, ended: true }
  let t: number | null = null, d: number | null = null
  if (msg.event === "time") { t = num(msg.time); d = num(msg.duration) }
  else if (msg.type === "watching-log") { t = num(msg.currentTime); d = num(msg.duration) }
  else return null
  if (t == null || d == null || t < 0 || d <= 0 || d > 86_400 || t > d + 1) return null
  return { position: Math.min(t, d), duration: d, ended: d - t <= 30 }
}
