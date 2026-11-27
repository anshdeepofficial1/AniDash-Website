// Remembers the viewer's own server choice so it survives next-episode, refresh and new sessions.
// Only an explicit click is remembered; automatic fallbacks never overwrite it.
export type Audio = "sub" | "dub"
export type EmbedPick = { serverId?: string; name?: string; lang: string; audio: Audio }
export type ServerPref = { mode: "native" | "embed"; native: Partial<Record<Audio, string>>; embed: EmbedPick | null }
const KEY = "anidash.server-pref.v1"
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void }
let store: Store | null = null
export const useServerPrefStore = (s: Store | null) => { store = s }
const st = (): Store | null => { if (store) return store; try { return typeof localStorage !== "undefined" ? localStorage : null } catch { return null } }

const clean = (v: unknown, max = 60) => typeof v === "string" && v.length <= max && /^[\w:. -]+$/.test(v) ? v : undefined

export function loadServerPref(): ServerPref {
  const empty: ServerPref = { mode: "native", native: {}, embed: null }
  try {
    const v: any = JSON.parse(st()?.getItem(KEY) || "null")
    if (!v || typeof v !== "object") return empty
    const e = v.embed
    return {
      mode: v.mode === "embed" ? "embed" : "native",
      native: { sub: clean(v.native?.sub), dub: clean(v.native?.dub) },
      embed: e && clean(e.lang, 12) && (e.audio === "sub" || e.audio === "dub") ? { serverId: clean(e.serverId, 80), name: clean(e.name, 40), lang: e.lang, audio: e.audio } : null,
    }
  } catch { return empty }
}
function save(p: ServerPref) { try { st()?.setItem(KEY, JSON.stringify(p)) } catch { /* ignore */ } }

export function rememberNative(audio: Audio, serverKey: string) {
  const p = loadServerPref(); p.mode = "native"; p.native[audio] = serverKey; save(p)
}
export function rememberEmbed(pick: EmbedPick) {
  const p = loadServerPref(); p.mode = "embed"; p.embed = pick; save(p)
}
/** Saved native server for this audio, but only if it is still a valid choice. */
export function preferredNative(audio: Audio, valid: (key: string) => boolean, fallback: string): string {
  const k = loadServerPref().native[audio]
  return k && valid(k) ? k : fallback
}
/** Finds this episode's equivalent of the saved embed player. Never crosses language. */
export function pickEmbed<T extends { serverId?: string; server?: string; lang?: string; isDub?: boolean }>(pref: ServerPref, audio: Audio, candidates: T[]): T | null {
  const e = pref.mode === "embed" ? pref.embed : null
  if (!e) return null
  const lang = (c: T) => c.lang || "en"
  const pool = candidates.filter(c => lang(c) === e.lang && (e.lang !== "en" || (c.isDub ? "dub" : "sub") === audio))
  return pool.find(c => e.serverId && c.serverId === e.serverId)
    || pool.find(c => e.name && (c.server || "").toLowerCase() === e.name.toLowerCase())
    || null
}
