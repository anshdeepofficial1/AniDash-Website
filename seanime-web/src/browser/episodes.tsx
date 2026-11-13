import { getEpisodeResume, localResume, persistPlayback, syncPlayback } from "./resume"
import React from "react"
import { useRouter } from "@/lib/navigation"
import Hls from "hls.js"
import { Anime_Entry } from "@/api/generated/types"
import { Button } from "@/components/ui/button"
import { getArcs } from "./arcs"
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
  url: string
  originalUrl?: string
  quality?: string
  server?: string
  serverId?: string
  type?: string
  isM3U8?: boolean
  isDub?: boolean
}

type StreamTrack = { url?: string; file?: string; src?: string; lang?: string; label?: string; language?: string; kind?: string; type?: string }
type CaptionFile = { id: string; url: string; label: string; language: string }
type CaptionOption = { index: number; label: string; language: string }
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
    const language = /^(en|eng|english)(?:[-_ ].*)?$/i.test(lang) || /english/i.test(label) ? "en" : /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/i.test(lang) ? lang : "und"
    return { id: "remote-" + index, url: u.href, label, language }
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
const DEFAULT_SERVER = "onyx"
const CONTROL_IDLE_MS = 3000
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
  const [selectedServer, setSelectedServer] = React.useState<string>(DEFAULT_SERVER)
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
  const [captionDelay, setCaptionDelay] = React.useState(0)
  const [captionSize, setCaptionSize] = React.useState<number>([0.8, 1, 1.25, 1.5].includes(initial.preferences?.playerCaptionSize) ? initial.preferences.playerCaptionSize : 1)
  const [captionBackground, setCaptionBackground] = React.useState(initial.preferences?.playerCaptionBackground !== false)
  const [playerMenu, setPlayerMenu] = React.useState<PlayerMenu>(null)
  const [pipSupported, setPipSupported] = React.useState(false)
  const [pipActive, setPipActive] = React.useState(false)
  const [playerNotice, setPlayerNotice] = React.useState("")
  const [hlsLevels, setHlsLevels] = React.useState<{ index: number; label: string }[]>([])
  const [qualityLevel, setQualityLevel] = React.useState(-1)
  const [controlsVisible, setControlsVisible] = React.useState(true)
  const [isLoadingStream, setIsLoadingStream] = React.useState(false)
  const [error, setError] = React.useState("")
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [isMuted, setIsMuted] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [buffering, setBuffering] = React.useState(false)
  const [playbackRevision, setPlaybackRevision] = React.useState(0)
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
  const progressPercent = duration > 0 ? Math.max(0, Math.min(100, currentTime / duration * 100)) : 0

  const [arc, setArc] = React.useState("all")
  const [page, setPage] = React.useState(1)
  const [jump, setJump] = React.useState("")
  const [layout, setLayout] = React.useState<"grid" | "list">(
    initial.preferences?.episodeViewMode === "list" ? "list" : "grid"
  )
  const [metadata, setMetadata] = React.useState<Record<number, Metadata>>({})
  const [metaError, setMetaError] = React.useState(false)
  const [metaRevision, setMetaRevision] = React.useState(0)

  const video = React.useRef<HTMLVideoElement>(null)
  const playerWrapper = React.useRef<HTMLDivElement>(null)
  const surfaceClickTimer = React.useRef<number | undefined>(undefined)
  const lastSurfaceTap = React.useRef<{ at: number; x: number; y: number } | null>(null)
  const pointerDragging = React.useRef(false)
  const lastPointer = React.useRef<{ x: number; y: number } | null>(null)
  const hlsInstance = React.useRef<Hls | null>(null)
  const subtitleInput = React.useRef<HTMLInputElement>(null)
  const uploadedUrl = React.useRef<string | null>(null)
  const controlsTimer = React.useRef<number | undefined>(undefined)
  const selectedCaptionIndex = captionChoice === "upload" && uploadedCaption
    ? captionOptions.find(t => t.label === uploadedCaption.label)?.index
    : captionChoice !== "auto" && captionOptions.some(t => String(t.index) === captionChoice)
      ? Number(captionChoice)
      : (captionOptions.find(t => /^en(?:[-_]|$)/i.test(t.language) || /english/i.test(t.label)) || captionOptions[0])?.index
  const captionLabel = captionOptions.find(t => t.index === selectedCaptionIndex)?.label || "Unavailable"
  const controlClass = "shrink-0 grid size-8 sm:size-10 place-items-center rounded-xl text-white/90 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-35 disabled:pointer-events-none transition"
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
  const pages =
    watchMode && selected > 0
      ? String(Math.ceil(selected / 100))
      : Array.from(new Set(visible.map(e => Math.ceil(e.episodeNumber / 100)))).join(",")

  // Reset episode state when route changes
  React.useEffect(() => {
    setSelected(watchEpisode || 0)
    setError("")
    setArc("all")
    setPage(1)
    setMetadata({})
    setJump("")
    lastSaved.current = 0
  }, [entry.mediaId, watchEpisode])

  // Fetch episode metadata
  React.useEffect(() => {
    if (!m.id || !pages) return
    let live = true
    setMetaError(false)
    const ids = pages.split(",").map(Number)
    ;(async () => {
      for (const p of ids) {
        try {
          const key = m.id + ":" + p
          let items = metadataCache.get(key)
          if (!items) {
            const response = await fetch(
              "/api/episode-metadata?anilist=" + m.id + "&id=" + (m.idMal || 0) + "&page=" + p
            )
            if (!response.ok) throw Error("Metadata unavailable")
            items = ((await response.json()).episodes || []) as Metadata[]
            metadataCache.set(key, items)
          }
          if (live) setMetadata(prev => ({ ...prev, ...Object.fromEntries(items.map(x => [x.number, x])) }))
        } catch {
          if (live) setMetaError(true)
        }
      }
    })()
    return () => {
      live = false
    }
  }, [m.id, m.idMal, pages, metaRevision])

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

    // Fetch server availability map in background
    fetch(`/api/justanime?action=servers&id=${entry.mediaId}&episode=${selected}&category=${audio}`)
      .then(r => r.json())
      .then(d => {
        if (live && d?.serverMap) setServerMap(d.serverMap)
      })
      .catch(() => {})

    async function resolveStreams() {
      const serverParam = selectedServer || DEFAULT_SERVER

      // 1. Try JustAnime with selected server
      try {
        const res = await fetch(
          `/api/justanime?action=streams&id=${entry.mediaId}&episode=${selected}&category=${audio}&server=${serverParam}`
        )
        if (res.ok) {
          const data = await res.json()
          if (live && Array.isArray(data.sources) && data.sources.length > 0) {
            setStreams(data.sources)
            setActiveStream(data.sources[0])
            setTracks(Array.isArray(data.tracks) ? data.tracks : [])
            setSegments({ intro: parseSkipInterval(data.intro), outro: parseSkipInterval(data.outro) })
            setIsLoadingStream(false)
            return
          }
        }
      } catch (_) {}

      // 2. Try JustAnime auto
      try {
        const res = await fetch(
          `/api/justanime?action=streams&id=${entry.mediaId}&episode=${selected}&category=${audio}&server=auto`
        )
        if (res.ok) {
          const data = await res.json()
          if (live && Array.isArray(data.sources) && data.sources.length > 0) {
            setStreams(data.sources)
            setActiveStream(data.sources[0])
            setTracks(Array.isArray(data.tracks) ? data.tracks : [])
            setSegments({ intro: parseSkipInterval(data.intro), outro: parseSkipInterval(data.outro) })
            setIsLoadingStream(false)
            return
          }
        }
      } catch (_) {}

      // 3. Fallback to HiAnime
      try {
        const res = await fetch(
          `/api/hianime?action=streams&id=${entry.mediaId}&episode=${selected}&category=${audio}`
        )
        if (res.ok) {
          const data = await res.json()
          if (live && Array.isArray(data.sources) && data.sources.length > 0) {
            setStreams(data.sources)
            setActiveStream(data.sources[0])
            setTracks(Array.isArray(data.tracks) ? data.tracks : [])
            setSegments({ intro: parseSkipInterval(data.intro), outro: parseSkipInterval(data.outro) })
            setIsLoadingStream(false)
            return
          }
        }
      } catch (_) {}

      // 4. Fallback to AniKoto
      try {
        const res = await fetch(
          `/api/anikoto?action=streams&id=${entry.mediaId}&episode=${selected}&category=${audio}`
        )
        if (res.ok) {
          const data = await res.json()
          if (live && Array.isArray(data.sources) && data.sources.length > 0) {
            setStreams(data.sources)
            setActiveStream(data.sources[0])
            setTracks(Array.isArray(data.tracks) ? data.tracks : [])
            setSegments({ intro: parseSkipInterval(data.intro), outro: parseSkipInterval(data.outro) })
            setIsLoadingStream(false)
            return
          }
        }
      } catch (_) {}

      if (live) {
        setIsLoadingStream(false)
        setError(
          `No playable ${audio.toUpperCase()} streams found for Episode ${selected}. Please try another server below.`
        )
      }
    }

    resolveStreams()
    return () => {
      live = false
    }
  }, [entry.mediaId, selected, audio, selectedServer, watchMode])

  // Playback & HLS setup
  React.useEffect(() => {
    setError("")
    const el = video.current
    if (!el || !activeStream?.url || !selected) return

    let hls: Hls | undefined
    let live = true

    setBuffering(true)
    setCurrentTime(0)
    setDuration(0)
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
      if (!live) return
      if (pos > 0 && Number.isFinite(el.duration) && pos < el.duration && el.currentTime < 1) {
        el.currentTime = pos
      }
      if (getStore().preferences?.playerAutoplay === false) {
        setBuffering(false)
        return
      }
      void el.play().catch((reason: unknown) => {
        if (!live) return
        setBuffering(false)
        setIsPlaying(false)
        if (reason instanceof DOMException && reason.name === "NotAllowedError") return
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
        lowLatencyMode: true
      })
      hlsInstance.current = hls
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!live || !hls) return
        setHlsLevels(hls.levels.map((level, index) => ({ index, label: level.height ? level.height + "p" : Math.round(level.bitrate / 1000) + " kbps" })))
      })
      hls.loadSource(streamUrl)
      hls.attachMedia(el)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls?.startLoad()
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls?.recoverMediaError()
              break
            default:
              setError("Stream could not be played. Switch to another server below.")
              hls?.destroy()
              break
          }
        }
      })
    } else {
      el.src = streamUrl
    }

    return () => {
      live = false
      el.removeEventListener("loadedmetadata", onLoadedMetadata)
      if (hlsInstance.current === hls) hlsInstance.current = null
      hls?.destroy()
      el.pause()
      el.removeAttribute("src")
      el.load()
    }
  }, [activeStream?.url, selected, playbackRevision])

  // Surface media stalls rather than displaying an endless loading indicator.
  React.useEffect(() => {
    if (!buffering || !activeStream?.url || isLoadingStream || error) return
    const timeout = window.setTimeout(() => {
      setBuffering(false)
      setIsPlaying(false)
      video.current?.pause()
      setError("The media did not deliver playable frames. Retry playback or check your connection.")
    }, 20000)
    return () => window.clearTimeout(timeout)
  }, [buffering, activeStream?.url, isLoadingStream, error, playbackRevision])

  // External subtitles use ordinary browser CORS, converted to local WebVTT.
  // No media-source settings, credentials or access restrictions are changed.
  React.useEffect(() => {
    if (!watchMode) return
    const abort = new AbortController()
    const urls: string[] = []
    setCaptionFiles([])
    setCaptionMessage("")
    setCaptionChoice("auto")
    const candidates = tracks.map(captionSource).filter((item): item is CaptionFile => !!item)
    if (!candidates.length) return () => abort.abort()
    void Promise.all(candidates.map(async item => {
      try {
        const response = await fetch(item.url, { signal: abort.signal, credentials: "same-origin" })
        if (!response.ok) throw Error("Subtitle request failed")
        const raw = await response.text()
        if (raw.length > 2_000_000 || abort.signal.aborted) return null
        const url = URL.createObjectURL(new Blob([subtitleVtt(raw)], { type: "text/vtt" }))
        urls.push(url)
        return { ...item, url }
      } catch { return null }
    })).then(results => {
      if (abort.signal.aborted) return
      const files = results.filter((item): item is CaptionFile => !!item)
      setCaptionFiles(files)
      if (files.length < candidates.length) setCaptionMessage("Some subtitle files could not be loaded by this browser.")
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
      const items = Array.from(list).flatMap((track, index) =>
        track.kind === "subtitles" || track.kind === "captions" ? [{ index, label: track.label || track.language || "Subtitle " + (index + 1), language: track.language }] : [])
      setCaptionOptions(items)
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
      const cues = Array.from(track.cues || [])
      setCaptionText(cues.filter(cue => cue.startTime <= time && time < cue.endTime).map(captionPlainText).filter(Boolean).join("\n"))
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
    const finish = () => {
      if (!pointerDragging.current) return
      pointerDragging.current = false
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
    const el = video.current
    if (!el || !selected || !Number.isFinite(el.duration) || el.duration <= 0) return
    if (!force && Date.now() - lastSaved.current < 5000) return
    const position = ended ? el.duration : el.currentTime
    if (position < 1 && !ended) return
    lastSaved.current = Date.now()
    persistPlayback(m, selected, position, el.duration, ended)

    if ((force || Date.now() - lastSynced.current >= 10000) && (!syncBusy.current || force)) {
      lastSynced.current = Date.now()
      syncBusy.current = true
      setSyncState("Saving progress…")
      void syncPlayback(m, selected, position, el.duration, ended)
        .then(ok => setSyncState(ok ? "Synced with AniList" : "Saved on this device"))
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
    document.addEventListener("visibilitychange", save)
    return () => document.removeEventListener("visibilitychange", save)
  }, [watchMode, selected, activeStream?.url])

  // Navigation handlers
  function openEpisode(n: number, alreadyRecorded = false) {
    if (n < 1 || n > total) return
    if (watchMode && !alreadyRecorded) record(true)
    router.push(`/entry?id=${entry.mediaId}&episode=${n}`)
  }

  function closePlayer() {
    if (watchMode) record(true)
    router.push(`/entry?id=${entry.mediaId}`)
  }

  function changeAudio(a: "dub" | "sub") {
    if (watchMode) record(true)
    setAudio(a)
    const s = getStore()
    saveStore({ ...s, preferences: { ...s.preferences, preferredAudio: a } })
  }

  function pickServer(serverKey: string, channel: "sub" | "dub") {
    if (watchMode) record(true)
    setAudio(channel)
    setSelectedServer(serverKey)
    const s = getStore()
    saveStore({ ...s, preferences: { ...s.preferences, preferredAudio: channel } })
  }

  function setPlaybackPreference(key: "playerAutoplay" | "playerAutoSkip" | "playerAutoNext", enabled: boolean) {
    if (key === "playerAutoplay") setAutoplay(enabled)
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
    if (!el) return
    if (el.paused) {
      setError("")
      void el.play().catch((reason: unknown) => {
        setBuffering(false)
        setIsPlaying(false)
        if (reason instanceof DOMException && (reason.name === "NotAllowedError" || reason.name === "AbortError")) return
        setError("The browser rejected playback. Check that the media format is supported.")
      })
    } else el.pause()
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
    const container = playerWrapper.current || video.current
    if (!container) return
    setPlayerMenu(null)
    wakeControls()
    focusPlayer()
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else if (container.requestFullscreen) {
      void container.requestFullscreen().catch(() => {})
    } else {
      const nativeVideo = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
      nativeVideo?.webkitEnterFullscreen?.()
    }
  }

  function toggleSubtitles() {
    updateCaptionEnabled(!subtitlesEnabled)
  }

  // Capture playback shortcuts before a mouse-clicked control can consume Space.
  // Preserve text editing, Tab navigation and keyboard activation of real controls.
  const shortcutHandler = React.useRef<(e: KeyboardEvent) => void>(() => {})
  shortcutHandler.current = (e: KeyboardEvent) => {
    if (!watchMode || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
    const target = e.target instanceof Element ? e.target : null
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

  const currentEpThumb =
    metadata[selected]?.image ||
    thumbnails.get(selected) ||
    m.bannerImage ||
    m.coverImage?.large ||
    "/icons/icon-192.png"

  const nextAiring = m.nextAiringEpisode
  const hasNextAiring =
    nextAiring && nextAiring.episode && Number(nextAiring.timeUntilAiring || 0) > 0

  return (
    <section className="space-y-5" data-anidash-browser-episodes>
      <style>{`
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
        <div className="rounded-xl border p-4 flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h2>Watch movie</h2>
            <p className="text-sm text-[--muted]">Open the full-page video player.</p>
          </div>
          <Button intent="white" onClick={() => openEpisode(1)}>
            <LuPlay /> Watch movie
          </Button>
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
        <div data-anidash-watch-page onClick={returnPointerFocus} className="w-full max-w-6xl mx-auto p-2 sm:p-4 md:p-6 space-y-4">
          {/* Header */}
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs sm:text-sm text-[--muted]">
                {m.title?.userPreferred || m.title?.english || m.title?.romaji}
              </p>
              <h3 className="text-lg sm:text-2xl font-bold">
                {m.format === "MOVIE" ? "Movie" : "Episode " + selected}
                {metadata[selected]?.title ? " — " + metadata[selected].title : ""}
              </h3>
            </div>
            <Button intent="gray-outline" aria-label="Back to anime details" onClick={closePlayer}>
              <LuChevronLeft /> Details
            </Button>
          </header>

          {/* Audio Language & Available Streams Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                intent={audio === "dub" ? "white" : "gray-outline"}
                onClick={() => changeAudio("dub")}
              >
                English DUB
              </Button>
              <Button
                intent={audio === "sub" ? "white" : "gray-outline"}
                onClick={() => changeAudio("sub")}
              >
                Japanese SUB
              </Button>
            </div>

            {streams.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto text-xs text-[--muted]">
                <span>Quality:</span>
                {streams.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveStream(s)}
                    className={`px-2 py-1 rounded text-xs transition ${
                      activeStream?.url === s.url
                        ? "bg-white text-black font-semibold"
                        : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                    }`}
                  >
                    {s.quality || s.server || `Stream ${idx + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Video Player Wrapper */}
          <div
            data-player-wrapper
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
              <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-white">
                <div className="w-8 h-8 border-3 border-white/20 border-t-white rounded-full animate-spin" />
                <p className="text-sm font-medium">Connecting to {selectedServer.toUpperCase()} server…</p>
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
                <div className="flex flex-wrap justify-center gap-2">
                  {activeStream?.url && <Button size="sm" intent="gray-outline" onClick={() => { setError(""); setPlaybackRevision(n => n + 1) }}>Retry playback</Button>}
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

            {/* Video Element */}
            <video
              ref={video}
              playsInline
              preload="auto"
              className="absolute inset-0 w-full h-full object-contain bg-black"
              onClick={clickVideoSurface}
              onDoubleClick={e => e.preventDefault()}
              onLoadedMetadata={e => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
              onDurationChange={e => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
              onPlay={() => { setIsPlaying(true); setBuffering(true) }}
              onPlaying={() => { setIsPlaying(true); setBuffering(false); setError("") }}
              onCanPlay={() => setBuffering(false)}
              onWaiting={e => { if (!e.currentTarget.paused) setBuffering(true) }}
              onStalled={e => { if (!e.currentTarget.paused) setBuffering(true) }}
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
                  if (autoSkip && !el.paused && !el.seeking && !isLoadingStream) {
                    const segment = availableSegments.find(item =>
                      el.currentTime >= item.start && el.currentTime < item.end && !skippedSegments.current.has(item.kind))
                    if (segment) skipSegment(segment)
                  }
                  record()
                }
              }}
              onSeeked={() => record(true)}
              onEnded={() => {
                setIsPlaying(false)
                record(true, true)
                if (autoNext && selected < total) openEpisode(selected + 1, true)
              }}
              onError={() => {
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
                <track key={t.id + t.url} kind="subtitles" src={t.url} srcLang={t.language} label={t.label}
                  onLoad={() => setCaptionRevision(n => n + 1)}
                  onError={() => setCaptionMessage("A subtitle track could not be read by the browser.")} />
              ))}
            </video>
            <div className={`absolute top-3 right-3 sm:top-5 sm:right-5 z-10 pointer-events-none flex items-center gap-2 text-white drop-shadow-lg transition-opacity duration-200 ${controlsVisible || playerMenu ? "opacity-100" : "opacity-0"}`}>
              <span className="hidden sm:inline text-[9px] tracking-[0.2em] uppercase text-white/75">Powered by</span>
              <img src="/anidash-logo.png" alt="AniDash" className="size-6 sm:size-8 object-contain" />
              <span className="text-xs sm:text-sm font-extrabold tracking-tight">AniDash</span>
            </div>
            {captionText && subtitlesEnabled && !pipActive && (
              <div aria-live="off" className={`absolute inset-x-3 z-20 pointer-events-none text-center flex justify-center transition-all ${controlsVisible || playerMenu ? "bottom-24 sm:bottom-28" : "bottom-6 sm:bottom-10"}`}>
                <span className="max-w-[90%] whitespace-pre-line rounded px-2 py-1 font-semibold leading-snug text-white" style={{ fontSize: `clamp(${12 * captionSize}px, ${2.4 * captionSize}vw, ${27 * captionSize}px)`, background: captionBackground ? "rgba(0,0,0,.75)" : "transparent", textShadow: "0 1px 3px #000, 0 0 2px #000" }}>{captionText}</span>
              </div>
            )}
            {controlsVisible && !isPlaying && !buffering && !isLoadingStream && !error && activeStream?.url && (
              <button type="button" data-player-surface-action aria-label="Play video" onClick={e => { if (e.detail === 0) { cancelSurfaceTap(); togglePlay() } else clickVideoSurface(e) }} onDoubleClick={e => e.preventDefault()} className="absolute inset-0 m-auto z-10 size-14 sm:size-16 rounded-full bg-black/60 border border-white/30 text-white grid place-items-center hover:bg-white hover:text-black transition">
                <LuPlay className="size-7 fill-current" />
              </button>
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
                  </>}
                  {playerMenu === "quality" && <>
                    {hlsLevels.length > 0 ? [{ index: -1, label: "Auto" }, ...hlsLevels].map(level => <button key={level.index} type="button" className={menuRowClass} onClick={() => { chooseQuality(level.index); setPlayerMenu("settings") }}><span>{level.label}</span><span>{qualityLevel === level.index ? "✓" : ""}</span></button>) : streams.length > 1 ? streams.map((stream, index) => <button key={index} type="button" className={menuRowClass} onClick={() => { record(true); setActiveStream(stream); setPlayerMenu("settings") }}><span>{stream.quality || "Stream " + (index + 1)}</span><span>{activeStream?.url === stream.url ? "✓" : ""}</span></button>) : <p className="p-3 text-xs text-white/60">Only the current media quality is available.</p>}
                  </>}
                  {playerMenu === "speed" && [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <button key={rate} type="button" className={menuRowClass} onClick={() => { if (video.current) video.current.playbackRate = rate; setPlayerMenu("settings") }}><span>{rate === 1 ? "Normal" : rate + "×"}</span><span>{playbackRate === rate ? "✓" : ""}</span></button>)}
                  {playerMenu === "subtitles" && <>
                    <button type="button" className={menuRowClass + (!subtitlesEnabled ? " bg-white/15" : "")} onClick={() => updateCaptionEnabled(false)}><span>Off</span><span>{!subtitlesEnabled ? "✓" : ""}</span></button>
                    {captionOptions.map(option => <button key={option.index} type="button" className={menuRowClass + (subtitlesEnabled && selectedCaptionIndex === option.index ? " bg-white/15" : "")} onClick={() => { setCaptionChoice(String(option.index)); updateCaptionEnabled(true) }}><span className="truncate">{option.label}</span><span>{subtitlesEnabled && selectedCaptionIndex === option.index ? "✓" : ""}</span></button>)}
                    {!captionOptions.length && <p className="px-3 py-1 text-xs text-white/55">No subtitle tracks available for this media.</p>}
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
          <div className={`absolute inset-x-0 bottom-0 z-30 flex flex-col gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-2 sm:px-5 pt-8 pb-2 sm:pb-4 text-white text-sm transition-opacity duration-200 ${controlsVisible || playerMenu ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            <input ref={subtitleInput} type="file" accept=".vtt,.srt,text/vtt" className="hidden" onChange={e => { void uploadCaption(e.currentTarget.files?.[0]); e.currentTarget.value = "" }} />
            {playerNotice && <button type="button" onClick={() => setPlayerNotice("")} className="self-end text-xs rounded-lg bg-black/85 px-3 py-2">{playerNotice} · Dismiss</button>}
            <div className="relative mx-1 h-5 flex items-center focus-within:ring-2 focus-within:ring-white/80 rounded">
              <div className="absolute inset-x-0 h-1.5 rounded-full bg-white/25 overflow-hidden pointer-events-none">
                <div className="absolute inset-y-0 left-0 bg-white/75" style={{ width: progressPercent + "%" }} />
                {availableSegments.map(segment => (
                  <span key={segment.kind} className="absolute inset-y-0 bg-amber-400/90"
                    style={{ left: (segment.start / duration * 100) + "%", width: ((segment.end - segment.start) / duration * 100) + "%" }} />
                ))}
              </div>
              <span aria-hidden="true" className="absolute size-3 rounded-full bg-white shadow pointer-events-none -translate-x-1/2" style={{ left: progressPercent + "%" }} />
              <input
                type="range" aria-label="Playback position" min={0} max={duration > 0 ? duration : 1} step={0.1}
                disabled={!duration} value={Math.min(currentTime, duration || 1)}
                onPointerDown={startSliderDrag}
                onChange={e => { const el = video.current; if (el && duration > 0) { el.currentTime = Number(e.target.value); setCurrentTime(el.currentTime) } }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <div className="flex items-center justify-between gap-1 rounded-xl sm:rounded-2xl border border-white/15 bg-black/35 backdrop-blur-md px-1.5 sm:px-3 py-1">
              <div className="flex items-center gap-0.5 sm:gap-2 min-w-0">
                <button type="button" className={controlClass} onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <LuPause className="size-5" /> : <LuPlay className="size-5 fill-current" />}</button>
                <button type="button" className={controlClass} onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"}>{isMuted ? <LuVolumeX className="size-5" /> : <LuVolume2 className="size-5" />}</button>
                <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={isMuted ? 0 : volume} onPointerDown={startSliderDrag} onChange={e => { const el = video.current; if (el) { el.muted = false; el.volume = Number(e.target.value) } }} className="hidden lg:block w-16 accent-white" />
                <span className="whitespace-nowrap text-[10px] sm:text-xs tabular-nums px-0.5 sm:px-2">{formatSeconds(currentTime)} <span className="text-white/50">| {formatSeconds(duration)}</span></span>
              </div>
              <div className="flex items-center gap-0 sm:gap-1">
                <button type="button" className={controlClass + " hidden sm:grid"} aria-label="Back 10 seconds" onClick={() => seekRel(-10)}><LuRotateCcw className="size-5" /></button>
                <button type="button" className={controlClass + " hidden sm:grid"} aria-label="Forward 10 seconds" onClick={() => seekRel(10)}><LuRotateCw className="size-5" /></button>
                <button type="button" className={controlClass + (playerMenu === "subtitles" || playerMenu === "appearance" ? " bg-white/20" : "")} aria-label={"Subtitles: " + (subtitlesEnabled ? captionLabel : "Off")} aria-expanded={playerMenu === "subtitles" || playerMenu === "appearance"} onClick={() => setPlayerMenu(playerMenu === "subtitles" || playerMenu === "appearance" ? null : "subtitles")}><LuCaptions className="size-5" /></button>
                <button type="button" className={controlClass + (pipActive ? " bg-white/20" : "")} title={pipSupported ? "Picture-in-Picture" : "Picture-in-Picture unavailable"} aria-label="Picture-in-Picture" aria-pressed={pipActive} disabled={!pipSupported || !duration} onClick={() => void togglePip()}><PipIcon /></button>
                <button type="button" className={controlClass + (playerMenu === "settings" || playerMenu === "quality" || playerMenu === "speed" ? " bg-white/20" : "")} aria-label="Player settings" aria-expanded={playerMenu === "settings" || playerMenu === "quality" || playerMenu === "speed"} onClick={() => setPlayerMenu(playerMenu === "settings" || playerMenu === "quality" || playerMenu === "speed" ? null : "settings")}><LuSettings className="size-5" /></button>
                <button type="button" className={controlClass + " hidden sm:grid"} aria-label="Next episode" disabled={selected >= total} onClick={() => openEpisode(selected + 1)}><NextIcon /></button>
                <span className="hidden sm:block h-5 w-px bg-white/15 mx-1" />
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
          {/* Exact Server Selector Card (Matching Screenshot) */}
          <div className="rounded-xl border border-neutral-800 bg-[#0d0d0d] overflow-hidden flex flex-col md:flex-row shadow-lg">
            {/* Left box: You are watching */}
            <div className="p-4 md:w-72 shrink-0 flex items-center gap-3.5 bg-[#121212] border-b md:border-b-0 md:border-r border-neutral-800/80">
              <div className="relative w-20 sm:w-24 aspect-video rounded-lg overflow-hidden bg-neutral-900 border border-neutral-800 shrink-0">
                <img
                  src={currentEpThumb}
                  alt={`Episode ${selected} thumbnail`}
                  className="w-full h-full object-cover"
                  onError={e => {
                    const fallback = m.coverImage?.large || m.bannerImage || "/icons/icon-192.png"
                    if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
                  }}
                />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-semibold tracking-wider text-neutral-400 uppercase block">
                  YOU ARE WATCHING
                </span>
                <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Episode {selected}
                </h3>
              </div>
            </div>

            {/* Right box: Server Picker */}
            <div className="flex-1 p-4 space-y-3.5">
              <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                <span className="text-sm leading-none font-bold">ⓘ</span>
                <span>If this server doesn&apos;t load, try another one.</span>
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
                  {JUSTANIME_SERVERS.map(key => {
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
                  {JUSTANIME_SERVERS.map(key => {
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
                </div>
              </div>
            </div>
          </div>

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

          {/* Bottom Episode Navigation */}
          {m.format !== "MOVIE" && (
            <div className="flex justify-between items-center gap-2 pt-2">
              <Button
                intent="gray-outline"
                disabled={selected <= 1}
                onClick={() => openEpisode(selected - 1)}
              >
                <LuChevronLeft /> Previous
              </Button>
              <Button
                intent="gray-outline"
                disabled={selected >= total}
                onClick={() => openEpisode(selected + 1)}
              >
                Next episode <LuChevronRight />
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
