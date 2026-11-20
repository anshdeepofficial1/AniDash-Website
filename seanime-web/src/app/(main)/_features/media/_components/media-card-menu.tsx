import { ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuSub } from "@/components/ui/context-menu"
import { hideFromContinueWatching, LIST_STATUSES, localListStatus, markEpisodeWatched, removeFromList, restartEpisode, setListStatus } from "@/browser/card-actions"
import { useRouter } from "@/lib/navigation"
import { useQueryClient } from "@tanstack/react-query"
import React from "react"
import { LuArrowRight, LuCheck, LuCircleCheck, LuCopy, LuExternalLink, LuInfo, LuListPlus, LuPlay, LuRotateCcw, LuShare2, LuSquareArrowOutUpRight, LuTrash2, LuX } from "react-icons/lu"
import { toast } from "sonner"

type Props = {
    media: any
    /** Set on Continue Watching cards. */
    resume?: { episode: number, seconds: number }
    listStatus?: string
    onRemovedFromContinue?: () => void
}

const isMovie = (m: any) => m?.format === "MOVIE"

/** The full browser-side card menu: watch, list status, links and (on Continue Watching) removal. */
export function BrowserAnimeMenuItems({ media, resume, listStatus, onRemovedFromContinue }: Props) {
    const router = useRouter()
    const queryClient = useQueryClient()
    const [status, setStatus] = React.useState<string | undefined>(listStatus || localListStatus(media.id))
    const title = media.title?.english || media.title?.userPreferred || media.title?.romaji || "Anime"
    const link = `${location.origin}/entry?id=${media.id}`
    const total = Number(media.episodes) || 0

    const refresh = () => {
        window.dispatchEvent(new Event("anidash-watch-progress"))
        void queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).toLowerCase().includes("collection") })
    }
    const go = (episode?: number) => router.push(`/entry?id=${media.id}${episode ? "&episode=" + episode : ""}`)
    const safe = async (job: () => Promise<void> | void, ok: string) => {
        try { await job(); toast.success(ok); refresh() } catch (e) { toast.error((e as Error)?.message || "That did not work. Try again.") }
    }

    return <>
        <ContextMenuLabel className="text-[--muted] line-clamp-1 py-0 my-2">{title}</ContextMenuLabel>

        {resume ? <>
            <ContextMenuItem onClick={() => go(resume.episode)}>
                <LuPlay /> {resume.seconds > 0 ? `Resume episode ${resume.episode}` : isMovie(media) ? "Play movie" : `Play episode ${resume.episode}`}
            </ContextMenuItem>
            {resume.seconds > 0 && <ContextMenuItem onClick={() => { restartEpisode(media, resume.episode); go(resume.episode) }}>
                <LuRotateCcw /> Start episode from the beginning
            </ContextMenuItem>}
            {!isMovie(media) && (!total || resume.episode < total) && <ContextMenuItem onClick={() => go(resume.episode + 1)}>
                <LuArrowRight /> Play next episode ({resume.episode + 1})
            </ContextMenuItem>}
            <ContextMenuItem onClick={() => safe(() => markEpisodeWatched(media, resume.episode), `Episode ${resume.episode} marked as watched`)}>
                <LuCircleCheck /> Mark episode {resume.episode} as watched
            </ContextMenuItem>
        </> : <ContextMenuItem onClick={() => go(isMovie(media) ? 1 : 1)}>
            <LuPlay /> {isMovie(media) ? "Play movie" : "Watch from episode 1"}
        </ContextMenuItem>}
        <ContextMenuItem onClick={() => go()}><LuInfo /> Details</ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub triggerContent={<span className="flex items-center gap-2"><LuListPlus /> {status ? "Change list status" : "Add to my list"}</span>}>
            {LIST_STATUSES.map(([value, label]) => (
                <ContextMenuItem key={value} onClick={() => safe(async () => { await setListStatus(media, value); setStatus(value) }, `Moved to “${label}”`)}>
                    {status === value ? <LuCheck /> : <span className="size-4" />} {label}
                </ContextMenuItem>
            ))}
        </ContextMenuSub>
        {status && <ContextMenuItem onClick={() => safe(async () => { await removeFromList(media); setStatus(undefined) }, "Removed from your list")}>
            <LuTrash2 /> Remove from my list
        </ContextMenuItem>}

        {resume && <ContextMenuItem onClick={() => { hideFromContinueWatching(media, resume.episode); onRemovedFromContinue?.(); toast.success("Removed from Continue Watching"); refresh() }}>
            <LuX /> Remove from Continue Watching
        </ContextMenuItem>}

        <ContextMenuSeparator />

        <ContextMenuItem onClick={() => window.open(link, "_blank", "noopener")}><LuSquareArrowOutUpRight /> Open in new tab</ContextMenuItem>
        <ContextMenuItem onClick={() => safe(async () => { await navigator.clipboard.writeText(link) }, "Link copied")}><LuCopy /> Copy link</ContextMenuItem>
        {typeof navigator !== "undefined" && "share" in navigator && <ContextMenuItem onClick={() => { void navigator.share({ title, url: link }).catch(() => {}) }}>
            <LuShare2 /> Share
        </ContextMenuItem>}
        <ContextMenuItem onClick={() => window.open(media.siteUrl || `https://anilist.co/anime/${media.id}`, "_blank", "noopener")}>
            <LuExternalLink /> Open on AniList
        </ContextMenuItem>
    </>
}
