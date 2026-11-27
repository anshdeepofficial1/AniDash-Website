// AniDash source engine: provider registry, per-device health, cooldowns, ordering and honest status.
// Pure module (no React). Storage is injectable so it can be unit-tested under Node.
// Nothing here executes remote code: providers are reviewed, built-in adapters or user-authorised manifests.

export type MediaKind = "anime" | "manga"
export type Delivery = "native" | "embed" | "external"
export type Authorization = "official" | "third-party" | "user"
export type SourceStatus = "verified" | "available" | "degraded" | "unavailable" | "update" | "incompatible" | "unverified"

export type ProviderMeta = {
  id: string
  name: string
  kind: MediaKind
  delivery: Delivery
  authorization: Authorization
  version: number
  languages: string[]          // only languages the adapter can really return, e.g. "en-dub","ja-sub","hi-dub"
  description: string
  homepage?: string
  priority: number             // lower = tried first
  incompatibleReason?: string  // set when it cannot run in a browser
  recommended?: boolean
  configurable?: boolean
}

export const PROVIDERS: ProviderMeta[] = [
  { id: "justanime", name: "JustAnime", kind: "anime", delivery: "native", authorization: "third-party", version: 3, languages: ["en-dub", "ja-sub"], priority: 10, recommended: true, description: "Built-in HLS provider (momo / onyx servers). Third-party: no publisher licence evidence, kept only while it plays." },
  { id: "animetsu", name: "Animetsu (Gojo)", kind: "anime", delivery: "native", authorization: "third-party", version: 1, languages: ["en-dub", "ja-sub"], priority: 20, description: "Built-in HLS provider reached through its public API. Third-party." },
  { id: "hianime", name: "HiAnime", kind: "anime", delivery: "native", authorization: "third-party", version: 2, languages: ["en-dub", "ja-sub"], priority: 30, description: "Built-in adapter using a public mirror API. Third-party; mirror changes often." },
  { id: "anikoto", name: "AniKoto / AnimePahe", kind: "anime", delivery: "native", authorization: "third-party", version: 2, languages: ["en-dub", "ja-sub"], priority: 40, description: "Built-in adapter (AniKoto, AnimePahe, Kwik). Third-party; frequently blocks datacenter requests." },
  { id: "hindi", name: "Hindi DUB lookup", kind: "anime", delivery: "native", authorization: "third-party", version: 1, languages: ["hi-dub"], priority: 50, description: "Looks for a Hindi-dubbed release per episode. Only shown when one is actually found." },
  { id: "anikai", name: "AnimeKai", kind: "anime", delivery: "native", authorization: "third-party", version: 0, languages: [], priority: 90, incompatibleReason: "Android (Dart) extension only. No reviewed browser adapter; not authorised.", description: "Present in the Android app only." },
  { id: "animeonsen", name: "AnimeOnsen", kind: "anime", delivery: "native", authorization: "third-party", version: 0, languages: [], priority: 91, incompatibleReason: "Android-only adapter; requires an authenticated token flow that is not exposed to the web.", description: "Present in the Android app only." },
  { id: "kaido", name: "Kaido", kind: "anime", delivery: "native", authorization: "third-party", version: 0, languages: [], priority: 92, incompatibleReason: "Android-only adapter; site is defunct/unstable.", description: "Present in the Android app only." },
  { id: "anizone", name: "AniZone", kind: "anime", delivery: "native", authorization: "third-party", version: 0, languages: [], priority: 93, incompatibleReason: "Android-only adapter; no reviewed web integration.", description: "Present in the Android app only." },
  { id: "manifest", name: "User manifests", kind: "anime", delivery: "native", authorization: "user", version: 2, languages: ["en-dub", "ja-sub"], priority: 5, description: "Sources you import yourself (JSON manifest of media you are licensed to use)." },
  { id: "mangaplus", name: "MANGA Plus", kind: "manga", delivery: "external", authorization: "official", version: 1, languages: ["en"], priority: 10, recommended: true, homepage: "https://mangaplus.shueisha.co.jp", description: "Official SHUEISHA reader. Opens a search on the official site; pages are never copied." },
  { id: "viz", name: "VIZ", kind: "manga", delivery: "external", authorization: "official", version: 1, languages: ["en"], priority: 20, homepage: "https://www.viz.com", description: "Official VIZ reader. Opens a search on the official site." },
  { id: "manifest-manga", name: "User manifests / CBZ", kind: "manga", delivery: "native", authorization: "user", version: 2, languages: ["any"], priority: 5, description: "Chapters from a manifest you import for content you own." },
  { id: "mangasee", name: "MangaSee", kind: "manga", delivery: "native", authorization: "third-party", version: 0, languages: [], priority: 90, incompatibleReason: "Unlicensed scanlation host; not authorised, Android-only adapter.", description: "Present in the Android app only." },
  { id: "mangakakalot", name: "Mangakakalot", kind: "manga", delivery: "native", authorization: "third-party", version: 0, languages: [], priority: 91, incompatibleReason: "Unlicensed scanlation host; not authorised, Android-only adapter.", description: "Present in the Android app only." },
  { id: "mangabat", name: "MangaBat", kind: "manga", delivery: "native", authorization: "third-party", version: 0, languages: [], priority: 92, incompatibleReason: "Unlicensed scanlation host; not authorised, Android-only adapter.", description: "Present in the Android app only." },
  { id: "asura", name: "AsuraScans", kind: "manga", delivery: "native", authorization: "third-party", version: 0, languages: [], priority: 93, incompatibleReason: "Unlicensed scanlation host; not authorised, Android-only adapter.", description: "Present in the Android app only." },
]

