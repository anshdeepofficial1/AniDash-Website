import { cn } from "@/components/ui/core/styling"
import React from "react"
import { LuStar } from "react-icons/lu"

type TitleLike = { userPreferred?: string | null, romaji?: string | null, english?: string | null } | null | undefined

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 }
const ROMAN: Record<string, number> = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6 }

/** AniList has no season number, so read it from the title ("2nd Season", "Season 3", "Part 2"...). Defaults to 1. */
export function seasonNumberFromTitle(title: TitleLike): number {
    const names = [title?.english, title?.romaji, title?.userPreferred].filter(Boolean) as string[]
    for (const t of names) {
        let m = t.match(/(\d+)(?:st|nd|rd|th)\s+season/i) || t.match(/season\s+(\d+)/i) || t.match(/\bS(\d{1,2})\b/)
        if (m) return Number(m[1])
        m = t.match(/\b(first|second|third|fourth|fifth|sixth)\s+season/i)
        if (m) return ORDINALS[m[1].toLowerCase()]
        m = t.match(/\s(II|III|IV|V|VI)$/)
        if (m) return ROMAN[m[1].toLowerCase()]
    }
    return 1
}

type Props = {
    format?: string | null
    title?: TitleLike
    score?: number | null
    episodes?: number | null
    isAdult?: boolean | null
}

const FORMAT_LABELS: Record<string, string> = {
    MOVIE: "MOVIE", OVA: "OVA", ONA: "ONA", SPECIAL: "SPECIAL", TV_SHORT: "SHORT", MUSIC: "MUSIC",
}

const chip = "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold leading-none backdrop-blur-sm shadow"

/** Small tag row on top of a poster: season/format, 18+ and rating, plus an episode count at the bottom. */
export function MediaCardTags({ format, title, score, episodes, isAdult }: Props) {
    const special = format ? FORMAT_LABELS[format] : undefined
    const label = special ?? `S${seasonNumberFromTitle(title)}`
    const rating = typeof score === "number" && score > 0 ? (score / 10).toFixed(1) : null

    return <>
        <div data-media-card-tags className="absolute z-[11] top-1.5 left-1.5 right-1.5 flex items-start justify-between gap-1 pointer-events-none">
            <div className="flex items-center gap-1 flex-wrap">
                <span className={cn(chip, special ? "bg-sky-500/85 text-white" : "bg-emerald-400/85 text-emerald-950")}>{label}</span>
                {isAdult && <span className={cn(chip, "bg-red-600/90 text-white")}>18+</span>}
            </div>
            {rating && <span className={cn(chip, "gap-0.5 bg-black/60 text-amber-300")}><LuStar className="size-3 fill-current" />{rating}</span>}
        </div>
        {!!episodes && format !== "MOVIE" && <span
            data-media-card-episodes
            className="absolute z-[11] left-1.5 bottom-1.5 text-[11px] font-semibold text-white/90 drop-shadow pointer-events-none"
        >{episodes} EP</span>}
    </>
}

type SortableMedia = {
    format?: string | null
    startDate?: { year?: number | null, month?: number | null, day?: number | null } | null
    seasonYear?: number | null
    synonyms?: (string | null)[] | null
    title?: { userPreferred?: string | null, romaji?: string | null, english?: string | null } | null
}

const norm = (t?: string | null) => (t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

function dateKey(m: SortableMedia) {
    const d = m.startDate
    return (d?.year ?? m.seasonYear ?? 9999) * 10000 + (d?.month ?? 0) * 100 + (d?.day ?? 0)
}

/**
 * Title search order: everything that belongs to the searched franchise comes first, in release order
 * (Season 1, Season 2, Season 3, movie, Season 4 ...), then any other matches in the search's own order.
 */
export function orderSearchResults<T extends SortableMedia>(items: T[], query: string): T[] {
    const q = norm(query)
    if (!q) return items
    const names = (m: T) => [m.title?.english, m.title?.romaji, m.title?.userPreferred, ...(m.synonyms || [])].map(norm).filter(Boolean)
    const inFranchise = (m: T) => names(m).some(n => n === q || n.startsWith(q + " ") || n.startsWith(q))
    const franchise = items.filter(inFranchise).sort((a, b) => dateKey(a) - dateKey(b))
    const rest = items.filter(m => !inFranchise(m))
    return [...franchise, ...rest]
}
