import { MediaCardLazyGrid } from "@/app/(main)/_features/media/_components/media-card-grid"
import { MediaEntryCard } from "@/app/(main)/_features/media/_components/media-entry-card"
import { groupSearchResults } from "@/app/(main)/_features/media/_components/media-card-tags"
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
    const hasTitle = !!params.title?.trim()
    // Group by Series / Movies / Other only for anime and only when no single format was picked.
    const groups = React.useMemo(
        () => (type === "anime" && !params.format) ? groupSearchResults(items as any[], hasTitle) as { key: string, label: string, items: typeof items }[] : null,
        [items, type, params.format, hasTitle],
    )

    if (isError) return <div role="alert" className="rounded-xl border p-5 space-y-3"><p>{(error as Error)?.message || "Unable to load search results."}</p><button className="border rounded-lg px-4 py-2" onClick={() => refetch()}>Try again</button></div>
    if (!isLoading && !items?.length) return <p className="text-[--muted] p-4">No matching titles. Try another title or clear filters.</p>
    return <>
        {!isLoading && (groups ? groups.map(g => (
            <section key={g.key} data-search-group={g.key} className="mb-8 space-y-3">
                <h3 className="flex items-baseline gap-2 text-lg font-semibold">{g.label}<span className="text-sm font-normal text-[--muted]">{g.items.length}</span></h3>
                <MediaCardLazyGrid itemCount={g.items.length}>
                    {g.items.map(media => (
                        <MediaEntryCard key={`${media.id}`} media={media} showLibraryBadge={true} showTrailer type={type} />
                    ))}
                </MediaCardLazyGrid>
            </section>
        )) : <MediaCardLazyGrid itemCount={items?.length ?? 0}>
            {items?.map(media => (
                <MediaEntryCard key={`${media.id}`} media={media} showLibraryBadge={true} showTrailer type={type} />
            ))}
        </MediaCardLazyGrid>)}
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
