import { episodeSources } from "./sources"
import { activePlaybackMeta } from "./playback-meta.mjs"
import { useInstalledSources } from "./use-installed-sources"
import { getEpisodeResume, localResume, persistPlayback, syncPlayback, flushPlaybackQueue, parseManualPosition, formatPosition } from "./resume"
import { embedProgressOrigin, readEmbedCheckpoint, type EmbedCheckpoint } from "./embed-progress"
import React from "react"
import { useRouter } from "@/lib/navigation"
import Hls from "hls.js"
import { Anime_Entry } from "@/api/generated/types"
import { Button } from "@/components/ui/button"
import { getArcs } from "./arcs"
import * as Engine from "./engine"
import { loadServerPref, rememberNative, rememberEmbed, preferredNative, pickEmbed } from "./server-pref"
import {
  LuPlay,
  LuPause,
  LuRotateCcw,
  LuRotateCw,
  LuChevronLeft,
  LuChevronRight,
  LuList,
  LuLayoutGrid,
  LuCaptions,
  LuVolume2,
  LuVolumeX,
  LuMaximize,
  LuSettings,
  LuUpload
} from "react-icons/lu"

type Metadata = {
  number: number
  title: string
  image?: string
  aired?: string
  filler?: boolean
  recap?: boolean
}

type StreamSource = {
  lang?: string
  provider?: string
  url: string
  originalUrl?: string
  quality?: string
  server?: string
  serverId?: string
  type?: string
  isM3U8?: boolean
  isDub?: boolean
}

const preflightCache = new Map<string, Promise<boolean>>()
/** True when an HLS playlist behind AniDash's relay really answers with a playlist. Anything else is assumed fine (no false negatives). */
function preflightStream(src: StreamSource): Promise<boolean> {
  let u: URL
  try { u = new URL(src.url, window.location.href) } catch { return Promise.resolve(true) }
  if (src.type === "embed" || src.type === "mp4" || u.pathname !== "/api/media" || u.origin !== window.location.origin) return Promise.resolve(true)
  const target = decodeURIComponent(u.searchParams.get("url") || "")
  if (!(src.isM3U8 || src.type === "hls" || /\.m3u8(\?|$)/i.test(target))) return Promise.resolve(true)
  let hit = preflightCache.get(src.url)
  if (!hit) {
    hit = fetch(u.toString(), { signal: AbortSignal.timeout(5000), cache: "no-store" })
      .then(async r => r.ok && (await r.text()).trimStart().startsWith("#EXTM3U"))
      .catch(() => false)
    preflightCache.set(src.url, hit)
    if (preflightCache.size > 60) preflightCache.delete(preflightCache.keys().next().value as string)
  }
  return hit
}

type StreamTrack = { url?: string; file?: string; src?: string; lang?: string; label?: string; language?: string; kind?: string; type?: string }
type CaptionFile = { id: string; url: string; label: string; language: string }
type CaptionOption = { id: string; index: number; label: string; language: string }
function captionLanguage(language: string, label: string): string {
  if (/^(?:en|eng|english)(?:[-_\s]|$)/i.test(language.trim()) || /\benglish\b/i.test(label) || /^(?:en|eng)(?:[-_]|$)/i.test(label.trim())) return "en"
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/i.test(language.trim()) ? language.trim().toLowerCase() : "und"
}
function captionDisplayName(language: string, label: string): string {
  const name = label.trim()
  if (language === "en") {
    if (!name || /^(?:en|eng|english)$/i.test(name)) return "English"
    if (/^en[-_](?:us|gb|uk)$/i.test(name)) return "English (" + name.slice(3).toUpperCase() + ")"
    return /english/i.test(name) ? name : "English · " + name
  }
  return name || (language !== "und" ? language : "Subtitle")
}
function preferredEnglishTrack(options: CaptionOption[]) {
  const english = options.filter(option => option.language === "en")
  return english.find(option => !/signs|songs|forced/i.test(option.label)) || english[0]
}
type BufferedSpan = { start: number; end: number }
type SeekImage = { start: number; end: number; url: string; crop?: { x: number; y: number; w: number; h: number } }
type SeekHover = { time: number; fraction: number }

function readBufferedRanges(ranges: TimeRanges, duration: number): BufferedSpan[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  return Array.from({ length: ranges.length }, (_, i) => ({ start: Math.max(0, ranges.start(i)), end: Math.min(duration, ranges.end(i)) }))
    .filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
}
function bufferedAhead(ranges: BufferedSpan[], position: number): number {
  const range = ranges.find(item => position >= item.start - 0.25 && position <= item.end)
  return range ? Math.max(0, range.end - position) : 0
}
function previewTime(value: string): number {
  const parts = value.trim().split(":")
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return NaN
  return parts.reduce((seconds, part) => seconds * 60 + Number(part), 0)
}
function parsePreviewVtt(input: string, base: string): SeekImage[] {
  const rows: SeekImage[] = []
  const lines = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")
  for (let i = 0; i < lines.length && rows.length < 4000; i++) {
    const match = lines[i].match(/^\s*(\d{1,2}(?::\d{2}){1,2}\.\d+)\s*-->\s*(\d{1,2}(?::\d{2}){1,2}\.\d+)/)
    if (!match) continue
    const start = previewTime(match[1]), end = previewTime(match[2]), raw = lines[i + 1]?.trim()
    if (!raw || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    try {
      const url = new URL(raw, base)
      if ((url.protocol !== "https:" && url.origin !== window.location.origin) || url.username || url.password) continue
      const crop = url.hash.match(/^#xywh=(?:pixel:)?(\d+),(\d+),(\d+),(\d+)$/)
      if (crop) {
        const [x,y,w,h] = crop.slice(1).map(Number)
        if (w <= 0 || h <= 0 || w > 4096 || h > 4096) continue
        url.hash = ""
        rows.push({ start, end, url: url.href, crop: { x, y, w, h } })
      } else if (!url.hash) rows.push({ start, end, url: url.href })
    } catch {}
  }
  return rows.sort((a,b) => a.start - b.start)
}
function previewTrackUrl(track: StreamTrack): string | null {
  const tag = String(track.kind || "") + " " + String(track.type || "") + " " + String(track.label || "")
  if (!/thumbnail|storyboard|sprite|preview/i.test(tag)) return null
  const raw = track.url || track.file || track.src
  if (!raw || typeof raw !== "string") return null
  try {
    const url = new URL(raw, window.location.href)
    return (url.protocol === "https:" || url.origin === window.location.origin) && !url.username && !url.password ? url.href : null
  } catch { return null }
}
function SeekThumbnail({ image }: { image: SeekImage }) {
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [image.url])
  const crop = image.crop
  const scale = crop ? Math.min(160 / crop.w, 90 / crop.h) : 1
  return <div className="relative flex h-[90px] w-40 items-center justify-center overflow-hidden bg-neutral-950">
    {failed ? <span className="text-[10px] text-white/60">Preview unavailable</span> : crop ?
      <div className="relative overflow-hidden" style={{ width: crop.w * scale, height: crop.h * scale }}>
        <img alt="" draggable={false} src={image.url} onError={() => setFailed(true)} className="absolute left-0 top-0 max-w-none origin-top-left" style={{ transform: `translate(${-crop.x * scale}px,${-crop.y * scale}px) scale(${scale})` }} />
      </div> : <img alt="" draggable={false} src={image.url} onError={() => setFailed(true)} className="h-full w-full object-contain" />}
  </div>
}
type PlayerMenu = "settings" | "quality" | "speed" | "subtitles" | "appearance" | null
type PipVideo = HTMLVideoElement & {
  requestPictureInPicture?: () => Promise<unknown>
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  webkitPresentationMode?: string
}
type PipDocument = Document & { pictureInPictureEnabled?: boolean; pictureInPictureElement?: Element | null; exitPictureInPicture?: () => Promise<unknown> }

function subtitleVtt(input: string): string {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim()
  if (/^WEBVTT(?:\s|$)/.test(text)) return text + "\n"
  if (!/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(text)) throw Error("Unsupported subtitle format; use WebVTT or SRT.")
  return "WEBVTT\n\n" + text.replace(/^(\d{1,2}:\d{2}:\d{2})[,.](\d{3})(\s*-->\s*)(\d{1,2}:\d{2}:\d{2})[,.](\d{3})/gm, "$1.$2$3$4.$5") + "\n"
}
function captionSource(track: StreamTrack, index: number) {
  const raw = track.url || track.file || track.src
  if (typeof raw !== "string") return null
  const kind = String(track.kind || track.type || "").toLowerCase()
  const label = String(track.label || track.lang || track.language || "Subtitle " + (index + 1))
  if (/thumbnail|sprite|metadata|chapter|preview/.test(kind + " " + label.toLowerCase())) return null
  if (kind && !/caption|subtitle|vtt|srt|text|unknown/.test(kind) && !/\.(vtt|srt)(?:[?#]|$)/i.test(raw)) return null
  try {
    const u = new URL(raw, window.location.href)
    if (u.protocol !== "https:" && u.origin !== window.location.origin) return null
    if (u.username || u.password) return null
    const lang = String(track.language || track.lang || "").trim()
    const language = captionLanguage(lang, label)
    return { id: "remote-" + index, url: u.href, label: captionDisplayName(language, label), language }
  } catch { return null }
}
function captionPlainText(cue: TextTrackCue) {
  const vtt = cue as VTTCue
  if (typeof vtt.getCueAsHTML === "function") {
    const fragment = vtt.getCueAsHTML()
    return (fragment.textContent || "").trim()
  }
  return typeof vtt.text === "string" ? vtt.text.replace(/<[^>]*>/g, "").trim() : ""
}
function PipIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><rect x="12" y="11" width="9" height="7" rx="1.3"/></svg>
}
function NextIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true"><path d="m5 4 12 8-12 8zM19 4v16"/></svg>
}

const PAGE_SIZE = 24
const storageKey = "anidash.watch.web.v1"
const JUSTANIME_SERVERS = ["momo", "onyx", "gigi", "nami", "calm", "revo"] as const
// Short-lived client cache for stream lookups: retries and the next-episode prefetch are instant.
const streamCache = new Map<string, { at: number, data: any }>()
const streamErrors = new Map<string, string>()
const streamInflight = new Map<string, Promise<any | null>>()
function cachedJson(url: string, ttl = 30 * 1000): Promise<any | null> {
  const hit = streamCache.get(url)
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data)
  const running = streamInflight.get(url)
  if (running) return running
  const request = (async () => {
    try {
      streamErrors.delete(url)
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(16000) })
      if (!res.ok) {
        const body: any = await res.json().catch(() => null)
        streamErrors.set(url, String(body?.error || "HTTP " + res.status).slice(0, 110))
      }
      const data: any = res.ok ? await res.json() : null
      if (data && Array.isArray(data.sources) && data.sources.length) { streamCache.set(url, { at: Date.now(), data }); if (streamCache.size > 100) streamCache.delete(streamCache.keys().next().value!) }
      if (streamErrors.size > 100) streamErrors.delete(streamErrors.keys().next().value!)
      return data
    } catch (e) {
      streamErrors.set(url, (e as Error)?.name === "TimeoutError" ? "no answer in time" : "network error")
      return null
    } finally {
      streamInflight.delete(url)
    }
  })()
  streamInflight.set(url, request)
  return request
}
type StreamJob = { provider: string, url: string }
/** Candidate requests for one episode, ordered and filtered by the source engine (enabled, compatible, not cooling down). */
function streamJobsFor(id: number, mal: number | string, episode: number, audio: string, server: string, titles: string[] = [], meta: { year?: number, eps?: number, fmt?: string } = {}): StreamJob[] {
  const base = `id=${id}&episode=${episode}&category=${audio}`
  const urls: Record<string, string[]> = {
    justanime: [`/api/justanime?action=streams&${base}&server=${server}`, `/api/justanime?action=streams&${base}&server=auto`],
    animetsu: [`/api/justanime?action=animetsu&${base}&title=${encodeURIComponent(titles[0] || "")}&alt=${encodeURIComponent(titles[1] || "")}`],
    hianime: [`/api/hianime?action=streams&${base}&anilistId=${id}`],
    anikoto: [`/api/anikoto?action=auto&anilistId=${id}&episode=${episode}&category=${audio}&title=${encodeURIComponent(titles[0] || "")}&alt=${encodeURIComponent(titles[1] || "")}&year=${meta.year || ""}&eps=${meta.eps || ""}&fmt=${meta.fmt || ""}`],
  }
  const lang = Engine.languageKey(audio)
  let order = Engine.plan("anime", lang)
  // Everything is cooling down: probe only the provider that recovers soonest instead of hammering all of them.
  if (!order.length) {
    const h = Engine.loadHealth()
    const soonest = Engine.PROVIDERS.filter(p => p.kind === "anime" && Engine.isRunnable(p) && p.authorization !== "user" && p.languages.includes(lang) && Engine.isEnabled(p.id))
      .sort((x, y) => (h[x.id]?.cooldownUntil || 0) - (h[y.id]?.cooldownUntil || 0))[0]
    order = soonest ? [soonest] : []
  }
  return order.flatMap(p => (urls[p.id] || []).map(url => ({ provider: p.id, url })))
}
function streamUrlsFor(id: number, mal: number | string, episode: number, audio: string, server: string, titles: string[] = [], meta: { year?: number, eps?: number, fmt?: string } = {}) {
  return streamJobsFor(id, mal, episode, audio, server, titles, meta).map(j => j.url)
}

/** Plain-language reason for a provider failure, shown to viewers when every built-in server is down. */
function friendlyReason(reason: string): string {
  if (/523|dns|1000|offline/i.test(reason)) return "its servers are offline"
  if (/403|401|forbidden|blocked/i.test(reason)) return "is blocking AniDash's server"
  if (/502|authenticate|decrypt|unsupported state/i.test(reason)) return "changed its video protection"
  if (/fetch failed|network|econn|enotfound/i.test(reason)) return "cannot be reached right now"
  if (/time/i.test(reason)) return "is too slow to respond"
  if (/404|410|not found|not listed/i.test(reason)) return "no longer has this show at its old address"
  return "is not responding"
}

const DEFAULT_SERVER = "momo"
// The external-player notice is shown once per page load (refreshing the site shows it again).
let externalNoticeShown = false
const LANG_NAMES: Record<string, string> = { hi: "Hindi", ta: "Tamil", te: "Telugu", ml: "Malayalam", kn: "Kannada", bn: "Bengali", mr: "Marathi", pa: "Punjabi", gu: "Gujarati", ur: "Urdu", en: "English" }
const CONTROL_IDLE_MS = 3000
const PLAYER_BUFFER_TARGET = 100
const PREVIEW_STEP = 5
const FULLSCREEN_DOUBLE_TAP_MS = 170
const FULLSCREEN_DOUBLE_TAP_RADIUS = 24
type SkipInterval = { start: number; end: number }
type SkipSegments = { intro: SkipInterval | null; outro: SkipInterval | null }
const EMPTY_SEGMENTS: SkipSegments = { intro: null, outro: null }

function parseSkipInterval(value: unknown): SkipInterval | null {
  if (!value || typeof value !== "object") return null
  const item = value as Record<string, unknown>
  if (item.start == null || item.end == null || item.start === "" || item.end === "") return null
  const start = Number(item.start), end = Number(item.end)
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start
    ? { start, end } : null
}
function withinDuration(interval: SkipInterval | null, duration: number): SkipInterval | null {
  return interval && duration > 0 && interval.start < duration && interval.end <= duration + 1
    ? { start: interval.start, end: Math.min(interval.end, duration) } : null
}

function getStore() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}")
  } catch {
    return {}
  }
}

function saveStore(s: any) {
  try {
    s.updatedAt = Date.now()
    localStorage.setItem(storageKey, JSON.stringify(s))
    ;(window as any).AniDashStorage?.save(s).catch(() => {})
  } catch {}
}

function formatAiringCountdown(timeUntil: number) {
  const s = Number(timeUntil || 0)
  if (s <= 0) return ""
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const mins = Math.floor((s % 3600) / 60)
  let str = ""
  if (days > 0) str += days + "d "
  if (hours > 0 || days > 0) str += hours + "h "
  str += mins + "m"
  return str.trim()
}