// The Extensions catalog contains only anime source adapters; publisher links stay outside it.
export const animeExtensionCatalog = () => PROVIDERS.filter(p => p.kind === "anime" && p.delivery === "native" && p.authorization !== "user")

export type Health = {
  ok: number; fail: number
  lastOk?: number; lastFail?: number; lastError?: string
  stableOk?: number            // playbacks that stayed healthy >= STABLE_MS
  lastVerified?: number        // last >=60s stable playback on this device
  resolveMs?: number           // moving average resolve time
  startMs?: number             // moving average time to first frame
  stalls: number               // buffering events (recent)
  strikes: number              // consecutive failures
  cooldownUntil?: number
}

export type Prefs = { disabled: string[]; order: Record<string, number>; installedAvailable: string[] }
export type StoreLike = { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const STABLE_MS = 60_000
export const COOLDOWN_BASE_MS = 2 * 60_000
export const COOLDOWN_MAX_MS = 6 * 3600_000
export const RECENT_MS = 24 * 3600_000
const HEALTH_KEY = "anidash-engine-health-v1"
const PREFS_KEY = "anidash-engine-prefs-v1"

let store: StoreLike | null = null
export function useStore(s: StoreLike | null) { store = s; cache = null; prefsCache = null }
function ls(): StoreLike | null {
  if (store) return store
  try { return typeof localStorage !== "undefined" ? localStorage : null } catch { return null }
}
let cache: Record<string, Health> | null = null
let prefsCache: Prefs | null = null
const emit = () => { try { if (typeof window !== "undefined") window.dispatchEvent(new Event("anidash-engine")) } catch { /* ignore */ } }

export function loadHealth(): Record<string, Health> {
  if (cache) return cache
  try { const v: any = JSON.parse(ls()?.getItem(HEALTH_KEY) || "{}"); cache = v && typeof v === "object" ? v : {} } catch { cache = {} }
  return cache!
}
function saveHealth() { try { ls()?.setItem(HEALTH_KEY, JSON.stringify(loadHealth())) } catch { /* ignore */ } emit() }
function rec(id: string): Health { const h = loadHealth(); return h[id] ||= { ok: 0, fail: 0, stalls: 0, strikes: 0 } }
const ema = (prev: number | undefined, v: number) => prev == null ? v : Math.round(prev * 0.7 + v * 0.3)

export function loadPrefs(): Prefs {
  if (prefsCache) return prefsCache
  try {
    const v: any = JSON.parse(ls()?.getItem(PREFS_KEY) || "{}")
    prefsCache = { disabled: Array.isArray(v.disabled) ? v.disabled.filter((x: unknown) => typeof x === "string") : [], order: v.order && typeof v.order === "object" ? v.order : {}, installedAvailable: Array.isArray(v.installedAvailable) ? v.installedAvailable : [] }
  } catch { prefsCache = { disabled: [], order: {}, installedAvailable: [] } }
  return prefsCache!
}
function savePrefs() { try { ls()?.setItem(PREFS_KEY, JSON.stringify(loadPrefs())) } catch { /* ignore */ } emit() }

export const meta = (id: string) => PROVIDERS.find(p => p.id === id)
export const isRunnable = (p: ProviderMeta) => !p.incompatibleReason && p.delivery === "native" && p.version > 0

export function isEnabled(id: string) { return !loadPrefs().disabled.includes(id) }
export function setEnabled(id: string, on: boolean) {
  const p = loadPrefs(); p.disabled = p.disabled.filter(x => x !== id); if (!on) p.disabled.push(id); savePrefs()
}
export function setPriority(id: string, value: number | null) {
  const p = loadPrefs(); if (value == null) delete p.order[id]; else p.order[id] = Math.max(0, Math.min(999, Math.round(value))); savePrefs()
}
export function restoreDefaults() { prefsCache = { disabled: [], order: {}, installedAvailable: [] }; savePrefs() }
export function resetHealth(id?: string) { const h = loadHealth(); if (id) delete h[id]; else for (const k of Object.keys(h)) delete h[k]; saveHealth() }

export function inCooldown(id: string, now = Date.now()) { return (loadHealth()[id]?.cooldownUntil || 0) > now }

// ---- recording -------------------------------------------------------------------------------
export function recordResolve(id: string, ms: number, now = Date.now()) {
  const h = rec(id); h.resolveMs = ema(h.resolveMs, ms); saveHealth(); void now
}
export function recordPlayStart(id: string, ms: number) {
  const h = rec(id); h.startMs = ema(h.startMs, ms); saveHealth()
}
/** Called once playback has been healthy for STABLE_MS. */
export function recordStable(id: string, now = Date.now()) {
  const h = rec(id); h.stableOk = (h.stableOk || 0) + 1; h.stalls = 0; h.lastOk = now; h.lastVerified = now; h.strikes = 0; h.cooldownUntil = undefined; saveHealth()
}
export function recordPlaying(id: string, now = Date.now()) {
  const h = rec(id); h.ok++; h.lastOk = now; h.strikes = 0; h.cooldownUntil = undefined; saveHealth()
}
export function recordStall(id: string) { const h = rec(id); h.stalls = Math.min(50, h.stalls + 1); saveHealth() }
/** `permanent` (404/410/blocked) backs off faster than a transient timeout. */
export function recordFailure(id: string, error: string, permanent = false, now = Date.now()) {
  const h = rec(id); h.fail++; h.strikes++; h.lastFail = now; h.lastError = String(error).slice(0, 200)
  const step = Math.min(h.strikes - 1 + (permanent ? 2 : 0), 12)
  h.cooldownUntil = now + Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** step); saveHealth()
}
// Missing episodes and empty results are title-specific, not evidence that an entire provider is down.
export const isProviderOutage = (e: string) => /\b(401|403|429|5\d\d)\b|timeout|no answer in time|network error|offline|unreachable|forbidden|authenticate data/i.test(e)
export const isPermanentError = (e: string) => /\b(401|403|404|410)\b|blocked|forbidden|not found|not listed|protection/i.test(e)

