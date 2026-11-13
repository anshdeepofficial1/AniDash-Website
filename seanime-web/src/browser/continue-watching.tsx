import React from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@/lib/navigation"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { browserContinueWatching } from "./resume"
import { LuPlay } from "react-icons/lu"

type EpisodeArtwork = { number: number; title?: string; image?: string | null }
const metadataPrefix = "anidash.episodes.v2:"
const time = (s: number) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0")
const secureImage = (value: unknown): value is string => typeof value === "string" && /^https:\/\//i.test(value)
function cachedPage(id: number, page: number): EpisodeArtwork[] | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(metadataPrefix + id + ":" + page) || "null")
    if (cached && Date.now() - cached.at < 7 * 86400000 && Array.isArray(cached.episodes)) return cached.episodes
  } catch {}
}
async function fetchEpisodePage(id: number, mal: number, page: number, signal: AbortSignal): Promise<EpisodeArtwork[]> {
  const response = await fetch("/api/episode-metadata?anilist=" + id + "&id=" + mal + "&page=" + page + "&fast=1", { signal })
  if (!response.ok) throw Error("Episode artwork unavailable")
  const data = await response.json()
  if (!Array.isArray(data.episodes)) throw Error("Invalid episode metadata")
  const rows = data.episodes as EpisodeArtwork[]
  const merged = new Map((cachedPage(id, page) || []).map(item => [item.number, item]))
  for (const row of rows) {
    const prior = merged.get(row.number)
    merged.set(row.number, { ...prior, ...row, title: row.title || prior?.title, image: row.image || prior?.image })
  }
  const episodes = [...merged.values()]
  if (episodes.length) try {
    localStorage.setItem(metadataPrefix + id + ":" + page, JSON.stringify({ at: Date.now(), episodes }))
    const keys = Object.keys(localStorage).filter(key => key.startsWith(metadataPrefix))
    while (keys.length > 50) localStorage.removeItem(keys.shift()!)
  } catch {}
  return episodes
}

function ContinueWatchingCard({ resume }: { resume: any }) {
  const router = useRouter()
  const m = resume.media
  const episode = Number(resume.episode)
  const page = Math.ceil(episode / 100)
  const title = m.title?.english || m.title?.userPreferred || m.title?.romaji || "Anime"
  const q = useQuery({
    queryKey: ["anidash-episode-artwork", m.id, page],
    queryFn: ({ signal }) => fetchEpisodePage(m.id, m.idMal || 0, page, signal),
    enabled: Number.isSafeInteger(episode) && page >= 1 && page <= 30,
    initialData: () => cachedPage(m.id, page),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  })
  const episodeMeta = q.data?.find(item => item.number === episode)
  const catalogArt = (m.streamingEpisodes || []).find((item: any) =>
    Number(String(item.title || "").match(/(?:episode|ep\.?)\s*(\d+)/i)?.[1]) === episode)
  const episodeImage = [episodeMeta?.image, catalogArt?.thumbnail].find(secureImage)
  const fallback = [m.bannerImage, m.coverImage?.extraLarge, m.coverImage?.large].find(secureImage)
  const [failedImage, setFailedImage] = React.useState("")
  const art = episodeImage && episodeImage !== failedImage ? episodeImage : fallback && fallback !== failedImage ? fallback : undefined
  const progress = resume.duration > 0 ? Math.max(0, Math.min(100, resume.seconds / resume.duration * 100)) : 0
  return (
    <button type="button" className="group shrink-0 w-56 sm:w-64 rounded-xl overflow-hidden border bg-[--paper] text-left transition hover:border-white/40"
      aria-label={"Resume " + title + " episode " + episode} onClick={() => router.push("/entry?id=" + m.id + "&episode=" + episode)}>
      <div className="relative aspect-video w-full overflow-hidden bg-[--subtle]">
        {art && <img key={art} src={art} alt={episodeImage === art ? title + " episode " + episode + " thumbnail" : ""} decoding="async"
          onError={() => setFailedImage(art)} className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
        <div className="absolute left-3 bottom-3 grid size-9 place-items-center rounded-full bg-black/45 text-white transition group-hover:bg-white group-hover:text-black">
          <LuPlay className="size-5 fill-current" />
        </div>
        {resume.duration > 0 && <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25"><div className="h-full bg-white" style={{ width: progress + "%" }} /></div>}
      </div>
      <div className="p-3 space-y-1">
        <p className="font-semibold truncate">{title}</p>
        {episodeMeta?.title && <p className="truncate text-xs text-[--muted]" title={episodeMeta.title}>{episodeMeta.title}</p>}
        <p className="text-xs text-[--muted]">Episode {episode}{resume.seconds > 0 ? " · Resume " + time(resume.seconds) : " · Start episode"}</p>
      </div>
    </button>
  )
}
export function BrowserContinueWatching() {
  const status = useServerStatus()
  const [revision, setRevision] = React.useState(0)
  const userId = status?.user?.viewer?.id || 0
  const q = useQuery({ queryKey: ["anidash-continue-watching", userId, revision], queryFn: () => browserContinueWatching(), staleTime: 15000, refetchOnWindowFocus: true })
  React.useEffect(() => {
    const refresh = () => setRevision(v => v + 1)
    const events = ["anidash-watch-progress", "storage", "anidash-account-ready"]
    events.forEach(event => window.addEventListener(event, refresh))
    return () => events.forEach(event => window.removeEventListener(event, refresh))
  }, [])
  if (q.isPending) return <section className="relative z-[5] px-4 py-5"><h2 className="text-xl font-semibold">Continue Watching</h2><p className="text-sm text-[--muted]">Loading watch progress…</p></section>
  if (q.isError) return <section className="relative z-[5] px-4 py-5"><h2>Continue Watching</h2><p>Could not sync your watch list. <button onClick={() => q.refetch()} className="underline">Retry</button></p></section>
  if (!q.data?.length) return null
  return <section className="relative z-[5] px-4 sm:px-6 py-5 space-y-3" data-anidash-continue-watching>
    <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Continue Watching</h2><button className="text-xs text-[--muted] underline" onClick={() => q.refetch()}>Refresh</button></div>
    <div className="flex overflow-x-auto gap-3 pb-2">{q.data.map(r => <ContinueWatchingCard key={r.media.id + ":" + r.episode} resume={r} />)}</div>
  </section>
}