function formatSeconds(secs: number) {
  if (!Number.isFinite(secs) || secs < 0) return "0:00"
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

const metadataCache = new Map<string, Metadata[]>()
const metadataPending = new Map<string, Promise<Metadata[]>>()
const metadataStoragePrefix = "anidash.episodes.v2:"
function cachedEpisodePage(id: number, page: number): Metadata[] | undefined {
  const key = id + ":" + page
  const memory = metadataCache.get(key)
  if (memory) return memory
  try {
    const item = JSON.parse(localStorage.getItem(metadataStoragePrefix + key) || "null")
    if (item && Date.now() - item.at < 7 * 86400000 && Array.isArray(item.episodes)) {
      metadataCache.set(key, item.episodes)
      return item.episodes
    }
  } catch {}
}
function loadEpisodePage(id: number, mal: number, page: number, fast = true, force = false): Promise<Metadata[]> {
  const key = id + ":" + page
  const old = cachedEpisodePage(id, page)
  if (old?.length && !force) return Promise.resolve(old)
  const pending = metadataPending.get(key)
  if (pending) return pending
  const request = fetch("/api/episode-metadata?anilist=" + id + "&id=" + mal + "&page=" + page + (fast ? "&fast=1" : ""), { signal: AbortSignal.timeout(12000) })
    .then(async response => {
      if (!response.ok) throw Error("Metadata unavailable")
      const items = (await response.json()).episodes
      if (!Array.isArray(items) || !items.length) throw Error("Episode metadata empty")
      const byNumber = new Map<number, Metadata>((old || []).map(item => [item.number, item]))
      for (const item of items as Metadata[]) {
        const prior = byNumber.get(item.number)
        byNumber.set(item.number, { ...prior, ...item, title: item.title || prior?.title || "", image: item.image || prior?.image })
      }
      const merged = [...byNumber.values()]
      if (metadataCache.size >= 120) metadataCache.delete(metadataCache.keys().next().value!)
      metadataCache.set(key, merged)
      try {
        localStorage.setItem(metadataStoragePrefix + key, JSON.stringify({ at: Date.now(), episodes: merged }))
        const keys = Object.keys(localStorage).filter(k => k.startsWith(metadataStoragePrefix))
        while (keys.length > 50) localStorage.removeItem(keys.shift()!)
      } catch {}
      return merged
    }).finally(() => metadataPending.delete(key))
  metadataPending.set(key, request)
  return request
}
function cachedEpisodeMetadata(id: number, pages: number[]) {
  return Object.fromEntries(pages.flatMap(page => cachedEpisodePage(id, page) || []).map(item => [item.number, item])) as Record<number, Metadata>
}

export function BrowserEpisodes({ entry, watchEpisode }: { entry: Anime_Entry; watchEpisode?: number }) {
  const router = useRouter()
  const watchMode = watchEpisode !== undefined
  const m = entry.media!
  const rows = entry.episodes || []
  const total = rows.length
  const initial = getStore()

  const [selected, setSelected] = React.useState(watchEpisode || 0)
  const [audio, setAudio] = React.useState<"dub" | "sub">(
    initial.preferences?.preferredAudio === "sub" ? "sub" : "dub"
  )
  // The viewer's last explicit server choice is the default for every episode, refresh and session.
  const [selectedServer, setSelectedServer] = React.useState<string>(() => preferredNative(initial.preferences?.preferredAudio === "sub" ? "sub" : "dub", k => (JUSTANIME_SERVERS as readonly string[]).includes(k), DEFAULT_SERVER))
  const userPickedThisEpisode = React.useRef(false)
  const installedBrowserSources = useInstalledSources()
  const customSourcePrefix = "local-source:"
  const isCustomSource = selectedServer.startsWith(customSourcePrefix)
  const [serverMap, setServerMap] = React.useState<Record<string, { sub?: boolean; dub?: boolean }>>({})
  const [streams, setStreams] = React.useState<StreamSource[]>([])
  const [activeStream, setActiveStream] = React.useState<StreamSource | null>(null)
  const [tracks, setTracks] = React.useState<StreamTrack[]>([])
  const [subtitlesEnabled, setSubtitlesEnabled] = React.useState(initial.preferences?.playerSubtitles !== false)
  const [captionChoice, setCaptionChoice] = React.useState("auto")
  const [captionFiles, setCaptionFiles] = React.useState<CaptionFile[]>([])
  const [uploadedCaption, setUploadedCaption] = React.useState<CaptionFile | null>(null)
  const [captionOptions, setCaptionOptions] = React.useState<CaptionOption[]>([])
  const [captionText, setCaptionText] = React.useState("")
  const [captionRevision, setCaptionRevision] = React.useState(0)
  const [captionMessage, setCaptionMessage] = React.useState("")
  const [captionLoading, setCaptionLoading] = React.useState(false)
  const [captionDelay, setCaptionDelay] = React.useState(0)
  const [captionSize, setCaptionSize] = React.useState<number>([0.8, 1, 1.25, 1.5].includes(initial.preferences?.playerCaptionSize) ? initial.preferences.playerCaptionSize : 1)
  const [captionBackground, setCaptionBackground] = React.useState(initial.preferences?.playerCaptionBackground !== false)
  const [playerMenu, setPlayerMenu] = React.useState<PlayerMenu>(null)
  const [pipSupported, setPipSupported] = React.useState(false)
  const [pipActive, setPipActive] = React.useState(false)
  const [playerNotice, setPlayerNotice] = React.useState("")
  const [toast, setToast] = React.useState("")
  const [sourceReport, setSourceReport] = React.useState<{ name: string, reason: string }[] | null>(null)
  const [resolveNonce, setResolveNonce] = React.useState(0)
  React.useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(""), 3000)
    return () => window.clearTimeout(t)
  }, [toast])
  const [hlsLevels, setHlsLevels] = React.useState<{ index: number; label: string }[]>([])
  const [qualityLevel, setQualityLevel] = React.useState(-1)
  const [controlsVisible, setControlsVisible] = React.useState(true)
  const [isLoadingStream, setIsLoadingStream] = React.useState(false)
  const [error, setError] = React.useState("")
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [isMuted, setIsMuted] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [bufferedRanges, setBufferedRanges] = React.useState<BufferedSpan[]>([])
  const [seekHover, setSeekHover] = React.useState<SeekHover | null>(null)
  const [seekDraft, setSeekDraft] = React.useState<number | null>(null)
  const [storyboard, setStoryboard] = React.useState<SeekImage[]>([])
  const [buffering, setBuffering] = React.useState(false)
  const [playbackRevision, setPlaybackRevision] = React.useState(0)
  // Automatic failover: remember sources that failed and move to the next candidate
  // (other servers, other providers, then embedded partner players) instead of stopping.
  // iPad/iPhone home-screen apps often cannot use the Fullscreen API on an element and fall back to
  // Safari's own native player. This CSS "pseudo fullscreen" keeps AniDash's player on screen instead.
  const [pseudoFullscreen, setPseudoFullscreen] = React.useState(false)
  const forcedEmbed = React.useRef<StreamSource | null>(null)
  // Built-in servers that failed to play are hidden for 6 hours so only working sources are listed.
  const DEAD_KEY = "anidash:deadServers"
  const [deadServers, setDeadServers] = React.useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(DEAD_KEY) || "{}") as Record<string, number>
      return Object.keys(raw).filter(k => Date.now() - raw[k] < 6 * 3600 * 1000)
    } catch { return [] }
  })
  const markServerDead = React.useCallback((name?: string) => {
    const key = (name || "").toLowerCase()
    if (!key || key === "momo") return
    setDeadServers(prev => (prev.includes(key) ? prev : [...prev, key]))
    try {
      const raw = JSON.parse(localStorage.getItem("anidash:deadServers") || "{}") as Record<string, number>
      raw[key] = Date.now()
      localStorage.setItem("anidash:deadServers", JSON.stringify(raw))
    } catch {}
  }, [])
  const [titleLogo, setTitleLogo] = React.useState<string | null>(null)
  const failedStreams = React.useRef<Set<string>>(new Set())
  const streamsRef = React.useRef<StreamSource[]>([])
  const streamMetadata = React.useRef(new Map<string,{tracks:StreamTrack[],segments:SkipSegments}>())
  const stillResolving = React.useRef(false)
  const waitingForMoreSources = React.useRef(false)
  const advanceStream = React.useCallback((failedUrl: string, hideServer = true): boolean => {
    failedStreams.current.add(failedUrl)
    const failed = streamsRef.current.find(s => s.url === failedUrl)
    if (hideServer && failed && failed.type !== "embed") markServerDead(failed.server)
    if (failed?.provider && !stillResolving.current && !streamsRef.current.some(s=>s.provider===failed.provider&&!failedStreams.current.has(s.url))) Engine.recordFailure(failed.provider, "playback failed", false)
    const next = streamsRef.current.find(s => !failedStreams.current.has(s.url))
    if (next) {
      waitingForMoreSources.current = false
      setError("")
      // Before the first frame the viewer just sees the loading screen; only a mid-playback switch is announced.
      setPlayerNotice(playbackStarted.current ? "That source failed. Switching to " + (next.server || "the next source") + "…" : "")
      setActiveStream(next)
      return true
    }
    // Other providers may still be loading; resume automatically when they arrive.
    waitingForMoreSources.current = stillResolving.current
    if (waitingForMoreSources.current) { setError(""); setPlayerNotice(playbackStarted.current ? "Waiting for another source…" : ""); setBuffering(true); return true }
    return false
  }, [markServerDead])
  // Which audio the viewer is really hearing, written next to the position so the Android app can show it.
  const playbackMeta = () => activePlaybackMeta(activeStream, audio)
  const [volume, setVolume] = React.useState(1)
  const [playbackRate, setPlaybackRate] = React.useState(1)
  const [autoplay, setAutoplay] = React.useState(initial.preferences?.playerAutoplay !== false)
  const [autoSkip, setAutoSkip] = React.useState(initial.preferences?.playerAutoSkip !== false)
  const [autoNext, setAutoNext] = React.useState(initial.preferences?.playerAutoNext !== false)
  const [segments, setSegments] = React.useState<SkipSegments>(EMPTY_SEGMENTS)
  const skippedSegments = React.useRef(new Set<string>())
  const intro = withinDuration(segments.intro, duration)
  const outro = withinDuration(segments.outro, duration)
  const availableSegments = [
    ...(intro ? [{ ...intro, kind: "intro" as const }] : []),
    ...(outro ? [{ ...outro, kind: "outro" as const }] : [])
  ]
  const currentSegment = availableSegments.find(segment => currentTime >= segment.start && currentTime < segment.end)
  const displayedTime = seekDraft ?? currentTime
  const progressPercent = duration > 0 ? Math.max(0, Math.min(100, displayedTime / duration * 100)) : 0
  const aheadSeconds = bufferedAhead(bufferedRanges, currentTime)
  const hoverPreview = seekHover && storyboard.find(image => seekHover.time >= image.start && seekHover.time < image.end)

  const [arc, setArc] = React.useState("all")
  const [page, setPage] = React.useState(1)
  const [jump, setJump] = React.useState("")
  const [navigatorPage, setNavigatorPage] = React.useState(() => Math.max(1, Math.ceil((watchEpisode || 1) / 100)))
  const [navigatorMode, setNavigatorMode] = React.useState<"numbers" | "details">("numbers")
  const [navigatorJump, setNavigatorJump] = React.useState("")
  const [navigatorError, setNavigatorError] = React.useState("")
  const navigatorScroll = React.useRef<HTMLDivElement>(null)
  const [layout, setLayout] = React.useState<"grid" | "list">(
    initial.preferences?.episodeViewMode === "list" ? "list" : "grid"
  )
  const [metadata, setMetadata] = React.useState<Record<number, Metadata>>(() => cachedEpisodeMetadata(m.id, [Math.max(1, Math.ceil((watchEpisode || 1) / 100))]))
  const [metaError, setMetaError] = React.useState(false)
  const [metaRevision, setMetaRevision] = React.useState(0)

  const video = React.useRef<HTMLVideoElement>(null)
  const embeddedFrame = React.useRef<HTMLIFrameElement>(null)
  const embeddedCheckpoint = React.useRef<{url:string;episode:number;mediaId:number;value:EmbedCheckpoint;at:number;savedAt:number}|null>(null)
  const [embedTracking,setEmbedTracking]=React.useState(false)
  const embedResumeGate=React.useRef<{ready:boolean;target:number;accepted:boolean}>({ready:false,target:0,accepted:false})
  const [embedResumeTarget,setEmbedResumeTarget]=React.useState(0)
  const [embedResumePending,setEmbedResumePending]=React.useState(false)
  const seekDraftRef = React.useRef<number | null>(null)
  const seekDragging = React.useRef(false)
  const decodedPreviews = React.useRef(new Map<number, SeekImage>())
  const previewCanvas = React.useRef<HTMLCanvasElement | null>(null)
  const previewCaptureBlocked = React.useRef(false)
  const lastPreviewBucket = React.useRef(-1)
  const [previewRevision, setPreviewRevision] = React.useState(0)
  const currentHoverImage = hoverPreview || (seekHover ? decodedPreviews.current.get(Math.floor(seekHover.time / PREVIEW_STEP)) : undefined)
  // A revision makes a freshly decoded frame available while the pointer stays still.
  void previewRevision
  const manualPlaybackIntent = React.useRef<"play" | "pause" | null>(null)
  const requestedEpisode = React.useRef<number | null>(null)
  const mountedMediaEpisode = React.useRef<number | null>(null)
  const playbackStarted = React.useRef(false)
  // Source-engine health: record real playback only (first frame, then >=60 s of healthy progress).
  const streamActivatedAt = React.useRef(0)
  const stableTimer = React.useRef<number | null>(null)
  const notedStream = React.useRef("")
  const notePlaying = React.useCallback((src: StreamSource | null) => {
    if (!src?.provider || src.type === "embed" || notedStream.current === src.url) return
    notedStream.current = src.url
    Engine.recordPlaying(src.provider)
    if (streamActivatedAt.current) Engine.recordPlayStart(src.provider, Date.now() - streamActivatedAt.current)
    const startPos = video.current?.currentTime || 0
    if (stableTimer.current) window.clearTimeout(stableTimer.current)
    stableTimer.current = window.setTimeout(() => {
      const el = video.current
      // Verified only if the element is still playing this stream and the clock really advanced.
      if (el && !el.paused && !el.ended && el.currentTime - startPos >= 45) Engine.recordStable(src.provider!)
    }, Engine.STABLE_MS)
  }, [])
  React.useEffect(() => {
    streamActivatedAt.current = Date.now()
    return () => { if (stableTimer.current) window.clearTimeout(stableTimer.current); stableTimer.current = null; notedStream.current = "" }
  }, [activeStream?.url])
  const mediaAccessDenied = React.useRef(false)
  const [accessDenied, setAccessDenied] = React.useState(false)
  const autoplayRef = React.useRef(autoplay)
  autoplayRef.current = autoplay
  const playerWrapper = React.useRef<HTMLDivElement>(null)
  const surfaceClickTimer = React.useRef<number | undefined>(undefined)
  const lastSurfaceTap = React.useRef<{ at: number; x: number; y: number } | null>(null)
  const pointerDragging = React.useRef(false)
  const lastPointer = React.useRef<{ x: number; y: number } | null>(null)
  const hlsInstance = React.useRef<Hls | null>(null)
  const subtitleInput = React.useRef<HTMLInputElement>(null)
  const uploadedUrl = React.useRef<string | null>(null)
  const controlsTimer = React.useRef<number | undefined>(undefined)
  const selectedCaptionIndex = captionChoice === "auto" ? preferredEnglishTrack(captionOptions)?.index : captionOptions.find(t => t.id === captionChoice)?.index
  const captionLabel = captionOptions.find(t => t.index === selectedCaptionIndex)?.label || "Unavailable"
  const controlClass = "shrink-0 grid size-8 sm:size-10 place-items-center rounded-full text-white/90 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-35 disabled:pointer-events-none transition"
  const menuRowClass = "w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/10 focus-visible:outline focus-visible:outline-white transition"
  const lastSaved = React.useRef(0)
  const lastSynced = React.useRef(0)
  const syncBusy = React.useRef(false)
  const [syncState, setSyncState] = React.useState("")

  const arcs = React.useMemo(() => getArcs(m, total), [entry.mediaId, total])
  const group = arcs.find(a => a.id === arc)
  const filtered = rows.filter(
    e => !group || (e.episodeNumber >= group.start && e.episodeNumber <= group.end)
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const navigatorPageCount = Math.max(1, Math.ceil(total / 100))
  const activeNavigatorPage = Math.min(navigatorPage, navigatorPageCount)
  const navigatorRows = rows.filter(e => Math.ceil(e.episodeNumber / 100) === activeNavigatorPage)
  const pages =
    watchMode && selected > 0
      ? Array.from(new Set([Math.ceil(selected / 100), ...(navigatorMode === "details" ? [activeNavigatorPage] : [])])).join(",")
      : Array.from(new Set(visible.map(e => Math.ceil(e.episodeNumber / 100)))).join(",")

  // An episode transition must not replace the fullscreen wrapper or video element.
  // Clear the previous episode's media before committing the next selected episode.
  React.useLayoutEffect(() => {
    const next = watchEpisode || 0
    const playRequested = requestedEpisode.current === next && next > 0
    requestedEpisode.current = null
    mountedMediaEpisode.current = null
    manualPlaybackIntent.current = playRequested ? "play" : null
    mediaAccessDenied.current = false
    setAccessDenied(false)
    setActiveStream(null)
    setStreams([])
    setTracks([])
    setSegments(EMPTY_SEGMENTS)
    setSelected(next)
    setNavigatorPage(Math.max(1, Math.ceil((next || 1) / 100)))
    setNavigatorJump("")
    setNavigatorError("")
    setError("")
    setPlayerNotice("")
    setPlayerMenu(null)
    setSyncState("")
    setIsLoadingStream(next > 0)
    setBuffering(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setBufferedRanges([])
    setSeekHover(null)
    setSeekDraft(null)
    seekDraftRef.current = null
    setArc("all")
    setPage(1)
    setMetadata(cachedEpisodeMetadata(m.id, [Math.max(1, Math.ceil((next || 1) / 100))]))
    setJump("")
    lastSaved.current = 0
    lastSynced.current = 0
  }, [entry.mediaId, watchEpisode])

  // Scroll the selected episode into view inside the navigator, without moving the video page.
  React.useEffect(() => {
    if (!watchMode) return
    const panel = navigatorScroll.current
    if (!panel) return
    const target = panel.querySelector<HTMLElement>('[aria-current="true"]')
    if (!target) { panel.scrollTop = 0; return }
    const panelRect = panel.getBoundingClientRect(), targetRect = target.getBoundingClientRect()
    panel.scrollTop += targetRect.top - panelRect.top - (panel.clientHeight - targetRect.height) / 2
  }, [watchMode, selected, activeNavigatorPage, navigatorMode])

  // Show cached titles immediately, fetch visible pages concurrently and preload neighboring pages.
  React.useEffect(() => {
    if (!m.id || !pages) return
    let live = true
    setMetaError(false)
    const ids = pages.split(",").map(Number).filter(p => p > 0 && p <= 30)
    const cached = cachedEpisodeMetadata(m.id, ids)
    setMetadata(prev => ({ ...prev, ...cached }))
    const merge = (items: Metadata[]) => {
      if (live) setMetadata(prev => ({ ...prev, ...Object.fromEntries(items.map(x => [x.number, x])) }))
    }
    for (const p of ids) {
      void loadEpisodePage(m.id, m.idMal || 0, p, watchMode, metaRevision > 0).then(merge).catch(() => {
        if (live && !cachedEpisodePage(m.id, p)?.length) setMetaError(true)
      })
    }
    return () => { live = false }
  }, [m.id, m.idMal, pages, metaRevision, watchMode])

  React.useEffect(() => {
    if (!m.id || !pages) return
    const ids = pages.split(",").map(Number).filter(p => p > 0 && p <= 30)
    const next = Math.max(...ids) + 1
    if (next > 30 || next > Math.ceil(total / 100)) return
    const timer = window.setTimeout(() => { void loadEpisodePage(m.id, m.idMal || 0, next).catch(() => {}) }, 1000)
    return () => window.clearTimeout(timer)
  }, [m.id, m.idMal, pages, total])

  // Fetch live streams from built-in streaming APIs
  React.useEffect(() => {
    if (!watchMode || !selected) return
    let live = true
    setIsLoadingStream(true)
    setError("")
    setSegments(EMPTY_SEGMENTS)
    setTracks([])
    setCaptionText("")
    skippedSegments.current.clear()

    // Fetch server availability map in background (not for an explicitly selected local source).
    setServerMap({})
    if (!isCustomSource && Engine.isEnabled("justanime")) fetch(`/api/justanime?action=servers&id=${entry.mediaId}&episode=${selected}&category=${audio}`)
      .then(r => r.json())
      .then(d => {
        if (live && d?.serverMap) setServerMap(d.serverMap)
      })
      .catch(() => {})

    const getJson = (url: string) => cachedJson(url)

    // Collect every candidate source (all JustAnime servers, HiAnime, AniKoto direct
    // sources and the MegaPlay/Megavid/AniXo embeds). The first provider in priority
    // order that answers starts playback; the rest are appended as they arrive so the
    // player can fail over automatically.
    async function resolveStreams() {
      const serverParam = selectedServer || DEFAULT_SERVER
      const mal = m.idMal || ""
      let activated = false
      const attempted = new Map<string,string>()
      // A saved embed-player choice (e.g. a Hindi or MegaPlay server) is applied to this episode when it exists.
      const savedEmbed = forcedEmbed.current ? null : pickEmbed(loadServerPref(), audio, externalGroups().flatMap(g => g.items).filter(x => !String(x.serverId || "").match(/^(megaplay|megavid|anixo)-/) || Engine.isEnabled("embed-" + String(x.serverId).split("-")[0])) as any[]) as StreamSource | null
      const forced = forcedEmbed.current || savedEmbed
      forcedEmbed.current = null
      if (forced) {
        // The viewer picked an embed player from the other language row.
        activated = true
        setStreams([forced])
        streamsRef.current = [forced]
        setActiveStream(forced)
        setIsLoadingStream(false)
      }

      const adds: Promise<void>[] = []
      const add = async (data: any) => {
        if (!live || !data) return
        let incoming: StreamSource[] = []
        for (const src of Array.isArray(data.sources) ? data.sources : []) if (src?.url) incoming.push(src)
        // External iframe players are never selected automatically: AniDash's own player always comes first.
        if (!incoming.length) return
        // Check that each HLS playlist can really be fetched before it is allowed to start playback, so a dead
        // server is skipped silently instead of flashing an error. Unreachable ones stay in the list as a last resort.
        const checks = await Promise.all(incoming.map(src => preflightStream(src)))
        if (!live) return
        const good = new Set(incoming.filter((_, i) => checks[i]).map(x => x.url))
        incoming = [...incoming.filter(x => good.has(x.url)), ...incoming.filter(x => !good.has(x.url))]
        if (good.size) for (const src of incoming) if (!good.has(src.url)) failedStreams.current.add(src.url)
        for (const src of incoming) { streamMetadata.current.set(src.url, {tracks:Array.isArray(data.tracks)?data.tracks:[], segments:{intro:parseSkipInterval(data.intro),outro:parseSkipInterval(data.outro)}}) }
        setStreams(prev => {
          const known = new Set(prev.map(x => x.url))
          return [...prev, ...incoming.filter(x => !known.has(x.url))]
        })
        streamsRef.current = [...streamsRef.current, ...incoming.filter(x => !streamsRef.current.some(k => k.url === x.url))]
        if (!activated) {
          activated = true
          setActiveStream(incoming[0])
          setIsLoadingStream(false)
        } else if (waitingForMoreSources.current) {
          const next = incoming.find(x => !failedStreams.current.has(x.url))
          if (next) {
            waitingForMoreSources.current = false
            setError("")
            setActiveStream(next)
          }
        }
      }

      if (isCustomSource) {
        const id = selectedServer.slice(customSourcePrefix.length)
        const candidates = episodeSources(installedBrowserSources, entry.mediaId, selected, audio).filter(e=>e.sourceId===id)
        await add({sources:candidates.map(e=>({url:e.url,server:e.sourceName,serverId:selectedServer,quality:"Custom source",type:e.format==="hls"?"hls":e.format==="mp4"?"mp4":undefined,isDub:audio==="dub"}))})
        stillResolving.current=false
        if(!activated&&live){setIsLoadingStream(false);setError("This installed source has no matching episode or audio. Choose another source.")}
        return
      }
      // One automatic second round: providers that were briefly unreachable often answer on the retry.
      for (let attempt = 0; attempt < 2 && live && !activated; attempt++) {
        if (attempt > 0) await new Promise(resolve => window.setTimeout(resolve, 1200))
        const startedAt = Date.now()
        const jobList = streamJobsFor(entry.mediaId, mal, selected, audio, serverParam, [m.title?.english, m.title?.romaji].filter(Boolean) as string[], { year: m.seasonYear || m.startDate?.year, eps: m.episodes, fmt: m.format })
        if (!jobList.length) break
        // A provider counts as failed only when every one of its requests came back empty.
        const pending = new Map<string, { left: number, ok: boolean }>()
        for (const job of jobList) pending.set(job.provider, { left: (pending.get(job.provider)?.left || 0) + 1, ok: false })
        const jobs = jobList.map(job => getJson(job.url).then(data => {
          if (!live) return null
          const state = pending.get(job.provider)!
          state.left--
          const sources = Array.isArray(data?.sources) ? data.sources.filter((s:StreamSource)=>s?.url && (typeof s.isDub!=="boolean" || s.isDub===(audio==="dub"))) : []
          if (sources.length) { state.ok = true; Engine.recordResolve(job.provider, Date.now() - startedAt) }
          if (!state.ok && state.left === 0) {
            const reason = streamErrors.get(job.url) || "no matching stream"
            attempted.set(job.provider,reason)
            if (Engine.isProviderOutage(reason)) Engine.recordFailure(job.provider, reason, Engine.isPermanentError(reason))
          }
          return data ? {...data,sources:sources.map((src:StreamSource)=>({...src,provider:job.provider}))} : null
        }))
        // All providers run in parallel. The preferred server gets a short head start (so Momo stays the
        // default), but a slow or dead provider never holds playback back: whoever answers first plays.
        const tagged = jobs.map((job, index) => job.then(data => ({ index, data })))
        const remaining = new Set(tagged.map((_, index) => index))
        const grace = new Promise<null>(resolve => window.setTimeout(() => resolve(null), 2500))
        const first = await Promise.race([tagged[0], grace])
        if (first) { remaining.delete(0); adds.push(add(first.data)) }
        while (remaining.size) {
          const result = await Promise.race([...remaining].map(index => tagged[index]))
          remaining.delete(result.index)
          adds.push(add(result.data))
        }
        await Promise.all(adds)
      }

      stillResolving.current = false
      if (!live) return
      if (!activated) {
        setIsLoadingStream(false)
        setSourceReport([...attempted].map(([id,reason])=>({name:Engine.meta(id)?.name||id,reason:friendlyReason(reason)})))
        setError(attempted.size ? `AniDash cannot play ${audio.toUpperCase()} Episode ${selected} right now. See source details below.` : "No enabled compatible source is available. Enable a source in Extensions or select an installed source.")
      } else if (waitingForMoreSources.current) {
        waitingForMoreSources.current = false
        setError("All available sources failed for this episode. Try SUB/DUB or another server.")
      }
    }

    setSourceReport(null)
    failedStreams.current.clear()
    streamsRef.current = []
    streamMetadata.current.clear()
    stillResolving.current = true
    waitingForMoreSources.current = false
    setStreams([])
    setActiveStream(null)
    void resolveStreams().catch(()=>{if(live){stillResolving.current=false;setIsLoadingStream(false);setBuffering(false);setError("Source resolution failed. Retry or check Extensions.")}})
    return () => {
      live = false
      stillResolving.current = false
    }
  }, [entry.mediaId, selected, audio, selectedServer, watchMode, resolveNonce, isCustomSource ? installedBrowserSources : null])

  // Warm the next episode while this one plays, so "next" starts almost instantly.
  const prefetchedEpisode = React.useRef<number>(0)
  React.useEffect(() => {
    if (isCustomSource || !watchMode || !selected || selected >= total || !isPlaying || currentTime < 20) return
    const nextEpisode = selected + 1
    const key = entry.mediaId * 100000 + nextEpisode
    if (prefetchedEpisode.current === key) return
    prefetchedEpisode.current = key
    streamUrlsFor(entry.mediaId, m.idMal || "", nextEpisode, audio, selectedServer || DEFAULT_SERVER, [m.title?.english, m.title?.romaji].filter(Boolean) as string[], { year: m.seasonYear || m.startDate?.year, eps: m.episodes, fmt: m.format }).forEach(url => { void cachedJson(url) })
  }, [watchMode, selected, total, isPlaying, currentTime >= 20, entry.mediaId, audio, selectedServer, isCustomSource])

  React.useEffect(()=>{const metadata=activeStream?.url?streamMetadata.current.get(activeStream.url):undefined;setTracks(metadata?.tracks||[]);setSegments(metadata?.segments||EMPTY_SEGMENTS)},[activeStream?.url])

  // Playback & HLS setup
  React.useEffect(() => {
    setError("")
    const el = video.current
    if (!el || !activeStream?.url || !selected) return
    if (activeStream.type === "embed") {
      // Partner iframe players handle their own playback.
      mountedMediaEpisode.current = selected
      setBuffering(false)
      setIsPlaying(false)
      setIsLoadingStream(false)
      return
    }
    mountedMediaEpisode.current = selected

    let hls: Hls | undefined
    let live = true
    let mediaRecoveryAttempted = false
    let networkRetries = 0
    let nativeErrorCleanup: (() => void) | null = null

    playbackStarted.current = false
    mediaAccessDenied.current = false
    setAccessDenied(false)
    setPlayerNotice("")
    setBuffering(true)
    setCurrentTime(0)
    setDuration(0)
    setBufferedRanges([])
    setSeekHover(null)
    setSeekDraft(null)
    seekDraftRef.current = null
    decodedPreviews.current.clear()
    lastPreviewBucket.current = -1
    previewCaptureBlocked.current = false
    previewCanvas.current = null
    setIsPlaying(false)
    setHlsLevels([])
    setQualityLevel(-1)
    const local = localResume(m)
    const localPosition = local?.episode === selected ? local.seconds : 0
    // Account synchronization must never block the media element indefinitely.
    const resumePromise = Promise.race([
      getEpisodeResume(m, selected).catch(() => localPosition),
      new Promise<number>(resolve => window.setTimeout(() => resolve(localPosition), 1500))
    ])

    const onLoadedMetadata = async () => {
      setDuration(Number.isFinite(el.duration) ? el.duration : 0)
      const pos = await resumePromise
      if (!live || mediaAccessDenied.current) return
      if (pos > 0 && Number.isFinite(el.duration) && pos < el.duration && el.currentTime < 1) {
        el.currentTime = pos
      }
      if (manualPlaybackIntent.current === "pause" || (manualPlaybackIntent.current !== "play" && !autoplayRef.current)) {
        setBuffering(false)
        return
      }
      void el.play().catch((reason: unknown) => {
        if (!live) return
        setBuffering(false)
        setIsPlaying(false)
        if (reason instanceof DOMException && reason.name === "NotAllowedError") {
          // Start muted (always allowed), then unmute on the viewer's first tap or key press.
          el.muted = true
          void el.play().then(() => {
            if (!live) return
            setIsPlaying(true)
            setToast("Playing muted. Tap anywhere to turn the sound on.")
            const unmute = () => { el.muted = false; setToast("") }
            window.addEventListener("pointerdown", unmute, { once: true })
            window.addEventListener("keydown", unmute, { once: true })
          }).catch(() => { if (live) setPlayerNotice("Press Play to start.") })
          return
        }
        if (reason instanceof DOMException && reason.name === "AbortError") return
        setError("The browser rejected playback. Check that the media format is supported.")
      })
    }

    el.addEventListener("loadedmetadata", onLoadedMetadata, { once: true })

    const streamUrl = activeStream.url
    // Respect media format metadata rather than inferring the format from a provider name.
    const mime = (activeStream.type || "").toLowerCase()
    const explicitFile = /\.(mp4|webm|m4v|ogv|mov)(?:$|[?#])/i.test(streamUrl) ||
      /^(video\/|mp4$|webm$)/.test(mime) && !mime.includes("mpegurl")
    const isHls = activeStream.isM3U8 === true ||
      (activeStream.isM3U8 !== false && !explicitFile &&
        (/\.m3u8(?:$|[?#])/i.test(streamUrl) || /hls|mpegurl|m3u8/.test(mime)))

    if (isHls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 800,
        manifestLoadingTimeOut: 10000,
        fragLoadingTimeOut: 30000
      })
      hlsInstance.current = hls
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!live || !hls) return
        setHlsLevels(hls.levels.map((level, index) => ({ index, label: level.height ? level.height + "p" : Math.round(level.bitrate / 1000) + " kbps" })))
      })
      hls.on(Hls.Events.FRAG_BUFFERED, () => { if (live) updateBuffered(el) })
      hls.loadSource(streamUrl)
      hls.attachMedia(el)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!live || mediaAccessDenied.current) return
        const status = data.response?.code
        // Optional subtitle tracks must not terminate an otherwise authorized video.
        // Classify by the HLS fragment type or explicit subtitle event, never by URL.
        const detail = String(data.details || "")
        const optionalSubtitle = data.frag?.type === "subtitle" || /^subtitleTrack(?:LoadError|LoadTimeOut)$/i.test(detail)
        if ((status === 401 || status === 403) && optionalSubtitle) {
          if (hls) hls.subtitleTrack = -1
          setCaptionMessage("An embedded subtitle track was denied access (HTTP " + status + "). Other authorized subtitle tracks may remain available.")
          return
        }
        // A rejected video/audio/manifest request is not a bandwidth problem.
        // Stop loading on access denial; do not retry or substitute media endpoints.
        if (status === 401 || status === 403) {
          if (advanceStream(activeStream.url)) return
          mediaAccessDenied.current = true
          setAccessDenied(true)
          setBuffering(false)
          setIsPlaying(false)
          const resource = data.frag?.type === "audio" ? "audio" : data.frag?.type === "main" ? "video segment" : "media request"
          setError("The provider denied the " + resource + " (HTTP " + status + "). Authorized playback is required.")
          hls?.stopLoad()
          el.pause()
          return
        }
        if (!data.fatal) return
        // HLS has already exhausted its normal retries when it reports a fatal error.
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecoveryAttempted) {
          mediaRecoveryAttempted = true
          hls?.recoverMediaError()
          return
        }
        // Segment downloads can fail briefly through the relay: restart loading a few times before giving up.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 4) {
          networkRetries += 1
          window.setTimeout(() => { if (live) hls?.startLoad(Math.max(0, el.currentTime)) }, 1200 * networkRetries)
          return
        }
        if (advanceStream(activeStream.url, data.type !== Hls.ErrorTypes.NETWORK_ERROR)) return
        setBuffering(false)
        setIsPlaying(false)
        const safeDetail = detail.replace(/[^a-zA-Z0-9_ -]/g, "").slice(0, 80)
        const reason = data.type === Hls.ErrorTypes.NETWORK_ERROR ? "The media data could not be downloaded."
          : data.type === Hls.ErrorTypes.MEDIA_ERROR ? "The browser could not decode the media."
          : "The stream could not be played."
        setError(reason + (status ? " HTTP " + status + "." : "") + (safeDetail ? " (" + safeDetail + ")" : ""))
        hls?.stopLoad()
      })
    } else {
      el.src = streamUrl
      const onNativeError = () => {
        if (!live || advanceStream(streamUrl)) return
        setBuffering(false)
        setIsPlaying(false)
        setError("This source could not be played. Try another server.")
      }
      el.addEventListener("error", onNativeError, { once: true })
      nativeErrorCleanup = () => el.removeEventListener("error", onNativeError)
    }

    return () => {
      live = false
      if (mountedMediaEpisode.current === selected) mountedMediaEpisode.current = null
      el.removeEventListener("loadedmetadata", onLoadedMetadata)
      nativeErrorCleanup?.()
      if (hlsInstance.current === hls) hlsInstance.current = null
      hls?.destroy()
      el.pause()
      el.removeAttribute("src")
      el.load()
    }
  }, [activeStream?.url, selected, playbackRevision, advanceStream])

  React.useEffect(() => {
    if (activeStream?.type !== "embed" || externalNoticeShown) return
    externalNoticeShown = true
    setToast("This is the provider's own player, so AniDash controls are not available here.")
  }, [activeStream?.url, activeStream?.type])

  // A source that never begins playing must not leave the viewer on a frozen first frame.
  React.useEffect(() => {
    if (!activeStream?.url || activeStream.type === "embed" || isLoadingStream || error) return
    const el = video.current
    if (!el) return
    const url = activeStream.url
    const timer = window.setTimeout(() => {
      if (playbackStarted.current || el.readyState >= 3) return
      if (manualPlaybackIntent.current === "pause") return
      if(!advanceStream(url)){setBuffering(false);setIsPlaying(false);setError("This source did not start within 14 seconds. Retry or select another source.")}
    }, 14000)
    return () => window.clearTimeout(timer)
  }, [activeStream?.url, activeStream?.type, isLoadingStream, error, playbackRevision, advanceStream])

  // Surface media stalls rather than displaying an endless loading indicator.
  React.useEffect(() => {
    if (!buffering || !activeStream?.url || isLoadingStream || error) return
    // A short initial stall should not forcibly pause a media element that is still loading.
    const el = video.current
    if (!el) return
    let previousEnd = el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0
    let previousTime = el.currentTime
    let lastProgress = performance.now()
    const timer = window.setInterval(() => {
      const end = el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0
      if (end > previousEnd + 0.05 || el.currentTime > previousTime + 0.05) lastProgress = performance.now()
      previousEnd = end
      previousTime = el.currentTime
      if (performance.now() - lastProgress < 30000) return
      window.clearInterval(timer)
      if (advanceStream(activeStream.url)) return
      setBuffering(false)
      setIsPlaying(false)
      const state = el.readyState < 2 ? "No decoded video frames are available." : "Playback has not advanced."
      setError(state + " No media progress for 30 seconds. Retry playback.")
      window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [buffering, activeStream?.url, isLoadingStream, error, playbackRevision, advanceStream])

  // External subtitles use ordinary browser CORS, converted to local WebVTT.
  // No media-source settings, credentials or access restrictions are changed.
  React.useEffect(() => {
    if (!watchMode) return
    const abort = new AbortController()
    const urls: string[] = []
    setCaptionFiles([])
    setCaptionText("")
    setCaptionMessage("")
    setCaptionLoading(false)
    setCaptionChoice("auto")
    const candidates = tracks.map(captionSource).filter((item): item is CaptionFile => !!item)
    if (!candidates.length) return () => abort.abort()
    setCaptionLoading(true)
    void Promise.all(candidates.map(async item => {
      try {
        const response = await fetch(item.url, { signal: abort.signal, credentials: "same-origin" })
        if (!response.ok) throw Error("Subtitle request failed")
        const raw = await response.text()
        if (raw.length > 2_000_000 || abort.signal.aborted) return null
        const url = URL.createObjectURL(new Blob([subtitleVtt(raw)], { type: "text/vtt" }))
        urls.push(url)
        const file = { ...item, url }
        setCaptionFiles(previous => [...previous.filter(t => t.id !== file.id), file].sort((a, b) => Number(a.id.slice(7)) - Number(b.id.slice(7))))
        return file
      } catch { return null }
    })).then(results => {
      if (abort.signal.aborted) return
      const files = results.filter((item): item is CaptionFile => !!item)
      setCaptionLoading(false)
      if (files.length < candidates.length) setCaptionMessage((candidates.length - files.length) + " subtitle track(s) could not be loaded by this browser.")
    })
    return () => { abort.abort(); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [watchMode, tracks])

  React.useEffect(() => {
    setUploadedCaption(null)
    setCaptionDelay(0)
    setCaptionText("")
    if (uploadedUrl.current) { URL.revokeObjectURL(uploadedUrl.current); uploadedUrl.current = null }
    return () => { if (uploadedUrl.current) { URL.revokeObjectURL(uploadedUrl.current); uploadedUrl.current = null } }
  }, [entry.mediaId, selected])

  React.useEffect(() => {
    if (!watchMode) return
    const el = video.current
    if (!el) return
    const list = el.textTracks
    function refresh() {
      const items = Array.from(list).flatMap((track, index) => {
        if (track.kind !== "subtitles" && track.kind !== "captions") return []
        const language = captionLanguage(track.language || "", track.label || "")
        const element = Array.from(el!.querySelectorAll("track")).find(item => item.track === track)
        const id = element?.id || "native-" + index
        return [{ id, index, label: captionDisplayName(language, track.label || track.language || ""), language }]
      })
      const seen = new Map<string, number>()
      setCaptionOptions(items.map(item => {
        const count = (seen.get(item.label) || 0) + 1
        seen.set(item.label, count)
        return count > 1 ? { ...item, label: item.label + " (" + count + ")" } : item
      }))
    }
    refresh()
    list.addEventListener("addtrack", refresh)
    list.addEventListener("removetrack", refresh)
    el.addEventListener("loadedmetadata", refresh)
    return () => { list.removeEventListener("addtrack", refresh); list.removeEventListener("removetrack", refresh); el.removeEventListener("loadedmetadata", refresh) }
  }, [watchMode, captionFiles, uploadedCaption, activeStream?.url])

  React.useEffect(() => {
    const el = video.current
    if (!el) return
    const index = subtitlesEnabled ? selectedCaptionIndex : undefined
    const track = index === undefined ? null : el.textTracks[index]
    for (const item of Array.from(el.textTracks)) {
      if (item.kind !== "subtitles" && item.kind !== "captions") continue
      const mode = item === track ? (pipActive ? "showing" : "hidden") : "disabled"
      if (item.mode !== mode) item.mode = mode
    }
    function refresh() {
      if (!track || pipActive || !el) { setCaptionText(""); return }
      const time = el.currentTime - captionDelay
      const cues = captionDelay === 0 ? Array.from(track.activeCues || []) : Array.from(track.cues || []).filter(cue => cue.startTime <= time && time < cue.endTime)
      setCaptionText(cues.map(captionPlainText).filter(Boolean).join("\n"))
    }
    refresh()
    track?.addEventListener("cuechange", refresh)
    el.addEventListener("timeupdate", refresh)
    el.addEventListener("seeked", refresh)
    el.addEventListener("loadeddata", refresh)
    return () => { track?.removeEventListener("cuechange", refresh); el.removeEventListener("timeupdate", refresh); el.removeEventListener("seeked", refresh); el.removeEventListener("loadeddata", refresh) }
  }, [watchMode, subtitlesEnabled, selectedCaptionIndex, captionOptions, captionDelay, pipActive, activeStream?.url, captionRevision])

  React.useEffect(() => {
    if (!watchMode) return
    const el = video.current as PipVideo | null
    if (!el) return
    const doc = document as PipDocument
    const refresh = () => {
      setPipSupported(Boolean((doc.pictureInPictureEnabled && el.requestPictureInPicture) || el.webkitSupportsPresentationMode?.("picture-in-picture")))
      setPipActive(doc.pictureInPictureElement === el || el.webkitPresentationMode === "picture-in-picture")
    }
    refresh()
    for (const event of ["loadedmetadata", "enterpictureinpicture", "leavepictureinpicture", "webkitpresentationmodechanged"]) el.addEventListener(event, refresh)
    return () => { for (const event of ["loadedmetadata", "enterpictureinpicture", "leavepictureinpicture", "webkitpresentationmodechanged"]) el.removeEventListener(event, refresh) }
  }, [watchMode, activeStream?.url])

  // Only use already supplied, browser-accessible storyboard metadata. No additional media source or hidden video is opened.
  React.useEffect(() => {
    if (!watchMode) return
    const controller = new AbortController()
    setStoryboard([])
    const url = tracks.map(previewTrackUrl).find((value): value is string => !!value)
    if (!url) return () => controller.abort()
    void fetch(url, { signal: controller.signal, credentials: "same-origin" }).then(async response => {
      if (!response.ok) return
      const text = await response.text()
      if (text.length > 2_000_000 || controller.signal.aborted) return
      const images = parsePreviewVtt(text, response.url || url)
      if (!controller.signal.aborted) setStoryboard(images)
    }).catch(() => {})
    return () => controller.abort()
  }, [watchMode, tracks])

  function updateBuffered(el: HTMLVideoElement) {
    const ranges = readBufferedRanges(el.buffered, el.duration)
    setBufferedRanges(previous => previous.length === ranges.length && previous.every((item, i) => item.start === ranges[i].start && item.end === ranges[i].end) ? previous : ranges)
  }

  function rememberDecodedFrame(el: HTMLVideoElement) {
    if (!playbackStarted.current || mediaAccessDenied.current || previewCaptureBlocked.current || el.seeking || el.readyState < 3 || !el.videoWidth || !el.videoHeight || storyboard.length) return
    const bucket = Math.floor(el.currentTime / PREVIEW_STEP)
    if (bucket === lastPreviewBucket.current || decodedPreviews.current.has(bucket)) return
    lastPreviewBucket.current = bucket
    try {
      const canvas = previewCanvas.current || document.createElement("canvas")
      previewCanvas.current = canvas
      canvas.width = 160
      canvas.height = Math.max(1, Math.round(160 * el.videoHeight / el.videoWidth))
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
      const url = canvas.toDataURL("image/jpeg", 0.55)
      if (url === "data:,") return
      const cache = decodedPreviews.current
      cache.set(bucket, { start: el.currentTime, end: el.currentTime + PREVIEW_STEP, url })
      while (cache.size > 180) cache.delete(cache.keys().next().value!)
      setPreviewRevision(n => n + 1)
    } catch {
      // Browser origin restrictions are respected; use timestamp-only preview if frames cannot be read.
      previewCaptureBlocked.current = true
    }
  }

  function hoverTimeline(e: React.PointerEvent<HTMLElement>) {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setSeekHover({ fraction, time: fraction * duration })
    wakeControls()
  }

  function changeSeek(value: number) {
    const el = video.current
    if (!el || !duration) return
    const time = Math.max(0, Math.min(duration, value))
    if (seekDragging.current) {
      seekDraftRef.current = time
      setSeekDraft(time)
      setSeekHover({ fraction: time / duration, time })
    } else {
      el.currentTime = time
      setCurrentTime(time)
    }
  }

  // The paused frame is also clean after inactivity; keep controls available for menus, loading and errors.
  const canHideControls = !!activeStream?.url && !playerMenu && !error && !buffering && !isLoadingStream
  const hideAllowedRef = React.useRef(canHideControls)
  hideAllowedRef.current = canHideControls

  const cancelHide = React.useCallback(() => {
    if (controlsTimer.current !== undefined) window.clearTimeout(controlsTimer.current)
    controlsTimer.current = undefined
  }, [])
  const wakeControls = React.useCallback(() => {
    setControlsVisible(true)
    cancelHide()
    if (!hideAllowedRef.current || pointerDragging.current) return
    controlsTimer.current = window.setTimeout(() => {
      controlsTimer.current = undefined
      if (!hideAllowedRef.current || pointerDragging.current) return
      const wrapper = playerWrapper.current
      const focused = document.activeElement
      // A focused control must not block auto-hide indefinitely or retain hidden focus.
      if (wrapper && focused instanceof HTMLElement && focused !== wrapper && wrapper.contains(focused)) {
        wrapper.focus({ preventScroll: true })
        cancelHide()
      }
      setControlsVisible(false)
    }, CONTROL_IDLE_MS)
  }, [cancelHide])

  React.useEffect(() => {
    wakeControls()
    return cancelHide
  }, [canHideControls, isPlaying, watchMode, wakeControls, cancelHide])

  function focusPlayer() {
    playerWrapper.current?.focus({ preventScroll: true })
  }

  function onPlayerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const last = lastPointer.current
    if (last && last.x === e.clientX && last.y === e.clientY) return
    lastPointer.current = { x: e.clientX, y: e.clientY }
    wakeControls()
  }

  function returnPointerFocus(e: React.MouseEvent<HTMLElement>) {
    // A pointer click performs its original action first; then restore player focus.
    // Keyboard-generated clicks (detail === 0) retain normal accessible focus.
    if (e.detail === 0) return
    const target = e.target
    if (!(target instanceof Element)) return
    if (target.closest('input:not([type="range"]),textarea,select,a,[contenteditable="true"]')) return
    if (target.closest('button,[role="button"],[data-player-wrapper]')) {
      if (target.closest('button,[role="button"]') && !target.closest("[data-player-surface-action]")) cancelSurfaceTap()
      focusPlayer()
      wakeControls()
    }
  }

  function startSliderDrag() {
    pointerDragging.current = true
    wakeControls()
  }

  React.useEffect(() => {
    if (!watchMode) return
    const finish = (event: Event) => {
      if (!pointerDragging.current) return
      pointerDragging.current = false
      if (seekDragging.current) {
        const el = video.current, draft = seekDraftRef.current
        if (event.type === "pointerup" && el && draft !== null && Number.isFinite(el.duration)) {
          el.currentTime = Math.max(0, Math.min(el.duration, draft))
          setCurrentTime(el.currentTime)
        }
        seekDragging.current = false
        seekDraftRef.current = null
        setSeekDraft(null)
        setSeekHover(null)
      }
      focusPlayer()
      wakeControls()
    }
    const fullscreenChanged = () => { focusPlayer(); wakeControls() }
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
    window.addEventListener("blur", finish)
    document.addEventListener("fullscreenchange", fullscreenChanged)
    document.addEventListener("webkitfullscreenchange", fullscreenChanged)
    return () => {
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      window.removeEventListener("blur", finish)
      document.removeEventListener("fullscreenchange", fullscreenChanged)
      document.removeEventListener("webkitfullscreenchange", fullscreenChanged)
      if (surfaceClickTimer.current !== undefined) window.clearTimeout(surfaceClickTimer.current)
      surfaceClickTimer.current = undefined
      lastSurfaceTap.current = null
      pointerDragging.current = false
      seekDragging.current = false
      seekDraftRef.current = null
    }
  }, [watchMode, wakeControls])

  function cancelSurfaceTap() {
    if (surfaceClickTimer.current !== undefined) window.clearTimeout(surfaceClickTimer.current)
    surfaceClickTimer.current = undefined
    lastSurfaceTap.current = null
  }

  function clickVideoSurface(e: React.MouseEvent<HTMLElement>) {
    wakeControls()
    if (playerMenu) { cancelSurfaceTap(); setPlayerMenu(null); focusPlayer(); return }
    if (e.button !== 0) return
    const now = performance.now()
    const previous = lastSurfaceTap.current
    const pending = surfaceClickTimer.current !== undefined
    const closeEnough = previous && Math.hypot(e.clientX - previous.x, e.clientY - previous.y) <= FULLSCREEN_DOUBLE_TAP_RADIUS
    // Do not use the browser's slower, OS-dependent dblclick interval.
    if (pending && previous && closeEnough && now - previous.at <= FULLSCREEN_DOUBLE_TAP_MS) {
      cancelSurfaceTap()
      toggleFullscreen()
      return
    }
    if (pending) {
      cancelSurfaceTap()
      togglePlay()
    }
    lastSurfaceTap.current = { at: now, x: e.clientX, y: e.clientY }
    surfaceClickTimer.current = window.setTimeout(() => {
      surfaceClickTimer.current = undefined
      lastSurfaceTap.current = null
      togglePlay()
    }, FULLSCREEN_DOUBLE_TAP_MS)
  }

  async function uploadCaption(file: File | undefined) {
    if (!file) return
    try {
      if (file.size > 2_000_000) throw Error("Subtitle file must be under 2 MB.")
      const converted = subtitleVtt(await file.text())
      if (uploadedUrl.current) URL.revokeObjectURL(uploadedUrl.current)
      const url = URL.createObjectURL(new Blob([converted], { type: "text/vtt" }))
      uploadedUrl.current = url
      setUploadedCaption({ id: "upload", url, label: file.name, language: "und" })
      setCaptionChoice("upload")
      setCaptionMessage("Uploaded subtitle selected.")
      updateCaptionEnabled(true)
    } catch (reason) { setCaptionMessage(reason instanceof Error ? reason.message : "Subtitle upload failed.") }
  }
  function updateCaptionEnabled(enabled: boolean) {
    setSubtitlesEnabled(enabled)
    const st = getStore()
    saveStore({ ...st, preferences: { ...st.preferences, playerSubtitles: enabled } })
  }
  function updateCaptionAppearance(size: number, background: boolean) {
    setCaptionSize(size)
    setCaptionBackground(background)
    const st = getStore()
    saveStore({ ...st, preferences: { ...st.preferences, playerCaptionSize: size, playerCaptionBackground: background } })
  }
  async function togglePip() {
    const el = video.current as PipVideo | null
    if (!el) return
    const doc = document as PipDocument
    try {
      if (doc.pictureInPictureElement === el && doc.exitPictureInPicture) await doc.exitPictureInPicture()
      else if (doc.pictureInPictureEnabled && el.requestPictureInPicture) await el.requestPictureInPicture()
      else if (el.webkitSupportsPresentationMode?.("picture-in-picture")) el.webkitSetPresentationMode?.(el.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture")
      else setPlayerNotice("Picture-in-Picture is not supported in this browser.")
    } catch { setPlayerNotice("Picture-in-Picture is unavailable for the current video.") }
  }
  function chooseQuality(index: number) {
    if (hlsInstance.current) {
      hlsInstance.current.currentLevel = index
      setQualityLevel(index)
    }
  }

  // Watch progress recording & AniList cross-device sync
  function record(force = false, ended = false) {
    if(activeStream?.type==="embed"){
      const checkpoint=embeddedCheckpoint.current
      if(!checkpoint||checkpoint.url!==activeStream.url||checkpoint.episode!==selected||checkpoint.mediaId!==m.id||checkpoint.at===checkpoint.savedAt)return
      const value=checkpoint.value
      if(!force&&Date.now()-lastSaved.current<5000)return
      lastSaved.current=Date.now()
      persistPlayback(m,selected,value.position,value.duration,value.ended)
      if(force||value.ended||Date.now()-lastSynced.current>=10000){
        checkpoint.savedAt=checkpoint.at
        lastSynced.current=Date.now()
        void syncPlayback(m,selected,value.position,value.duration,value.ended,playbackMeta()).then(ok=>setSyncState(ok?"Synced with AniList":"Saved locally · cloud sync pending or not signed in")).catch(()=>setSyncState("Saved locally · cloud sync pending"))
      }
      return
    }
    const el = video.current
    if (!el || !selected || mountedMediaEpisode.current !== selected || !Number.isFinite(el.duration) || el.duration <= 0) return
    // Leaving in the last 30 seconds (credits) counts as finished, so the next episode is what resumes.
    ended = ended || el.ended || el.duration - el.currentTime <= 30
    if (!force && Date.now() - lastSaved.current < 5000) return
    const position = ended ? el.duration : el.currentTime
    if (position < 1 && !ended) return
    lastSaved.current = Date.now()
    persistPlayback(m, selected, position, el.duration, ended)

    if ((force || Date.now() - lastSynced.current >= 10000) && (!syncBusy.current || force)) {
      lastSynced.current = Date.now()
      syncBusy.current = true
      setSyncState("Saving progress…")
      void syncPlayback(m, selected, position, el.duration, ended, playbackMeta())
        .then(ok => setSyncState(ok ? "Synced with AniList" : "Saved locally · cloud sync pending or not signed in"))
        .catch(() => {
          lastSynced.current = 0
          setSyncState("Saved on this device · AniList sync failed")
        })
        .finally(() => {
          syncBusy.current = false
        })
    }
  }

  React.useEffect(() => {
    if (!watchMode) return
    const save = () => {
      if (document.visibilityState === "hidden") record(true)
    }
    const pagehide=()=>record(true)
    const reconnect=()=>{void flushPlaybackQueue().catch(()=>{})}
    document.addEventListener("visibilitychange", save)
    window.addEventListener("pagehide",pagehide)
    window.addEventListener("online",reconnect)
    reconnect()
    return () => {document.removeEventListener("visibilitychange", save);window.removeEventListener("pagehide",pagehide);window.removeEventListener("online",reconnect)}
  }, [watchMode, selected, activeStream?.url])

  // Navigation handlers
  function openEpisode(n: number, alreadyRecorded = false) {
    if (!Number.isSafeInteger(n) || n < 1 || n > total || (watchMode && n === selected)) return
    if (watchMode) {
      if (!alreadyRecorded) record(true)
      requestedEpisode.current = n
      mountedMediaEpisode.current = null
      cancelSurfaceTap()
      setPlayerMenu(null)
      // A deliberate episode change is a play request, even if initial autoplay is disabled.
      router.push(`/entry?id=${entry.mediaId}&episode=${n}`, { resetScroll: false })
      return
    }
    router.push(`/entry?id=${entry.mediaId}&episode=${n}`)
  }

  function submitNavigatorJump(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const n = Number(navigatorJump.trim())
    if (!navigatorJump.trim() || !Number.isSafeInteger(n) || !rows.some(row => row.episodeNumber === n)) {
      setNavigatorError("Enter a released episode number from 1 to " + total + ".")
      return
    }
    setNavigatorError("")
    openEpisode(n)
  }

  function closePlayer() {
    if (watchMode) record(true)
    router.push(`/entry?id=${entry.mediaId}`)
  }

  React.useEffect(()=>{
    embeddedCheckpoint.current=null;setEmbedTracking(false);setEmbedResumeTarget(0);setEmbedResumePending(false)
    embedResumeGate.current={ready:false,target:0,accepted:false}
    if(activeStream?.type!=="embed")return
    const url=activeStream.url,origin=embedProgressOrigin(url)
    let live=true
    void getEpisodeResume(m,selected).then(target=>{if(!live)return;embedResumeGate.current={ready:true,target,accepted:target<5};setEmbedResumeTarget(target);setEmbedResumePending(target>=5)}).catch(()=>{if(live)embedResumeGate.current={ready:true,target:0,accepted:true}})
    if(!origin)return()=>{live=false}
    const receive=(event:MessageEvent)=>{
      if(event.origin!==origin||!embeddedFrame.current||event.source!==embeddedFrame.current.contentWindow)return
      const previous=embeddedCheckpoint.current
      const value=readEmbedCheckpoint(origin,event.data,previous?.value||null)
      if(!value)return
      const gate=embedResumeGate.current
      if(!gate.ready)return
      if(!gate.accepted){if(value.position<Math.max(0,gate.target-5))return;gate.accepted=true;setEmbedResumePending(false)}
      if(previous&&previous.value.position===value.position&&previous.value.duration===value.duration&&previous.value.ended===value.ended)return
      embeddedCheckpoint.current={url,episode:selected,mediaId:m.id,value,at:Date.now(),savedAt:previous?.savedAt||0}
      setEmbedTracking(true)
      record(value.ended)
    }
    window.addEventListener("message",receive)
    return()=>{live=false;window.removeEventListener("message",receive)}
  },[activeStream?.url,activeStream?.type,selected,m.id])

  const [manualPosition,setManualPosition]=React.useState("")
  const [manualDuration,setManualDuration]=React.useState("")
  const [manualMessage,setManualMessage]=React.useState("")
  React.useEffect(()=>{
    if(activeStream?.type!=="embed")return
    let live=true;setManualMessage("");setManualPosition("");setManualDuration("")
    void getEpisodeResume(m,selected).then(sec=>{if(live&&sec>0)setManualPosition(formatPosition(sec))}).catch(()=>{})
    const local=localResume(m);if(local?.episode===selected&&local.duration>0)setManualDuration(formatPosition(local.duration))
    return()=>{live=false}
  },[activeStream?.url,selected,m.id])
  async function saveManualCheckpoint(){
    const seconds=parseManualPosition(manualPosition),duration=parseManualPosition(manualDuration)
    if(seconds===null||duration===null||duration<=0||seconds>=duration){setManualMessage("Enter your actual position and total duration (MM:SS or HH:MM:SS). Position must be before the end.");return}
    embeddedCheckpoint.current=null
    embedResumeGate.current={ready:true,target:seconds,accepted:true};setEmbedResumePending(false)
    persistPlayback(m,selected,seconds,duration,false)
    setManualMessage("Checkpoint saved locally. Syncing…")
    try{const ok=await syncPlayback(m,selected,seconds,duration,false,playbackMeta());setManualMessage(ok?"Checkpoint synced with AniList. Seek to this time on the other player.":"Checkpoint saved locally; cloud sync pending or not signed in.")}catch{setManualMessage("Checkpoint saved locally; cloud sync pending.")}
  }

  // Language players (animehindi.fun and similar) are loaded per episode and shown in their own section.
  const [langEmbeds, setLangEmbeds] = React.useState<StreamSource[]>([])
  React.useEffect(() => {
    let live = true
    setLangEmbeds([])
    const t = m.title?.english || m.title?.romaji || ""
    if (!t || !selected || !Engine.isEnabled("hindi")) return
    const qs = "kind=" + (m.format === "MOVIE" ? "movie" : "tv") + "&episode=" + selected + "&title=" + encodeURIComponent(t) + "&alt=" + encodeURIComponent(m.title?.romaji || "") + "&total=" + (m.episodes || 0)
    fetch("/api/justanime?action=hindi&" + qs, { signal: AbortSignal.timeout(20000) })
      .then(r => (r.ok ? (r.json() as Promise<{ embeds?: Array<{ url: string; name?: string; id?: string; lang?: string }> }>) : null))
      .then(d => {
        if (!live || !d?.embeds?.length) return
        setLangEmbeds(d.embeds.map(e => ({ url: e.url, type: "embed", server: e.name || "Player", serverId: e.id, lang: e.lang || "hi", isDub: true }) as unknown as StreamSource))
      })
      .catch(() => {})
    return () => { live = false }
  }, [m.id, selected])
  React.useEffect(() => { userPickedThisEpisode.current = false }, [entry.mediaId, selected])
  // Language players load after the native sources; apply the saved one as soon as it is available,
  // unless the viewer already picked something for this episode.
  React.useEffect(() => {
    if (!watchMode || !langEmbeds.length || userPickedThisEpisode.current || activeStream?.type === "embed") return
    const hit = pickEmbed(loadServerPref(), audio, langEmbeds as any[]) as StreamSource | null
    if (hit) openExternal(hit, false)
  }, [langEmbeds, watchMode])
  function externalGroups() {
    const ep = selected || 1
    const mal = m.idMal
    const english = (lang: "sub" | "dub"): StreamSource[] => [
      { server: "MegaPlay", serverId: "megaplay-" + lang, url: mal ? `https://megaplay.buzz/stream/mal/${mal}/${ep}/${lang}` : `https://megaplay.buzz/stream/ani/${m.id}/${ep}/${lang}` },
      { server: "Megavid", serverId: "megavid-" + lang, url: mal ? `https://megavid.buzz/mal/${mal}/${ep}/${lang}?color=%23e63946&autoplay=true` : `https://megavid.buzz/ani/${m.id}/${ep}/${lang}?color=%23e63946&autoplay=true` },
      { server: "AniXo", serverId: "anixo-" + lang, url: `https://anixo.buzz/embed/ani/${m.id}/${ep}/${lang}?color=%23e63946` }
    ].map(e => ({ ...e, type: "embed", isDub: lang === "dub" }) as StreamSource)
    const groups: Array<{ key: string; label: string; note?: string; tone: "sky" | "amber"; items: StreamSource[] }> = [
      { key: "en-sub", label: "SUB", note: "Japanese", tone: "sky", items: english("sub") },
      { key: "en-dub", label: "DUB", note: "English", tone: "sky", items: english("dub") }
    ]
    const byLang = new Map<string, StreamSource[]>()
    for (const e of langEmbeds) {
      const code = String((e as any).lang || "hi")
      byLang.set(code, [...(byLang.get(code) || []), e])
    }
    for (const [code, items] of byLang) groups.push({ key: "lang-" + code, label: LANG_NAMES[code] || code.toUpperCase(), tone: "amber", items })
    return groups
  }
  function openExternal(e: StreamSource, remember = true) {
    if (remember) {
      userPickedThisEpisode.current = true
      rememberEmbed({ serverId: e.serverId, name: e.server, lang: String((e as any).lang || "en"), audio: e.isDub ? "dub" : (e as any).lang && (e as any).lang !== "en" ? audio : "sub" })
    }
    record(true)
    setError(""); setAccessDenied(false); setPlayerNotice("")
    setStreams(prev => (prev.some(x => x.url === e.url) ? prev : [...prev, e]))
    if (!streamsRef.current.some(x=>x.url===e.url)) streamsRef.current = [...streamsRef.current,e]
    setActiveStream(e)
  }
  function changeAudio(a: "dub" | "sub") {
    if (watchMode) record(true)
    setAudio(a)
    const s = getStore()
    saveStore({ ...s, preferences: { ...s.preferences, preferredAudio: a } })
  }

  function pickServer(serverKey: string, channel: "sub" | "dub") {
    userPickedThisEpisode.current = true
    rememberNative(channel, serverKey)
    if (watchMode) record(true)
    setAudio(channel)
    setSelectedServer(serverKey)
    if (activeStream?.type === "embed") setResolveNonce(n => n + 1)
    const s = getStore()
    saveStore({ ...s, preferences: { ...s.preferences, preferredAudio: channel } })
  }

  function setPlaybackPreference(key: "playerAutoplay" | "playerAutoSkip" | "playerAutoNext", enabled: boolean) {
    if (key === "playerAutoplay") { autoplayRef.current = enabled; setAutoplay(enabled) }
    if (key === "playerAutoSkip") setAutoSkip(enabled)
    if (key === "playerAutoNext") setAutoNext(enabled)
    const s = getStore()
    saveStore({ ...s, preferences: { ...s.preferences, [key]: enabled } })
  }

  function skipSegment(segment: SkipInterval & { kind: "intro" | "outro" }) {
    const el = video.current
    if (!el || !Number.isFinite(el.duration) || segment.end > el.duration + 1) return
    skippedSegments.current.add(segment.kind)
    el.currentTime = Math.min(el.duration, segment.end)
    setCurrentTime(el.currentTime)
  }

  // Player control actions
  function togglePlay() {
    const el = video.current
    if (!el || mediaAccessDenied.current) return
    if (el.paused) {
      manualPlaybackIntent.current = "play"
      setError("")
      void el.play().catch((reason: unknown) => {
        setBuffering(false)
        setIsPlaying(false)
        if (reason instanceof DOMException && (reason.name === "NotAllowedError" || reason.name === "AbortError")) return
        setError("The browser rejected playback. Check that the media format is supported.")
      })
    } else { manualPlaybackIntent.current = "pause"; el.pause() }
  }

  function seekRel(deltaSeconds: number) {
    const el = video.current
    if (!el) return
    el.currentTime = Math.max(0, Math.min(el.duration || Infinity, el.currentTime + deltaSeconds))
    setCurrentTime(el.currentTime)
  }

  function toggleMute() {
    const el = video.current
    if (!el) return
    el.muted = !el.muted
    setIsMuted(el.muted)
  }

  function toggleFullscreen() {
    const container = (playerWrapper.current || video.current) as (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | null
    if (!container) return
    setPlayerMenu(null)
    wakeControls()
    focusPlayer()
    const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void }
    if (pseudoFullscreen) {
      setPseudoFullscreen(false)
      return
    }
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => {})
      else doc.webkitExitFullscreen?.()
      return
    }
    // Real fullscreen hides the system status bar where the browser allows it. Never hand the video to
    // Safari's native player (webkitEnterFullscreen); fall back to the in-page fullscreen layout instead.
    const request = container.requestFullscreen ? (() => container.requestFullscreen({ navigationUI: "hide" })) as () => Promise<void> : container.webkitRequestFullscreen?.bind(container)
    if (!request) {
      setPseudoFullscreen(true)
      return
    }
    try {
      const result = request()
      if (result && typeof (result as Promise<void>).catch === "function") (result as Promise<void>).catch(() => setPseudoFullscreen(true))
    } catch {
      setPseudoFullscreen(true)
    }
  }

  // Leave the in-page fullscreen layout with Escape, and stop the page behind it from scrolling.
  React.useEffect(() => {
    if (!pseudoFullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPseudoFullscreen(false) }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [pseudoFullscreen])

  // If Safari ever opens its own full-screen player anyway, close it and stay in AniDash's player.
  React.useEffect(() => {
    const el = video.current as (HTMLVideoElement & { webkitExitFullscreen?: () => void }) | null
    if (!el) return
    const onNativeFullscreen = () => {
      el.webkitExitFullscreen?.()
      setPseudoFullscreen(true)
    }
    el.addEventListener("webkitbeginfullscreen", onNativeFullscreen)
    return () => el.removeEventListener("webkitbeginfullscreen", onNativeFullscreen)
  }, [watchMode])

  function toggleSubtitles() {
    updateCaptionEnabled(!subtitlesEnabled)
  }

  // Capture playback shortcuts before a mouse-clicked control can consume Space.
  // Preserve text editing, Tab navigation and keyboard activation of real controls.
  const shortcutHandler = React.useRef<(e: KeyboardEvent) => void>(() => {})
  shortcutHandler.current = (e: KeyboardEvent) => {
    if (!watchMode || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest('aside[aria-label="Episode navigator"]')) return
    if (target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return
    if (e.code === "Escape" && playerMenu) {
      e.preventDefault()
      e.stopPropagation()
      setPlayerMenu(null)
      focusPlayer()
      wakeControls()
      return
    }
    const focusedControl = target?.closest('button,[role="button"],[role="switch"],a')
    if (focusedControl && (e.code === "Space" || e.code === "Enter") && focusedControl.matches(":focus-visible")) return
    const el = video.current
    if (!el) return
    const seek = ["ArrowLeft", "ArrowRight", "KeyJ", "KeyL"].includes(e.code)
    const changeVolume = ["ArrowUp", "ArrowDown"].includes(e.code)
    const action = ["Space", "KeyK", "KeyN", "KeyC", "KeyM", "KeyF", "KeyP"].includes(e.code)
    if (!seek && !changeVolume && !action) return
    cancelSurfaceTap()
    e.preventDefault()
    e.stopPropagation()
    if (e.repeat && !seek && !changeVolume) return
    wakeControls()
    if (e.code === "Space" || e.code === "KeyK") togglePlay()
    else if (e.code === "ArrowLeft" || e.code === "KeyJ") seekRel(-10)
    else if (e.code === "ArrowRight" || e.code === "KeyL") seekRel(10)
    else if (changeVolume) {
      el.muted = false
      el.volume = Math.max(0, Math.min(1, el.volume + (e.code === "ArrowUp" ? 0.05 : -0.05)))
    }
    else if (e.code === "KeyN" && selected < total) openEpisode(selected + 1)
    else if (e.code === "KeyC") toggleSubtitles()
    else if (e.code === "KeyM") toggleMute()
    else if (e.code === "KeyF") toggleFullscreen()
    else if (e.code === "KeyP" && pipSupported) void togglePip()
  }
  React.useEffect(() => {
    if (!watchMode) return
    const handle = (e: KeyboardEvent) => shortcutHandler.current(e)
    window.addEventListener("keydown", handle, true)
    return () => window.removeEventListener("keydown", handle, true)
  }, [watchMode])

  const thumbnails = new Map<number, string>()
  for (const x of (m as any).streamingEpisodes || []) {
    const n = Number(String(x.title || "").match(/(?:episode|ep\.?)\s*(\d+)/i)?.[1])
    if (n && typeof x.thumbnail === "string" && /^https:\/\//.test(x.thumbnail) && !thumbnails.has(n)) {
      thumbnails.set(n, x.thumbnail)
    }
  }

  const selectedEpisodeRow = rows.find(e => e.episodeNumber === selected)
  const selectedEpisodeTitle = metadata[selected]?.title || selectedEpisodeRow?.episodeTitle || ""
  const currentEpThumb =
    metadata[selected]?.image ||
    selectedEpisodeRow?.episodeMetadata?.image ||
    thumbnails.get(selected) ||
    m.bannerImage ||
    m.coverImage?.large ||
    "/icons/icon-192.png"

  const currentArc = arcs.find(item => selected >= item.start && selected <= item.end)
  const animeTitle = m.title?.userPreferred || m.title?.english || m.title?.romaji || "Anime"
  React.useEffect(() => {
    let live = true
    setTitleLogo(null)
    const name = m.title?.english || m.title?.romaji || ""
    if (!name) return
    fetch("/api/justanime?action=logo&id=" + m.id + "&kind=" + (m.format === "MOVIE" ? "movie" : "tv") + "&title=" + encodeURIComponent(name), { signal: AbortSignal.timeout(8000) })
      .then(r => (r.ok ? (r.json() as Promise<{ logo?: string | null }>) : null))
      .then(d => { if (live && d?.logo) setTitleLogo(d.logo) })
      .catch(() => {})
    return () => { live = false }
  }, [m.id])
  const mediaDetails = m as any
  const synopsis = typeof mediaDetails.description === "string" ? mediaDetails.description.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").trim() : ""
  const episodeDateRaw = metadata[selected]?.aired
  const episodeDate = episodeDateRaw && Number.isFinite(Date.parse(episodeDateRaw)) ? new Date(episodeDateRaw).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : ""
  const episodeFacts = [
    ["Episode", String(selected) + (total > 0 ? " of " + total : "")],
    ...(currentArc ? [["Saga / arc", currentArc.title]] : []),
    ...(episodeDate ? [["Aired", episodeDate]] : []),
    ...(duration > 0 ? [["Runtime", formatSeconds(duration)]] : typeof mediaDetails.duration === "number" && mediaDetails.duration > 0 ? [["Typical runtime", mediaDetails.duration + " min"]] : []),
    ["Audio", audio === "dub" ? "English DUB" : "Japanese SUB"],
    ...(metadata[selected]?.filler === true ? [["Episode type", "Filler"]] : metadata[selected]?.recap === true ? [["Episode type", "Recap"]] : [])
  ]

  const nextAiring = m.nextAiringEpisode
  const hasNextAiring =
    nextAiring && nextAiring.episode && Number(nextAiring.timeUntilAiring || 0) > 0

  return (
    <section className="space-y-5" data-anidash-browser-episodes>
      <style>{`
        [data-anidash-watch-page] { display: grid; grid-template-columns: minmax(0,1fr); align-items: start; gap: 1.25rem; }
        [data-episode-navigator-scroll] { max-height: min(58dvh, 600px); min-height: 9rem; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-width: thin; scrollbar-color: #555 transparent; }
        @media (min-width: 1100px) {
          [data-anidash-watch-page] { grid-template-columns: minmax(0, 1fr) minmax(280px, 23%); gap: 1.25rem; }
          [data-episode-navigator-scroll] { max-height: min(72dvh, 880px); }
        }
        [data-anidash-watch-page][data-movie="true"] { grid-template-columns: minmax(0, 1fr); }
        [data-anidash-watch-page][data-movie="true"] aside { display: none; }
        @keyframes anidashLogoPulse { 0%,100% { opacity: .55; transform: scale(.97); filter: drop-shadow(0 0 0 rgba(255,255,255,0)); } 50% { opacity: 1; transform: scale(1); filter: drop-shadow(0 0 18px rgba(255,255,255,.45)); } }
        @keyframes anidashLogoBar { from { transform: translateX(-120%); } to { transform: translateX(320%); } }
        .anidash-logo-pulse { animation: anidashLogoPulse 2.2s ease-in-out infinite; }
        .anidash-logo-bar { animation: anidashLogoBar 1.4s ease-in-out infinite; }
        [data-player-wrapper][data-embed="true"] > *:not(iframe):not([data-embed-bar]) { display: none !important; }
        [data-player-wrapper][data-pseudo-fullscreen="true"] { position: fixed; inset: 0; margin: 0 !important; z-index: 2147483000; width: 100vw; height: 100dvh; max-width: none; max-height: none; aspect-ratio: auto; border: 0; border-radius: 0; }
        [data-player-wrapper]:fullscreen, [data-player-wrapper]:-webkit-full-screen { width: 100%; height: 100%; max-width: none; max-height: none; aspect-ratio: auto; border: 0; border-radius: 0; }
        video::cue {
          background-color: rgba(0, 0, 0, 0.8) !important;
          color: #ffffff !important;
          font-family: Inter, system-ui, -apple-system, sans-serif !important;
          font-size: 1.15rem !important;
          font-weight: 600 !important;
          line-height: 1.35 !important;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 4px rgba(0, 0, 0, 0.8) !important;
          border-radius: 4px !important;
        }
      `}</style>

      {/* Episode list view when not watching */}
      {!watchMode && m.format === "MOVIE" && total > 0 && (
        <div className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-[#0d0d0d]">
          {m.bannerImage && <img src={m.bannerImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0d0d0d] via-[#0d0d0d]/70 to-transparent" />
          <div className="relative flex flex-col sm:flex-row items-start sm:items-end gap-5 p-5 sm:p-7">
            <img src={m.coverImage?.large || m.coverImage?.medium || ""} alt="" className="w-28 sm:w-40 aspect-[2/3] shrink-0 rounded-xl object-cover shadow-xl" />
            <div className="min-w-0 flex-1 space-y-3">
              <span className="inline-block rounded-md bg-white/10 px-2 py-1 text-xs font-medium">Movie</span>
              <h2 className="text-xl sm:text-3xl font-bold leading-tight">{animeTitle}</h2>
              <p className="text-sm text-neutral-300">{[m.seasonYear, (m as any).duration ? (m as any).duration + " min" : null, m.status ? String(m.status).replace(/_/g, " ") : null].filter(Boolean).join(" · ")}</p>
              <Button intent="white" size="lg" onClick={() => openEpisode(1)}>
                <LuPlay /> Watch movie
              </Button>
            </div>
          </div>
        </div>
      )}

      {!watchMode && (m.format !== "MOVIE" || total === 0) && (
        <>
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <h2>
              Episodes <span className="text-[--muted] text-sm">({total})</span>
            </h2>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                intent={layout === "grid" ? "white" : "gray-outline"}
                onClick={() => {
                  setLayout("grid")
                  const s = getStore()
                  saveStore({ ...s, preferences: { ...s.preferences, episodeViewMode: "grid" } })
                }}
              >
                <LuLayoutGrid /> Grid
              </Button>
              <Button
                size="sm"
                intent={layout === "list" ? "white" : "gray-outline"}
                onClick={() => {
                  setLayout("list")
                  const s = getStore()
                  saveStore({ ...s, preferences: { ...s.preferences, episodeViewMode: "list" } })
                }}
              >
                <LuList /> List
              </Button>
            </div>
          </div>

          {total > 0 && (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-[--paper] p-4">
              <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
                <span className="text-xs text-[--muted]">Arc / episode group</span>
                <select
                  aria-label="Arc or episode group"
                  value={arc}
                  onChange={e => {
                    setArc(e.target.value)
                    setPage(1)
                  }}
                  className="rounded-lg border bg-[--background] px-3 py-2"
                >
                  <option value="all">All episodes · 1–{total}</option>
                  {arcs.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.title} · {a.start}–{a.end}
                    </option>
                  ))}
                </select>
              </label>
              <form
                className="flex gap-2 items-end"
                onSubmit={e => {
                  e.preventDefault()
                  const n = Number(jump)
                  if (!Number.isInteger(n) || n < 1 || n > total) return
                  const g = arcs.find(a => n >= a.start && n <= a.end)
                  setArc(g?.id || "all")
                  setPage(Math.floor((n - (g?.start || 1)) / PAGE_SIZE) + 1)
                }}
              >
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-[--muted]">Episode number</span>
                  <input
                    aria-label="Episode number"
                    type="number"
                    min={1}
                    max={total}
                    value={jump}
                    onChange={e => setJump(e.target.value)}
                    placeholder="e.g. 394"
                    className="w-28 rounded-lg border bg-[--background] px-3 py-2"
                  />
                </label>
                <Button
                  type="submit"
                  intent="gray-outline"
                  disabled={!jump || Number(jump) < 1 || Number(jump) > total}
                >
                  Go
                </Button>
              </form>
            </div>
          )}

          {group && (
            <p className="text-sm text-[--muted]">
              {group.title} · Episodes {group.start}–{group.end}
            </p>
          )}

          {metaError && (
            <p className="text-xs text-[--muted]">
              Some episode titles are temporarily unavailable.{" "}
              <button className="underline" onClick={() => setMetaRevision(v => v + 1)}>
                Retry metadata
              </button>
            </p>
          )}

          {visible.length ? (
            <div
              className={
                layout === "grid"
                  ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3"
                  : "flex flex-col gap-2"
              }
            >
              {visible.map(e => {
                const n = e.episodeNumber
                const md = metadata[n]
                const thumb =
                  md?.image ||
                  thumbnails.get(n) ||
                  e.episodeMetadata?.image ||
                  m.bannerImage ||
                  m.coverImage?.large
                return (
                  <button
                    type="button"
                    key={n}
                    aria-label={"Watch episode " + n}
                    onClick={() => openEpisode(n)}
                    className="group text-left flex items-center gap-3 p-3 rounded-xl border bg-[--paper] hover:bg-[--subtle] hover:border-[--brand] transition min-w-0"
                  >
                    <div className="relative shrink-0 w-28 sm:w-32 aspect-video rounded-lg overflow-hidden bg-[--subtle] flex items-center justify-center">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={"Episode " + n + " thumbnail"}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          onError={ev => {
                            const fallback = m.bannerImage || m.coverImage?.large
                            if (fallback && ev.currentTarget.src !== fallback) {
                              ev.currentTarget.src = fallback
                            }
                          }}
                        />
                      ) : (
                        <span className="font-semibold text-xl text-[--muted]">
                          {String(n).padStart(2, "0")}
                        </span>
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 grid place-items-center">
                        <LuPlay className="size-7 text-white" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-[--muted]">Episode {n}</p>
                      <p className="font-medium text-sm line-clamp-2">
                        {md?.title || e.episodeTitle || "Episode " + n}
                      </p>
                      {md?.filler && <span className="text-xs text-amber-400">Filler</span>}
                      {md?.recap && <span className="text-xs text-[--muted]">Recap</span>}
                    </div>
                    <LuPlay className="shrink-0 size-4 text-[--muted] group-hover:text-white" />
                  </button>
                )
              })}
            </div>
          ) : (
            <p>No released episodes are listed yet.</p>
          )}

          {pageCount > 1 && (
            <div className="flex justify-center items-center gap-3">
              <Button
                intent="gray-outline"
                disabled={currentPage <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <LuChevronLeft /> Previous
              </Button>
              <span className="text-sm text-[--muted]">
                {currentPage} / {pageCount}
              </span>
              <Button
                intent="gray-outline"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(p => p + 1)}
              >
                Next <LuChevronRight />
              </Button>
            </div>
          )}
        </>
      )}

      {/* Full Watch Player View */}
      {watchMode && (
        <div data-anidash-watch-page data-movie={m.format === "MOVIE" ? "true" : undefined} className="w-full max-w-[1920px] mx-auto p-2 sm:p-4 lg:p-6">
          <main className="min-w-0 space-y-4" onClick={returnPointerFocus}>
          <header>
             <h3 className="text-lg sm:text-2xl font-bold leading-tight">
               {m.format === "MOVIE" ? "Movie" : "Episode " + selected}
               {selectedEpisodeTitle && selectedEpisodeTitle !== "Episode " + selected ? " — " + selectedEpisodeTitle : ""}
             </h3>
           </header>

           {/* Video Player Wrapper */}
          <div
            data-player-wrapper
            data-pseudo-fullscreen={pseudoFullscreen ? "true" : "false"}
            data-embed={activeStream?.type === "embed" ? "true" : "false"}
            ref={playerWrapper}
            tabIndex={0}
            role="region"
            aria-label="AniDash video player"
            onPointerMove={onPlayerPointerMove}
            onPointerDown={wakeControls}
            onFocusCapture={wakeControls}
            className={`relative w-full aspect-video max-h-[78dvh] bg-black rounded-xl overflow-hidden border border-neutral-800 shadow-2xl flex flex-col justify-end group outline-none ${controlsVisible || playerMenu ? "" : "cursor-none"}`}
            style={{ isolation: "isolate", touchAction: "manipulation" }}
          >
            {/* Loading Indicator */}
            {isLoadingStream && (
              <div className="absolute inset-0 z-20 bg-black flex flex-col items-center justify-center gap-4 px-6 text-center text-white">
                {m.bannerImage && <img src={m.bannerImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20 blur-sm" />}
                <div className="relative anidash-logo-pulse max-w-[70%]">
                  {titleLogo
                    ? <img src={titleLogo} alt={animeTitle} className="max-h-24 sm:max-h-36 w-auto max-w-full object-contain" onError={() => setTitleLogo(null)} />
                    : <p className="text-2xl sm:text-5xl font-extrabold tracking-wide uppercase leading-tight drop-shadow-[0_2px_12px_rgba(255,255,255,0.35)]">{animeTitle}</p>}
                </div>
                <div className="relative h-1 w-40 overflow-hidden rounded-full bg-white/15"><div className="anidash-logo-bar h-full w-1/3 rounded-full bg-white" /></div>
                <p className="relative text-xs text-neutral-300">{m.format === "MOVIE" ? "Movie" : "Episode " + selected} · {selectedServer.toUpperCase()}</p>
              </div>
            )}

            {buffering && !isLoadingStream && !error && (
              <div className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center gap-3 bg-black/25 text-white" role="status">
                <div className="size-10 border-2 border-white/25 border-t-white rounded-full animate-spin" />
                <span className="text-xs font-medium">Buffering video…</span>
              </div>
            )}
            {/* Error Overlay */}
            {error && !isLoadingStream && (
              <div className="absolute inset-0 z-20 bg-black/85 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-red-400 max-w-md">{error}</p>
                {sourceReport && (
                  <div className="max-w-md space-y-2 text-left text-xs text-neutral-300" role="status">
                    <ul className="space-y-0.5">
                      {[...new Map(sourceReport.map(r => [r.name, r])).values()].map(r => (
                        <li key={r.name}><span className="font-semibold text-white">{r.name}</span> {r.reason}.</li>
                      ))}
                    </ul>
                    <p className="text-neutral-400">This is a problem with the video providers, not your device. You can keep watching on one of these servers instead (they open the provider's own player):</p>
                    <div className="flex flex-wrap gap-2">
                      {(externalGroups().find(g => g.key === "en-" + audio)?.items || []).map(item => (
                        <Button key={item.url} size="sm" intent="primary-outline" onClick={() => openExternal(item)}>{item.server}</Button>
                      ))}
                    </div>
                  </div>
                )}
                {accessDenied && <p className="text-xs text-neutral-400 max-w-md">This source refused the request. Other sources were tried automatically; you can pick another server or an embed player below.</p>}
                <div className="flex flex-wrap justify-center gap-2">
                  {activeStream?.url && <Button size="sm" intent="gray-outline" onClick={() => { failedStreams.current.clear(); mediaAccessDenied.current = false; setAccessDenied(false); setError(""); setPlaybackRevision(n => n + 1) }}>Retry playback</Button>}
                  <Button
                    size="sm"
                    intent="white"
                    onClick={() => {
                      const next =
                        JUSTANIME_SERVERS[(JUSTANIME_SERVERS.indexOf(selectedServer as any) + 1) % JUSTANIME_SERVERS.length]
                      pickServer(next, audio)
                    }}
                  >
                    Try next server
                  </Button>
                  <Button
                    size="sm"
                    intent="gray-outline"
                    onClick={() => changeAudio(audio === "dub" ? "sub" : "dub")}
                  >
                    Switch to {audio === "dub" ? "SUB" : "DUB"}
                  </Button>
                </div>
              </div>
            )}

            {toast && (
              <div data-embed-bar role="status" className="pointer-events-none absolute left-1/2 top-3 z-[50] max-w-[90%] -translate-x-1/2 rounded-full bg-black/85 px-4 py-2 text-center text-xs text-white shadow-lg">
                {toast}
              </div>
            )}
            {activeStream?.type === "embed" && (
              <button data-embed-bar type="button" className="absolute left-2 top-2 z-[45] rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white/90 hover:bg-black/80" onClick={() => { record(true); failedStreams.current.clear(); const native = streamsRef.current.find(x => x.type !== "embed"); if (native) setActiveStream(native); else setResolveNonce(n => n + 1) }}>
                ← AniDash player
              </button>
            )}

            {/* Embedded partner player (MegaPlay, Megavid, AniXo). Covers the custom controls, which only drive the native video element. */}
            {activeStream?.type === "embed" && !isLoadingStream && (
              <iframe
                key={activeStream.url}
                ref={embeddedFrame}
                src={activeStream.url}
                title={"AniDash " + (activeStream.server || "embed") + " player"}
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                allowFullScreen
                className="absolute inset-0 z-[25] h-full w-full border-0 bg-black"
              />
            )}

            {/* Video Element */}
            <video
              ref={video}
              playsInline
              webkit-playsinline=""
              x-webkit-airplay="allow"
              preload="auto"
              className="absolute inset-0 w-full h-full object-contain bg-black"
              onClick={clickVideoSurface}
              onDoubleClick={e => e.preventDefault()}
              onLoadedMetadata={e => { setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0); updateBuffered(e.currentTarget) }}
              onProgress={e => updateBuffered(e.currentTarget)}
              onLoadedData={e => { updateBuffered(e.currentTarget); rememberDecodedFrame(e.currentTarget) }}
              onDurationChange={e => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
              onPlay={e => { if (!mediaAccessDenied.current) { setIsPlaying(true); setBuffering(e.currentTarget.readyState < 3) } }}
              onPlaying={() => {
                if (mediaAccessDenied.current) return
                playbackStarted.current = true
                notePlaying(activeStream)
                if (hlsInstance.current) {
                  hlsInstance.current.config.maxMaxBufferLength = PLAYER_BUFFER_TARGET
                  hlsInstance.current.config.maxBufferLength = PLAYER_BUFFER_TARGET
                }
                setIsPlaying(true)
                setBuffering(false)
                setError("")
                setPlayerNotice("")
              }}
              onCanPlay={() => setBuffering(false)}
              onWaiting={e => { if (!mediaAccessDenied.current && !e.currentTarget.paused && e.currentTarget.readyState < 3) { setBuffering(true); if (playbackStarted.current && activeStream?.provider) Engine.recordStall(activeStream.provider) } }}
              onStalled={e => { if (!mediaAccessDenied.current && !e.currentTarget.paused && e.currentTarget.readyState < 3) setBuffering(true) }}
              onVolumeChange={e => { setVolume(e.currentTarget.volume); setIsMuted(e.currentTarget.muted) }}
              onRateChange={e => setPlaybackRate(e.currentTarget.playbackRate)}
              onPause={() => {
                setIsPlaying(false)
                setBuffering(false)
                record(true)
              }}
              onTimeUpdate={() => {
                const el = video.current
                if (el) {
                  setCurrentTime(el.currentTime)
                  if (!mediaAccessDenied.current && !el.paused && !el.seeking && el.readyState >= 3) setBuffering(false)
                  updateBuffered(el)
                  rememberDecodedFrame(el)
                  if (autoSkip && playbackStarted.current && el.currentTime > 0 && el.readyState >= 2 && !el.paused && !el.seeking && !isLoadingStream) {
                    const segment = availableSegments.find(item =>
                      el.currentTime >= item.start && el.currentTime < item.end && !skippedSegments.current.has(item.kind))
                    if (segment) skipSegment(segment)
                  }
                  record()
                }
              }}
              onSeeked={e => { updateBuffered(e.currentTarget); rememberDecodedFrame(e.currentTarget); record(true) }}
              onEnded={() => {
                if (mountedMediaEpisode.current !== selected) return
                setIsPlaying(false)
                record(true, true)
                if (autoNext && selected < total) openEpisode(selected + 1, true)
              }}
              onError={() => {
                if (mountedMediaEpisode.current !== selected || mediaAccessDenied.current) return
                setBuffering(false)
                setIsPlaying(false)
                const code = video.current?.error?.code
                const message = code === 2 ? "The media download failed."
                  : code === 3 ? "The browser could not decode the media."
                  : code === 4 ? "The media format is not supported by this browser."
                  : "The browser could not play this media."
                setError(message + " Retry playback.")
              }}
            >
              {[...captionFiles, ...(uploadedCaption ? [uploadedCaption] : [])].map(t => (
                <track key={t.id + t.url} id={t.id} kind="subtitles" src={t.url} srcLang={t.language} label={t.label}
                  onLoad={() => setCaptionRevision(n => n + 1)}
                  onError={() => setCaptionMessage("A subtitle track could not be read by the browser.")} />
              ))}
            </video>
            {(controlsVisible || playerMenu) && (
              <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 bg-gradient-to-b from-black/85 to-transparent px-3 pb-10 pt-3 sm:px-6 sm:pt-5 pointer-events-none">
                <div className="min-w-0 text-white drop-shadow-md">
                  <div className="truncate text-[9px] sm:text-[11px] font-bold tracking-[0.18em] uppercase text-white/70">{m.title?.userPreferred || m.title?.english || m.title?.romaji}</div>
                  <div className="truncate text-xs sm:text-lg font-semibold">{m.format === "MOVIE" ? "Movie" : "Episode " + selected}{selectedEpisodeTitle ? " · " + selectedEpisodeTitle : ""}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-white drop-shadow-md" data-player-watermark>
                  <img src="/anidash-watermark.png" alt="" className="h-4 w-7 sm:h-6 sm:w-10 object-contain" />
                  <span className="text-[10px] sm:text-sm font-extrabold tracking-tight">AniDash</span>
                </div>
              </div>
            )}
            {captionText && subtitlesEnabled && !pipActive && (
              <div aria-live="off" className={`absolute inset-x-3 z-20 pointer-events-none text-center flex justify-center transition-all ${controlsVisible || playerMenu ? "bottom-24 sm:bottom-28" : "bottom-6 sm:bottom-10"}`}>
                <span className="max-w-[90%] whitespace-pre-line rounded px-2 py-1 font-semibold leading-snug text-white" style={{ fontSize: `clamp(${12 * captionSize}px, ${2.4 * captionSize}vw, ${27 * captionSize}px)`, background: captionBackground ? "rgba(0,0,0,.75)" : "transparent", textShadow: "0 1px 3px #000, 0 0 2px #000" }}>{captionText}</span>
              </div>
            )}
            {controlsVisible && !buffering && !isLoadingStream && !error && activeStream?.url && (
              <div className="absolute inset-0 z-10 pointer-events-none grid place-items-center">
                <div className="flex items-center gap-6 sm:gap-12 pointer-events-auto text-white drop-shadow-lg">
                  <button type="button" title="Back 10 seconds" aria-label="Back 10 seconds" onClick={() => seekRel(-10)} className="relative grid size-9 sm:size-14 place-items-center rounded-full hover:bg-black/30 transition">
                    <LuRotateCcw className="size-7 sm:size-10" /><span className="absolute text-[9px] sm:text-xs font-bold">10</span>
                  </button>
                  <button type="button" data-player-surface-action aria-label={isPlaying ? "Pause video" : "Play video"} onClick={e => { if (e.detail === 0) { cancelSurfaceTap(); togglePlay() } else clickVideoSurface(e) }} onDoubleClick={e => e.preventDefault()} className="grid size-14 sm:size-20 place-items-center rounded-full hover:bg-black/25 transition">
                    {isPlaying ? <LuPause className="size-10 sm:size-14 fill-current" /> : <LuPlay className="size-10 sm:size-14 fill-current" />}
                  </button>
                  <button type="button" title="Forward 10 seconds" aria-label="Forward 10 seconds" onClick={() => seekRel(10)} className="relative grid size-9 sm:size-14 place-items-center rounded-full hover:bg-black/30 transition">
                    <LuRotateCw className="size-7 sm:size-10" /><span className="absolute text-[9px] sm:text-xs font-bold">10</span>
                  </button>
                </div>
              </div>
            )}

            {controlsVisible && currentSegment && !error && !isLoadingStream && !buffering && (
              <button type="button" onClick={() => skipSegment(currentSegment)}
                className="absolute right-4 bottom-24 sm:bottom-20 z-30 rounded-lg border border-white/40 bg-black/85 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-white hover:text-black transition">
                Skip {currentSegment.kind === "intro" ? "Intro" : "Outro"} <LuChevronRight className="inline size-4" />
              </button>
            )}
            {playerMenu && (
              <div role="dialog" aria-label={playerMenu === "appearance" ? "Subtitle appearance" : playerMenu} className="absolute right-3 sm:right-5 bottom-[76px] sm:bottom-[90px] z-40 w-[min(19rem,calc(100%-1.5rem))] max-h-[calc(100%-84px)] sm:max-h-[calc(100%-100px)] overflow-y-auto rounded-2xl border border-white/15 bg-[#13171e]/95 backdrop-blur-xl shadow-2xl text-white">
                <div className="sticky top-0 flex items-center gap-2 border-b border-white/10 bg-[#171c23] px-4 py-3 text-sm font-semibold">
                  {playerMenu === "quality" || playerMenu === "speed" || playerMenu === "appearance" ? <button type="button" className="grid size-6 place-items-center" aria-label="Back" onClick={() => setPlayerMenu(playerMenu === "appearance" ? "subtitles" : "settings")}><LuChevronLeft /></button> : playerMenu === "settings" ? <LuSettings /> : <LuCaptions />}
                  {({ settings: "Settings", quality: "Quality", speed: "Speed", subtitles: "Subtitles", appearance: "Appearance" })[playerMenu]}
                  <button type="button" aria-label="Close menu" className="ml-auto text-white/60 text-lg leading-none" onClick={() => setPlayerMenu(null)}>×</button>
                </div>
                <div className="p-2 space-y-1">
                  {playerMenu === "settings" && <>
                    <button type="button" className={menuRowClass} onClick={() => setPlayerMenu("quality")}><span>Quality</span><span className="flex items-center gap-2 text-xs text-white/65">{hlsLevels.length ? (qualityLevel === -1 ? "Auto" : hlsLevels.find(l => l.index === qualityLevel)?.label) : activeStream?.quality || "Source"}<LuChevronRight /></span></button>
                    <button type="button" className={menuRowClass} onClick={() => setPlayerMenu("speed")}><span>Speed</span><span className="flex items-center gap-2 text-xs text-white/65">{playbackRate === 1 ? "Normal" : playbackRate + "×"}<LuChevronRight /></span></button>
                    <button type="button" className={menuRowClass} onClick={() => { setPlayerMenu(null); closePlayer() }}><span>Anime details</span><LuChevronRight /></button>
                  </>}
                  {playerMenu === "quality" && <>
                    {hlsLevels.length > 0 ? [{ index: -1, label: "Auto" }, ...hlsLevels].map(level => <button key={level.index} type="button" className={menuRowClass} onClick={() => { chooseQuality(level.index); setPlayerMenu("settings") }}><span>{level.label}</span><span>{qualityLevel === level.index ? "✓" : ""}</span></button>) : streams.length > 1 ? streams.map((stream, index) => <button key={index} type="button" className={menuRowClass} onClick={() => { record(true); setActiveStream(stream); setPlayerMenu("settings") }}><span>{stream.quality || "Stream " + (index + 1)}</span><span>{activeStream?.url === stream.url ? "✓" : ""}</span></button>) : <p className="p-3 text-xs text-white/60">Only the current media quality is available.</p>}
                  </>}
                  {playerMenu === "speed" && [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <button key={rate} type="button" className={menuRowClass} onClick={() => { if (video.current) video.current.playbackRate = rate; setPlayerMenu("settings") }}><span>{rate === 1 ? "Normal" : rate + "×"}</span><span>{playbackRate === rate ? "✓" : ""}</span></button>)}
                  {playerMenu === "subtitles" && <>
                    <button type="button" className={menuRowClass + (!subtitlesEnabled ? " bg-white/15" : "")} onClick={() => updateCaptionEnabled(false)}><span>Off</span><span>{!subtitlesEnabled ? "✓" : ""}</span></button>
                    <button type="button" className={menuRowClass + (subtitlesEnabled && captionChoice === "auto" ? " bg-white/15" : "")} onClick={() => { setCaptionChoice("auto"); updateCaptionEnabled(true) }}><span>Auto (English preferred)</span><span>{subtitlesEnabled && captionChoice === "auto" ? "✓" : ""}</span></button>
                    {(["en", "other"] as const).map(group => {
                      const options = captionOptions.filter(option => group === "en" ? option.language === "en" : option.language !== "en")
                      if (!options.length) return null
                      return <React.Fragment key={group}>
                        <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">{group === "en" ? "English subtitles" : "Other subtitle tracks"}</p>
                        {options.map(option => <button key={option.id} type="button" className={menuRowClass + (subtitlesEnabled && selectedCaptionIndex === option.index ? " bg-white/15" : "")} onClick={() => { setCaptionChoice(option.id); updateCaptionEnabled(true) }}><span className="truncate">{option.label}</span><span>{subtitlesEnabled && selectedCaptionIndex === option.index ? "✓" : ""}</span></button>)}
                      </React.Fragment>
                    })}
                    {captionLoading && <p role="status" className="px-3 py-1 text-xs text-white/55">Loading available subtitle tracks…</p>}
                    {!captionLoading && !captionOptions.some(option => option.language === "en") && <p className="px-3 py-1 text-xs text-white/55">No English subtitle tracks are available for this media.</p>}
                    {captionMessage && <p role="status" className="px-3 py-1 text-xs text-white/60">{captionMessage}</p>}
                    <div className="border-t border-white/10 mt-2 pt-2 flex items-center justify-between px-3 py-2 text-sm"><span>Delay</span><div className="flex items-center gap-2"><button aria-label="Decrease subtitle delay" type="button" className="grid size-8 place-items-center rounded-lg bg-white/10" onClick={() => setCaptionDelay(v => Math.max(-10, Math.round((v - 0.25) * 100) / 100))}>−</button><button title="Reset delay" type="button" className="min-w-12 text-center text-xs tabular-nums" onClick={() => setCaptionDelay(0)}>{captionDelay.toFixed(2)}s</button><button aria-label="Increase subtitle delay" type="button" className="grid size-8 place-items-center rounded-lg bg-white/10" onClick={() => setCaptionDelay(v => Math.min(10, Math.round((v + 0.25) * 100) / 100))}>+</button></div></div>
                    <button type="button" className={menuRowClass} onClick={() => subtitleInput.current?.click()}><span className="flex items-center gap-2"><LuUpload />Upload Subtitle</span><LuChevronRight /></button>
                    <button type="button" className={menuRowClass} onClick={() => setPlayerMenu("appearance")}><span>Appearance</span><LuChevronRight /></button>
                  </>}
                  {playerMenu === "appearance" && <>
                    <p className="px-3 pt-2 text-xs text-white/55">Text size</p>
                    {[0.8, 1, 1.25, 1.5].map((size, i) => <button key={size} type="button" className={menuRowClass} onClick={() => updateCaptionAppearance(size, captionBackground)}><span>{["Small", "Normal", "Large", "Extra large"][i]}</span><span>{captionSize === size ? "✓" : ""}</span></button>)}
                    <button type="button" className={menuRowClass} role="switch" aria-checked={captionBackground} onClick={() => updateCaptionAppearance(captionSize, !captionBackground)}><span>Text background</span><span>{captionBackground ? "On" : "Off"}</span></button>
                  </>}
                </div>
              </div>
            )}
          {/* AniDash custom player controls */}
          <div className={`absolute inset-x-0 bottom-0 z-30 flex flex-col gap-1 bg-gradient-to-t from-black via-black/80 to-transparent px-3 sm:px-6 pt-10 pb-2 sm:pb-4 text-white text-sm transition-opacity duration-200 ${controlsVisible || playerMenu ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            <input ref={subtitleInput} type="file" accept=".vtt,.srt,text/vtt" className="hidden" onChange={e => { void uploadCaption(e.currentTarget.files?.[0]); e.currentTarget.value = "" }} />
            {playerNotice && <button type="button" onClick={() => setPlayerNotice("")} className="self-end text-xs rounded-lg bg-black/85 px-3 py-2">{playerNotice} · Dismiss</button>}
            <div className="relative mx-1 h-5 flex items-center focus-within:ring-2 focus-within:ring-white/80 rounded" onPointerMove={hoverTimeline} onPointerLeave={() => { if (!seekDragging.current) setSeekHover(null) }}>
              {(controlsVisible || playerMenu) && seekHover && duration > 0 && (
                <div className="absolute bottom-7 z-50 flex flex-col items-center overflow-hidden rounded-lg border border-white/20 bg-black/90 shadow-xl pointer-events-none" style={{ left: `clamp(84px, ${seekHover.fraction * 100}%, calc(100% - 84px))`, transform: "translateX(-50%)" }}>
                  {currentHoverImage && <SeekThumbnail image={currentHoverImage} />}
                  <span className="px-3 py-1.5 text-xs font-semibold tabular-nums">{formatSeconds(seekHover.time)}</span>
                </div>
              )}
              <div className="absolute inset-x-0 h-1 rounded-full bg-white/25 overflow-hidden pointer-events-none">
                {bufferedRanges.map((range, index) => duration > 0 && <span key={index} className="absolute inset-y-0 bg-white/45" style={{ left: (range.start / duration * 100) + "%", width: ((range.end - range.start) / duration * 100) + "%" }} />)}
                <div className="absolute inset-y-0 left-0 bg-[var(--brand)]" style={{ width: progressPercent + "%", backgroundColor: "var(--brand, #ffffff)" }} />
                {availableSegments.map(segment => (
                  <span key={segment.kind} className="absolute inset-y-0 bg-amber-300/85"
                    style={{ left: (segment.start / duration * 100) + "%", width: ((segment.end - segment.start) / duration * 100) + "%" }} />
                ))}
              </div>
              <span aria-hidden="true" className="absolute size-3 rounded-full bg-white shadow pointer-events-none -translate-x-1/2" style={{ left: progressPercent + "%" }} />
              <input
                type="range" aria-label="Playback position" min={0} max={duration > 0 ? duration : 1} step={0.1}
                disabled={!duration} value={Math.min(displayedTime, duration || 1)}
                onPointerDown={() => { seekDragging.current = true; seekDraftRef.current = currentTime; startSliderDrag() }}
                onChange={e => changeSeek(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <div className="flex items-center justify-between gap-1 px-0.5 sm:px-2">
              <div className="flex items-center gap-0.5 sm:gap-2 min-w-0">
                <button type="button" className={controlClass} onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <LuPause className="size-5" /> : <LuPlay className="size-5 fill-current" />}</button>
                <button type="button" className={controlClass} onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"}>{isMuted ? <LuVolumeX className="size-5" /> : <LuVolume2 className="size-5" />}</button>
                <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={isMuted ? 0 : volume} onPointerDown={startSliderDrag} onChange={e => { const el = video.current; if (el) { el.muted = false; el.volume = Number(e.target.value) } }} className="hidden lg:block w-16 accent-white" />
                <span className="whitespace-nowrap text-[10px] sm:text-xs tabular-nums px-0.5 sm:px-2">{formatSeconds(displayedTime)} <span className="text-white/50">/ {formatSeconds(duration)}</span></span>
                {duration > 0 && <span title="Actual playable media buffered ahead of the current position" className="hidden md:inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[10px] font-medium tabular-nums text-white/70"><span className={`size-1.5 rounded-full ${aheadSeconds >= 10 ? "bg-emerald-400" : "bg-amber-300"}`} />{Math.floor(aheadSeconds)}s buffered</span>}
              </div>
              <div className="flex items-center gap-0 sm:gap-1">
                <button type="button" className={controlClass + " hidden sm:grid"} aria-label="Previous episode" disabled={selected <= 1} onClick={() => openEpisode(selected - 1)}><span className="rotate-180"><NextIcon /></span></button>
                <button type="button" className={controlClass + (playerMenu === "subtitles" || playerMenu === "appearance" ? " bg-white/20" : "")} aria-label={"Subtitles: " + (subtitlesEnabled ? captionLabel : "Off")} aria-expanded={playerMenu === "subtitles" || playerMenu === "appearance"} onClick={() => setPlayerMenu(playerMenu === "subtitles" || playerMenu === "appearance" ? null : "subtitles")}><LuCaptions className="size-5" /></button>
                <button type="button" className={controlClass + (pipActive ? " bg-white/20" : "")} title={pipSupported ? "Picture-in-Picture" : "Picture-in-Picture unavailable"} aria-label="Picture-in-Picture" aria-pressed={pipActive} disabled={!pipSupported || !duration} onClick={() => void togglePip()}><PipIcon /></button>
                <button type="button" className={controlClass + (playerMenu === "settings" || playerMenu === "quality" || playerMenu === "speed" ? " bg-white/20" : "")} aria-label="Player settings" aria-expanded={playerMenu === "settings" || playerMenu === "quality" || playerMenu === "speed"} onClick={() => setPlayerMenu(playerMenu === "settings" || playerMenu === "quality" || playerMenu === "speed" ? null : "settings")}><LuSettings className="size-5" /></button>
                <button type="button" className={controlClass + " hidden sm:grid"} aria-label="Next episode" disabled={selected >= total} onClick={() => openEpisode(selected + 1)}><NextIcon /></button>

                <button type="button" className={controlClass} aria-label="Fullscreen" onClick={toggleFullscreen}><LuMaximize className="size-5" /></button>
              </div>
            </div>
          </div>
          </div>

          {syncState && (
            <p className="text-xs text-[--muted]" role="status">
              {syncState}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-[#0d0d0d] px-4 py-3">
            <div className="flex flex-wrap items-center gap-4">
              {([
                ["Autoplay", autoplay, "playerAutoplay"],
                ["Auto Skip", autoSkip, "playerAutoSkip"],
                ["Auto Next", autoNext, "playerAutoNext"]
              ] as const).map(([label, enabled, key]) => (
                <button key={key} type="button" role="switch" aria-checked={enabled} onClick={() => setPlaybackPreference(key, !enabled)}
                  className="inline-flex items-center gap-2 text-xs font-medium text-neutral-200 hover:text-white">
                  <span aria-hidden="true" className={`grid size-4 place-items-center rounded-full border text-[10px] font-bold ${enabled ? "bg-white border-white text-black" : "border-neutral-500 text-transparent"}`}>✓</span>{label}
                </button>
              ))}
            </div>
            {availableSegments.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                {availableSegments.map(segment => <span key={segment.kind} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-amber-400" />{segment.kind === "intro" ? "Intro" : "Outro"} {formatSeconds(segment.start)}–{formatSeconds(segment.end)}</span>)}
              </div>
            )}
          </div>
          {/* Audio and source controls only; episode artwork belongs to the details section. */}
          <section aria-label="Audio and servers" className="rounded-xl border border-neutral-800 bg-[#0d0d0d] overflow-hidden">
            <div className="p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Audio &amp; servers</h2>
                <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] text-neutral-300">{audio === "dub" ? "English DUB" : "Japanese SUB"}</span>
              </div>

              {/* SUB Channel Row */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-300 w-14 shrink-0">
                  <svg
                    className="size-4 shrink-0 text-neutral-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <line x1="7" y1="15" x2="11" y2="15" />
                    <line x1="13" y1="15" x2="17" y2="15" />
                  </svg>
                  <span>SUB</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {JUSTANIME_SERVERS.filter(k => k === "momo" || !deadServers.includes(k)).map(key => {
                    const isSelected = audio === "sub" && selectedServer === key
                    const isHsub = key === "onyx"
                    const isDisabled = serverMap[key] && serverMap[key].sub === false
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => pickServer(key, "sub")}
                        className={`relative rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                          isSelected
                            ? "bg-white text-black font-semibold shadow-md"
                            : isDisabled
                            ? "opacity-40 cursor-not-allowed border border-dashed border-neutral-700 text-neutral-500 line-through"
                            : "bg-[#1e1e1e] text-neutral-300 hover:bg-[#2a2a2a] hover:text-white"
                        }`}
                      >
                        {isHsub && (
                          <span className="absolute -top-2.5 right-1 text-[9px] font-bold bg-neutral-700 text-neutral-200 px-1 py-0.2 rounded border border-neutral-600 shadow-sm leading-tight">
                            HSUB
                          </span>
                        )}
                        {key}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* DUB Channel Row */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-300 w-14 shrink-0">
                  <svg
                    className="size-4 shrink-0 text-neutral-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M12 3v18M8 8v8M4 11v2M16 6v12M20 9v6" />
                  </svg>
                  <span>DUB</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {JUSTANIME_SERVERS.filter(k => k === "momo" || !deadServers.includes(k)).map(key => {
                    const isSelected = audio === "dub" && selectedServer === key
                    const isCalmDubDisabled = key === "calm"
                    const isExplicitlyDisabled = serverMap[key] && serverMap[key].dub === false
                    const isDisabled = isCalmDubDisabled || isExplicitlyDisabled
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => !isDisabled && pickServer(key, "dub")}
                        className={`relative rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                          isSelected
                            ? "bg-white text-black font-semibold shadow-md"
                            : isDisabled
                            ? "opacity-40 cursor-not-allowed border border-dashed border-neutral-700 text-neutral-500 line-through"
                            : "bg-[#1e1e1e] text-neutral-300 hover:bg-[#2a2a2a] hover:text-white"
                        }`}
                      >
                        {key}
                      </button>
                    )
                  })}
                  {deadServers.length > 0 && (
                    <button type="button" className="text-[11px] text-neutral-500 underline" onClick={() => { try { localStorage.removeItem("anidash:deadServers") } catch {} setDeadServers([]) }}>
                      Show hidden servers
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {(["sub","dub"] as const).some(channel=>episodeSources(installedBrowserSources,entry.mediaId,selected,channel).length>0) && <section aria-label="Installed browser sources" className="rounded-xl border border-neutral-800 bg-[#0d0d0d] p-4 space-y-3">
            <h2 className="text-sm font-semibold">Installed browser sources</h2>
            <p className="text-xs text-neutral-400">Selecting a source connects directly to its media host. Use only media you are authorized to access.</p>
            {(["sub","dub"] as const).map(channel=>{const options=[...new Map(episodeSources(installedBrowserSources,entry.mediaId,selected,channel).map(e=>[e.sourceId,e])).values()];return options.length>0&&<div key={channel} className="flex flex-wrap items-center gap-2"><span className="text-xs text-neutral-300 w-14">{channel.toUpperCase()}</span>{options.map(e=><button key={e.sourceId} type="button" aria-pressed={selectedServer===customSourcePrefix+e.sourceId&&audio===channel} className={`rounded-lg px-3.5 py-1.5 text-xs font-medium ${selectedServer===customSourcePrefix+e.sourceId&&audio===channel?"bg-white text-black":"bg-[#1e1e1e] text-neutral-300 hover:bg-[#2a2a2a]"}`} onClick={()=>pickServer(customSourcePrefix+e.sourceId,channel)}>{e.sourceName}</button>)}</div>})}
          </section>}
          {activeStream?.type==="embed"&&<section aria-label="Embedded player progress" className="rounded-xl border border-neutral-800 bg-[#0d0d0d] p-4 space-y-3">
            <h2 className="text-sm font-semibold">Playback checkpoint</h2>
            {embedResumePending&&<div className="flex flex-wrap items-center gap-2 text-xs text-neutral-300"><span>Resume at <strong>{formatPosition(embedResumeTarget)}</strong> in the embedded player. Progress before that time will not overwrite your saved checkpoint.</span><button className="rounded border border-neutral-600 px-2 py-1" onClick={()=>{embedResumeGate.current.accepted=true;setEmbedResumePending(false)}}>Start over instead</button></div>}
            <p className="text-xs text-neutral-400">{embedTracking?"Actual playback timestamps are being received. AniDash saves them to your account; automatic seeking on this embedded player is not verified.":"Waiting for supported playback events. If none arrive, enter the actual position shown by the player. Automatic seeking is not verified."}</p>
            <div className="flex flex-wrap gap-3 items-end"><label className="text-xs">Current position<input aria-label="Current position" className="block rounded-lg border border-neutral-700 bg-black p-2 mt-1 w-32" placeholder="14:37" value={manualPosition} onChange={e=>setManualPosition(e.target.value)}/></label><label className="text-xs">Total duration<input aria-label="Total duration" className="block rounded-lg border border-neutral-700 bg-black p-2 mt-1 w-32" placeholder="23:40" value={manualDuration} onChange={e=>setManualDuration(e.target.value)}/></label><button className="rounded-lg px-3 py-2 bg-white text-black text-xs font-semibold" onClick={()=>void saveManualCheckpoint()}>Save checkpoint</button></div>
            {manualMessage&&<p role="status" className="text-xs text-neutral-300">{manualMessage}</p>}
          </section>}
          {/* External and language players: separate from the built-in AniDash servers. */}
          <section aria-label="Languages and external players" className="rounded-xl border border-neutral-800 bg-[#0d0d0d] p-4 sm:p-5 space-y-3">
            <div>
              <h2 className="text-base font-bold">Languages &amp; external players</h2>
              <p className="text-xs text-neutral-400 mt-1">These open the provider's own player, not the AniDash player.</p>
            </div>
            {externalGroups().map(g => (
              <div key={g.key} className="flex items-start gap-3">
                <span className={`mt-1 w-24 shrink-0 rounded-md px-2 py-1 text-center text-[11px] font-bold ${g.tone === "amber" ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300"}`}>{g.label}{g.note && <span className="block text-[9px] font-medium opacity-70">{g.note}</span>}</span>
                <div className="flex flex-wrap gap-2">
                  {g.items.map(e => (
                    <button
                      key={e.serverId || e.url}
                      type="button"
                      onClick={() => openExternal(e)}
                      className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${activeStream?.url === e.url ? "bg-white text-black font-semibold shadow-md" : g.tone === "amber" ? "bg-amber-500/10 text-amber-200 hover:bg-amber-500/20" : "bg-sky-500/10 text-sky-200 hover:bg-sky-500/20"}`}
                    >
                      {e.server}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {/* Estimated Next Episode Airing Banner */}
          {hasNextAiring && (
            <div className="rounded-xl border border-neutral-800 bg-[#0d0d0d] px-4 py-3 flex items-center gap-2.5 text-xs sm:text-sm text-neutral-300">
              <svg
                className="size-4 text-neutral-400 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>
                Estimated next episode will come at{" "}
                <strong className="text-white font-semibold">EP {nextAiring.episode}</strong> IN{" "}
                <strong className="text-white font-semibold">
                  {formatAiringCountdown(nextAiring.timeUntilAiring)}
                </strong>
              </span>
            </div>
          )}

          {/* Single episode and series information section. */}
          <section aria-label="Episode details" className="rounded-xl border border-neutral-800 bg-[#0d0d0d] overflow-hidden">
            <div className="p-4 sm:p-5">
              <div className="flex items-start gap-4">
                <div className="relative w-28 sm:w-40 aspect-video shrink-0 overflow-hidden rounded-lg bg-neutral-900">
                  <img src={currentEpThumb} alt="" className="h-full w-full object-cover" loading="lazy" onError={e => {
                    const fallback = m.bannerImage || m.coverImage?.large || "/icons/icon-192.png"
                    if (e.currentTarget.getAttribute("src") !== fallback) e.currentTarget.src = fallback
                  }} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold">{m.format === "MOVIE" ? "Movie details" : "Episode details"}</h2>
                  <p className="text-sm text-neutral-400 mt-1">{animeTitle}</p>
                  {selectedEpisodeTitle && <p className="text-sm text-neutral-300 mt-1 leading-snug">{selectedEpisodeTitle}</p>}
                </div>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4 mt-4 pt-4 border-t border-neutral-800">
                {episodeFacts.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-neutral-500">{label}</dt><dd className="text-sm font-medium mt-1 break-words">{value}</dd></div>)}
              </dl>
            </div>
            <div className="border-t border-neutral-800 p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{m.format === "MOVIE" ? "About the movie" : "About the series"}</h3>
                <button type="button" onClick={closePlayer} className="text-xs font-medium text-neutral-300 hover:text-white underline underline-offset-4">View anime details</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {typeof mediaDetails.averageScore === "number" && mediaDetails.averageScore > 0 && <span className="rounded-md bg-white/10 px-2 py-1 text-xs">★ {(mediaDetails.averageScore / 10).toFixed(1)}</span>}
                {m.format && <span className="rounded-md bg-white/10 px-2 py-1 text-xs">{m.format.replace(/_/g, " ")}</span>}
                {Array.isArray(mediaDetails.genres) && mediaDetails.genres.slice(0, 6).map((genre: string) => <span key={genre} className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-300">{genre}</span>)}
              </div>
              {synopsis && <details className="text-sm leading-relaxed text-neutral-300"><summary className="cursor-pointer text-white text-sm font-medium">{m.format === "MOVIE" ? "Synopsis" : "Series synopsis"}</summary><p className="mt-2">{synopsis}</p></details>}
            </div>
          </section>
          </main>

          <aside aria-label="Episode navigator" className="min-w-0 space-y-4">
            {m.format !== "MOVIE" && (
              <section className="rounded-xl border border-neutral-800 bg-[#0d0d0d] overflow-hidden">
                <div className="p-4 space-y-3 border-b border-neutral-800">
                  <div className="flex items-center justify-between gap-2">
                    <div><h2 className="text-base font-bold">Episodes</h2><p className="text-xs text-neutral-400 mt-1">{total} released · Episode {selected} selected</p></div>
                    <div className="flex rounded-lg border border-neutral-700 p-0.5">
                      <button type="button" title="Episode numbers" aria-label="Episode numbers" aria-pressed={navigatorMode === "numbers"} onClick={() => setNavigatorMode("numbers")} className={`grid size-8 place-items-center rounded-md ${navigatorMode === "numbers" ? "bg-white text-black" : "text-neutral-400 hover:text-white"}`}><LuLayoutGrid className="size-4" /></button>
                      <button type="button" title="Episode details" aria-label="Episode details" aria-pressed={navigatorMode === "details"} onClick={() => setNavigatorMode("details")} className={`grid size-8 place-items-center rounded-md ${navigatorMode === "details" ? "bg-white text-black" : "text-neutral-400 hover:text-white"}`}><LuList className="size-4" /></button>
                    </div>
                  </div>
                  <form onSubmit={submitNavigatorJump} className="flex gap-2">
                    <input aria-label="Jump to episode number" inputMode="numeric" pattern="[0-9]*" placeholder="Episode number" value={navigatorJump} onChange={e => { setNavigatorJump(e.target.value); setNavigatorError("") }} className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-black/35 px-3 py-2 text-sm outline-none focus:border-white/60" />
                    <button type="submit" className="rounded-lg bg-white text-black px-3 text-xs font-semibold">Go</button>
                  </form>
                  {navigatorError && <p role="alert" className="text-xs text-red-400">{navigatorError}</p>}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-neutral-400 shrink-0" htmlFor="watch-episode-range">Range</label>
                    <select id="watch-episode-range" value={activeNavigatorPage} onChange={e => setNavigatorPage(Number(e.target.value))} className="min-w-0 flex-1 rounded-lg bg-neutral-900 border border-neutral-700 px-2 py-2 text-xs">
                      {Array.from({ length: navigatorPageCount }, (_, i) => <option key={i+1} value={i+1}>{i*100+1}–{Math.min((i+1)*100,total)}</option>)}
                    </select>
                    {activeNavigatorPage !== Math.ceil(selected/100) && <button type="button" onClick={() => setNavigatorPage(Math.ceil(selected/100))} className="text-xs text-neutral-300 underline">Current</button>}
                  </div>
                </div>
                <div ref={navigatorScroll} data-episode-navigator-scroll tabIndex={0} aria-label="Scrollable episodes" className="p-3">
                  {navigatorRows.length === 0 ? <p className="text-sm text-neutral-400 p-3">No released episodes in this range.</p> : navigatorMode === "numbers" ? (
                    <div className="grid grid-cols-5 gap-1.5">
                      {navigatorRows.map(e => {
                        const n=e.episodeNumber, active=n===selected
                        return <button key={n} type="button" aria-current={active ? "true" : undefined} aria-label={"Episode " + n} title={metadata[n]?.title || e.episodeTitle || "Episode " + n} onClick={() => { if (!active) openEpisode(n) }} className={`min-w-0 h-10 rounded-md text-xs sm:text-sm font-semibold tabular-nums transition focus-visible:outline focus-visible:outline-white ${active ? "bg-white text-black" : "bg-neutral-800/80 text-neutral-200 hover:bg-neutral-700"}`}>{n}</button>
                      })}
                    </div>
                  ) : <div className="space-y-1.5">
                    {navigatorRows.map(e => {
                      const n=e.episodeNumber, active=n===selected, md=metadata[n], art=md?.image || thumbnails.get(n) || e.episodeMetadata?.image
                      return <button key={n} type="button" aria-current={active ? "true" : undefined} aria-label={"Episode " + n} onClick={() => { if (!active) openEpisode(n) }} className={`w-full flex items-center gap-2 rounded-lg border p-2 text-left transition ${active ? "border-white/60 bg-white/10" : "border-transparent hover:bg-neutral-800"}`}>
                        <div className="w-20 aspect-video shrink-0 rounded bg-neutral-900 overflow-hidden grid place-items-center">{art ? <img src={art} alt="" loading="lazy" className="w-full h-full object-cover" /> : <LuPlay className="size-4 text-neutral-500" />}</div>
                        <div className="flex-1 min-w-0"><p className="text-xs font-semibold">{active ? "Playing · " : ""}Episode {n}</p><p className="text-xs text-neutral-400 line-clamp-2 mt-1">{md?.title || e.episodeTitle || "Episode " + n}</p></div>
                      </button>
                    })}
                  </div>}
                </div>
                <div className="px-4 py-3 border-t border-neutral-800 text-xs text-neutral-400 flex justify-between gap-2"><span>{navigatorRows.length} episodes in range</span>{currentArc && <span className="truncate" title={currentArc.title}>{currentArc.title}</span>}</div>
              </section>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}