// ---- status ----------------------------------------------------------------------------------
export function statusOf(id: string, now = Date.now(), health = loadHealth()): { status: SourceStatus; label: string; detail: string } {
  const p = meta(id)
  if (!p) return { status: "unverified", label: "Unverified", detail: "Unknown source" }
  if (p.incompatibleReason || p.version === 0) return { status: "incompatible", label: "Incompatible", detail: p.incompatibleReason || "No browser adapter" }
  if (p.delivery === "external") return { status: "available", label: "Available", detail: "Opens the official provider in a new tab" }
  const h = health[id]
  if (h?.cooldownUntil && h.cooldownUntil > now) return { status: "unavailable", label: "Temporarily unavailable", detail: `${h.lastError || "Recent failures"} — retry after ${new Date(h.cooldownUntil).toLocaleTimeString()}` }
  if (!h || (!h.ok && !h.fail)) return { status: "unverified", label: "Unverified", detail: "Not played on this device yet" }
  if (h.lastVerified && now - h.lastVerified < RECENT_MS * 7 && h.strikes === 0 && h.stalls < 5) return { status: "verified", label: "Verified on this device", detail: `Stable ${Math.round(STABLE_MS / 1000)}s+ playback ${new Date(h.lastVerified).toLocaleString()}` }
  if (h.strikes > 0 || h.stalls >= 5 || (h.fail > h.ok * 2 && h.fail >= 3)) return { status: "degraded", label: "Degraded", detail: h.lastError || "Frequent stalls or errors" }
  return { status: "available", label: "Available", detail: h.lastOk ? `Last played ${new Date(h.lastOk).toLocaleString()} (not yet stable-verified)` : "Resolved but not stable-verified" }
}

