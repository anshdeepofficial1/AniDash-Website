import { MediaCardLazyGrid } from "@/app/(main)/_features/media/_components/media-card-grid"
import { MediaEntryCard } from "@/app/(main)/_features/media/_components/media-entry-card"
import { orderSearchResults } from "@/app/(main)/_features/media/_components/media-card-tags"
import { useAnilistAdvancedSearch } from "@/app/(main)/search/_lib/handle-advanced-search"
import { __advancedSearch_paramsAtom } from "@/app/(main)/search/_lib/advanced-search.atoms"
import { useAtomValue } from "jotai/react"
import { cn } from "@/components/ui/core/styling"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import React from "react"
import { AiOutlinePlusCircle } from "react-icons/ai"

export function AdvancedSearchList() {

    const { isLoading, isError, error, refetch, data, fetchNextPage, hasNextPage, type } = useAnilistAdvancedSearch()

    const params = useAtomValue(__advancedSearch_paramsAtom)
    const items = React.useMemo(() => {
        const list = data?.pages.filter(Boolean).flatMap(n => n.Page?.media).filter(Boolean) ?? []
        const seen = new Set<number>()
        return list.filter(m => m && !seen.has(m.id) && !!seen.add(m.id)) as NonNullable<typeof list[number]>[]
    }, [data])
    const ordered = React.useMemo(
        () => (type === "anime" && params.title?.trim()) ? orderSearchResults(items as any[], params.title) as typeof items : items,
        [items, type, params.title],
    )

    if (isError) return <div role="alert" className="rounded-xl border p-5 space-y-3"><p>{(error as Error)?.message || "Unable to load search results."}</p><button className="border rounded-lg px-4 py-2" onClick={() => refetch()}>Try again</button></div>
    if (!isLoading && !items?.length) return <p className="text-[--muted] p-4">No matching titles. Try another title or clear filters.</p>
    return <>
        {!isLoading && <MediaCardLazyGrid itemCount={ordered.length}>
            {ordered.map(media => (
                <MediaEntryCard key={`${media.id}`} media={media} showLibraryBadge={true} showTrailer type={type} />
            ))}
        </MediaCardLazyGrid>}
        {isLoading && <LoadingSpinner />}
        {(items.length > 0 && hasNextPage) &&
            <div
                data-advanced-search-list-load-more-container
                className={cn(
                    "relative flex flex-col rounded-[--radius-md] animate-none",
                    "cursor-pointer border border-none text-[--muted] hover:text-white pt-24 items-center gap-2 transition",
                )}
                onClick={() => fetchNextPage()}
            >
                <AiOutlinePlusCircle className="text-4xl" />
                <p className="text-lg font-medium">Load more</p>
            </div>}
    </>
}
