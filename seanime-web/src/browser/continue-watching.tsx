import React from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@/lib/navigation"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { browserContinueWatching } from "./resume"
import { LuPlay } from "react-icons/lu"

const time = (s: number) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0")
type EpisodeMetadata = { number: number; title?: string; image?: string }

function ResumeCard({ item, onOpen }: { item: any; onOpen: () => void }) {
    const m = item.media
    const episode = Number(item.episode)
    const title = m.title?.english || m.title?.userPreferred || m.title?.romaji || "Anime"
    const page = Math.ceil(episode / 100)
    const metadata = useQuery({
        queryKey: ["anidash-resume-episode-metadata", m.id, m.idMal || 0, page],
        enabled: Number.isSafeInteger(episode) && episode > 0 && page <= 30,
        queryFn: async ({ signal }) => {
            const params = new URLSearchParams({ anilist: String(m.id), id: String(m.idMal || 0), page: String(page) })
            const response = await fetch("/api/episode-metadata?" + params, { signal })
            if (!response.ok) throw new Error("Episode artwork unavailable")
            const data = await response.json()
            return (Array.isArray(data.episodes) ? data.episodes : []) as EpisodeMetadata[]
        },
        staleTime: 30 * 60 * 1000,
        retry: 1,
    })
    const md = metadata.data?.find(e => e.number === episode)
    const fallback = m.bannerImage || m.coverImage?.extraLarge || m.coverImage?.large || ""
    const preferred = md?.image || fallback
    const [failed, setFailed] = React.useState<string[]>([])
    const artwork = [preferred, fallback].find(src => src && !failed.includes(src))
    const progress = item.duration > 0 ? Math.max(0, Math.min(100, item.seconds / item.duration * 100)) : 0
    return (
        <button type="button" onClick={onOpen} aria-label={title + ", episode " + episode + (item.seconds > 0 ? ", resume at " + time(item.seconds) : "")}
            className="group shrink-0 w-64 sm:w-72 rounded-xl overflow-hidden border bg-[--paper] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            <div className="relative aspect-video w-full overflow-hidden bg-[--subtle]">
                {artwork && <img key={artwork} src={artwork} loading="lazy" alt={artwork === md?.image ? "Episode " + episode + " thumbnail" : "Series artwork"} onError={() => setFailed(prev => [...prev, artwork])} className="h-full w-full object-cover" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
                <span className="absolute top-2 left-2 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold text-white">EP {episode}</span>
                <span className="absolute bottom-3 left-3 grid size-9 place-items-center rounded-full bg-white text-black transition group-hover:scale-110"><LuPlay className="size-5" /></span>
                {item.seconds > 0 && <span className="absolute bottom-3 right-3 rounded bg-black/70 px-2 py-1 text-xs text-white">{time(item.seconds)}</span>}
                {item.duration > 0 && <div className="absolute bottom-0 inset-x-0 h-1 bg-white/25"><div className="h-full bg-white" style={{ width: progress + "%" }} /></div>}
            </div>
            <div className="p-3 space-y-1">
                <p className="font-semibold truncate">{title}</p>
                <p className="text-xs text-[--muted] truncate">Episode {episode}{md?.title ? " · " + md.title : ""}</p>
                <p className="text-xs text-[--muted]">{item.seconds > 0 ? "Resume at " + time(item.seconds) : "Start episode"}</p>
            </div>
        </button>
    )
}

export function BrowserContinueWatching() {
    const router = useRouter(), status = useServerStatus()
    const [revision, setRevision] = React.useState(0)
    const userId = status?.user?.viewer?.id || 0
    const q = useQuery({ queryKey: ["anidash-continue-watching", userId, revision], queryFn: () => browserContinueWatching(), staleTime: 15000, refetchOnWindowFocus: true })
    React.useEffect(() => {
        const f = () => setRevision(v => v + 1)
        window.addEventListener("anidash-watch-progress", f)
        window.addEventListener("storage", f)
        window.addEventListener("anidash-account-ready", f)
        return () => {
            window.removeEventListener("anidash-watch-progress", f)
            window.removeEventListener("storage", f)
            window.removeEventListener("anidash-account-ready", f)
        }
    }, [])
    if (q.isPending) return <section className="relative z-[5] px-4 py-5"><h2 className="text-xl font-semibold">Continue Watching</h2><p className="text-sm text-[--muted]">Loading watch progress…</p></section>
    if (q.isError) return <section className="relative z-[5] px-4 py-5"><h2>Continue Watching</h2><p>Could not sync your watch list. <button onClick={() => q.refetch()} className="underline">Retry</button></p></section>
    if (!q.data?.length) return null
    return (
        <section className="relative z-[5] px-4 sm:px-6 py-5 space-y-3" data-anidash-continue-watching>
            <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Continue Watching</h2><button className="text-xs text-[--muted] underline" onClick={() => q.refetch()}>Refresh</button></div>
            <div className="flex overflow-x-auto gap-3 pb-2">
                {q.data.map(r => <ResumeCard key={r.media.id + ":" + r.episode} item={r} onOpen={() => router.push("/entry?id=" + r.media.id + "&episode=" + r.episode)} />)}
            </div>
        </section>
    )
}