// ---- ordering --------------------------------------------------------------------------------
export function score(id: string, now = Date.now(), health = loadHealth(), prefs = loadPrefs()): number {
  const p = meta(id)!; const h = health[id]
  let s = prefs.order[id] ?? p.priority
  if (h) {
    s += Math.min(h.strikes, 5) * 15 + Math.min(h.stalls, 10) * 2
    if (h.lastOk && now - h.lastOk < RECENT_MS) s -= 8
    if (h.lastVerified && now - h.lastVerified < RECENT_MS * 7) s -= 6
    if (h.resolveMs) s += Math.min(h.resolveMs / 1000, 10)
    if (h.startMs) s += Math.min(h.startMs / 1000, 10)
  }
  return s
}
/** Providers to try for this request, best first. Cooldown providers are dropped; nothing is added for unsupported languages. */
export function plan(kind: MediaKind, lang: string, now = Date.now()): ProviderMeta[] {
  const health = loadHealth(), prefs = loadPrefs()
  return PROVIDERS
    .filter(p => p.kind === kind && isRunnable(p) && p.authorization !== "user" && p.languages.includes(lang) && isEnabled(p.id) && !inCooldown(p.id, now))
    .sort((a, b) => score(a.id, now, health, prefs) - score(b.id, now, health, prefs))
}
/** Audio labels. Hindi subtitles are never reported as Hindi DUB. */
export const LANGUAGE_LABELS: Record<string, string> = { "en-dub": "English DUB", "ja-sub": "Japanese SUB", "hi-dub": "Hindi DUB", "ta-dub": "Tamil DUB", "te-dub": "Telugu DUB" }
export const languageKey = (audio: "dub" | "sub" | string, lang = "en") => audio === "sub" ? "ja-sub" : `${lang}-dub`

export function isSafeHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== "https:" || u.username || u.password) return false
    const h = u.hostname.toLowerCase()
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^\[/.test(h)) return false
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
    if (m) return false
    return h.includes(".")
  } catch { return false }
}
export function externalSearchUrl(id: string, title: string): string | null {
  const q = encodeURIComponent(title.trim()); if (!q) return null
  switch (id) {
    case "mangaplus": return `https://mangaplus.shueisha.co.jp/search_result?keyword=${q}`
    case "viz": return `https://www.viz.com/search?search=${q}`
    default: return null
  }
}
