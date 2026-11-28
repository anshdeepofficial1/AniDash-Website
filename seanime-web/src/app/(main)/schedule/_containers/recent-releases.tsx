import { RankedShelf } from "@/browser/ranked-shelf"
import { useAnilistListRecentAiringAnime } from "@/api/hooks/anilist.hooks"
import { MediaEntryCard } from "@/app/(main)/_features/media/_components/media-entry-card"
import { MediaEntryCardSkeleton } from "@/app/(main)/_features/media/_components/media-entry-card-skeleton"
import { AppLayoutStack } from "@/components/ui/app-layout"
import { Carousel, CarouselContent, CarouselDotButtons } from "@/components/ui/carousel"
import { formatDistanceToNow, startOfDay } from "date-fns"
import React from "react"

export function RecentReleases() {

    const { data, isLoading } = useAnilistListRecentAiringAnime({
        page: 1,
        perPage: 50,
        airingAt_lesser: Math.floor(new Date().getTime() / 1000),
        airingAt_greater: Math.floor(startOfDay(new Date()).getTime() / 1000)-1,
    })

    const todayStart=Math.floor(startOfDay(new Date()).getTime()/1000)
    const candidates = data?.Page?.airingSchedules?.filter(item => item?.media?.isAdult === false
        && item?.media?.type === "ANIME"
        && item?.media?.countryOfOrigin === "JP"
        && item?.media?.format !== "TV_SHORT"
        && Number(item.airingAt)>=todayStart && Number(item.airingAt)<=Math.floor(Date.now()/1000),
    ).filter(Boolean)||[]
    const aired=Array.from(new Map([...candidates].sort((a,b)=>Number(a.airingAt)-Number(b.airingAt)).map(item=>[item.media?.id,item])).values()).sort((a,b)=>Number(b.airingAt)-Number(a.airingAt))

    return (
        <AppLayoutStack className="pb-6">
            <h2>Added recently · Today</h2>
            {!aired.length&&!isLoading?<p className="text-sm text-[--muted]">No episodes have aired today yet.</p>:<RankedShelf label="Today’s releases" items={aired.map(item=>({media:item.media,episode:item.episode,detail:"Episode "+item.episode+" · "+new Date(Number(item.airingAt)*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}))}/>}
            {(aired.length>0||isLoading)&&<Carousel
                className="w-full max-w-full"
                gap="md"
                opts={{
                    align: "start",
                    dragFree: true,
                }}
                carouselButtonContainerClass="top-[-3.5rem]"
                autoScroll
            >
                <CarouselDotButtons />
                <CarouselContent className="px-6">
                    {!isLoading ? aired?.map(item => {
                        return (
                            <MediaEntryCard
                                key={item.id}
                                media={item?.media!}
                                showLibraryBadge
                                containerClassName="basis-[200px] md:basis-[250px] mx-2 mt-8 mb-0"
                                hideReleasingBadge
                                showTrailer
                                type="anime"
                                overlay={<div className="flex flex-col w-fit absolute right-0 items-end">
                                    <div
                                        className="font-semibold text-white bg-gray-950 z-[1] pl-3 pr-[0.2rem] w-full py-1.5 text-center !tracking-wider !bg-opacity-80 rounded-none rounded-bl-lg"
                                    >{item?.media?.format === "MOVIE" ? "Movie" :
                                        <span className="tracking-wider"><span className="!text-lg">{item.episode}</span><span className="text-[--muted] tracking-wider !text-md">/{item.media?.episodes ?? "-"}</span></span>}</div>
                                    <div className="text-xs font-semibold z-[-1] w-fit h-fit pl-2 pr-[0.3rem] py-1 ml-2 text-center bg-gray-700 !bg-opacity-70 rounded-none rounded-bl-lg">
                                        {item.airingAt
                                            ? formatDistanceToNow(new Date(Number(item.airingAt)*1000), { addSuffix: true })
                                                ?.replace("less than a", "1")
                                                ?.replace("about ", "")
                                                ?.replace(" minutes", "m")
                                                ?.replace(" minute", "m")
                                                ?.replace(" hours", "h")
                                                ?.replace(" hour", "h")
                                                ?.replace(" days", "d")

                                            : undefined}
                                    </div>
                                </div>}
                            />
                        )
                    }) : [...Array(10).keys()].map((v, idx) => <MediaEntryCardSkeleton key={idx} />)}
                </CarouselContent>
            </Carousel>}
        </AppLayoutStack>
    )
}
