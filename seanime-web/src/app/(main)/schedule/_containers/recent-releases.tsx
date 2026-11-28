import React from "react"
import { useQuery } from "@tanstack/react-query"
import { browserRecentReleases } from "@/browser/transport"
import { SectionArrow } from "@/browser/ranked-shelf"
import { MediaEntryCard } from "@/app/(main)/_features/media/_components/media-entry-card"
import { MediaEntryCardSkeleton } from "@/app/(main)/_features/media/_components/media-entry-card-skeleton"
import { AppLayoutStack } from "@/components/ui/app-layout"
import { Carousel, CarouselContent } from "@/components/ui/carousel"
import { formatDistanceToNow } from "date-fns"

export function RecentReleases(){
 const q=useQuery({queryKey:["anidash-recent-week"],queryFn:browserRecentReleases,staleTime:120000,retry:1})
 const aired=q.data||[]
 return <AppLayoutStack className="pb-6">
  <div className="flex items-center gap-2"><h2>Recently Added</h2><SectionArrow section="recent"/></div>
  <p className="text-xs text-[--muted]">Past 7 days · latest episode per anime</p>
  {q.isError?<div role="alert" className="text-sm">Unable to load recent releases. <button className="underline" onClick={()=>q.refetch()}>Retry</button></div>:!aired.length&&!q.isPending?<p className="text-sm text-[--muted]">No releases found this week.</p>:<Carousel className="w-full max-w-full" gap="md" opts={{align:"start",dragFree:true}}>
   <CarouselContent className="px-6">
    {q.isPending?Array.from({length:8},(_,i)=><MediaEntryCardSkeleton key={i}/>):aired.slice(0,25).map(item=><MediaEntryCard key={item.media.id} media={item.media} type="anime" showLibraryBadge hideReleasingBadge showTrailer containerClassName="basis-[200px] md:basis-[250px] mx-2 mt-8 mb-0" overlay={<div className="absolute right-0 top-0 flex flex-col items-end"><span className="rounded-bl-lg bg-black/80 px-3 py-1 text-sm font-semibold text-white">{item.media.format==="MOVIE"?"Movie":"Ep "+item.episode}</span><span className="rounded-bl-lg bg-black/70 px-2 py-1 text-xs text-white">{formatDistanceToNow(new Date(item.airingAt*1000),{addSuffix:true})}</span></div>}/>)}
   </CarouselContent>
  </Carousel>}
 </AppLayoutStack>
}
