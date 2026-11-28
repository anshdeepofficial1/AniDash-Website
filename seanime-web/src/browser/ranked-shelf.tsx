import React from "react"
import { LuChevronRight, LuArrowLeft, LuPlay } from "react-icons/lu"
import { cardResume } from "./resume"
import { prefetchEpisodeMetadata } from "./episode-metadata-cache"
import { useRouter } from "@/lib/navigation"
import { SeaLink } from "@/components/shared/sea-link"
import { useQuery } from "@tanstack/react-query"
import { list, browserRecentReleases } from "./transport"
import { PageWrapper } from "@/components/shared/page-wrapper"

type RankedItem={media:any;detail?:string;episode?:number}
export function SectionArrow({section}:{section:"trending"|"recent"}){
 return <SeaLink href={"/discover?section="+section} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border hover:bg-[--subtle]" aria-label={section==="trending"?"See all trending anime":"See all recently added anime"}><LuChevronRight className="size-5"/></SeaLink>
}
export function releaseItems(rows:any[]):RankedItem[]{return rows.map(row=>({media:row.media,episode:row.episode,detail:"Episode "+row.episode+" · "+new Date(row.airingAt*1000).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true})}))}
export function RankedSection({section}:{section:"trending"|"recent"}){
 const router=useRouter()
 const title=section==="trending"?"Trending Right Now":"Recently Added"
 const q=useQuery({queryKey:["anidash-ranked-section",section],queryFn:async():Promise<RankedItem[]>=>section==="recent"?releaseItems(await browserRecentReleases()):((await list({perPage:50,sort:["TRENDING_DESC"],status:["RELEASING","FINISHED"]})).Page?.media||[]).slice(0,25).map((media:any)=>({media})),staleTime:120000,retry:1})
 return <PageWrapper className="mx-auto max-w-5xl p-4 sm:p-8 space-y-5"><header className="flex items-center gap-3"><button type="button" onClick={()=>router.back()} aria-label="Go back" className="grid size-10 place-items-center rounded-full border"><LuArrowLeft/></button><div><h1 className="text-2xl font-bold">{title}</h1><p className="text-sm text-[--muted]">{section==="recent"?"Latest episode per anime over the past seven calendar days":"Top trending anime ranked by AniList"}</p></div></header>
 {q.isPending?<p role="status">Loading anime…</p>:q.isError?<div role="alert">Unable to load anime. <button onClick={()=>q.refetch()} className="underline">Retry</button></div>:!q.data?.length?<p>No anime found.</p>:<div className="divide-y rounded-xl border bg-[--paper]">{q.data.map(({media:m,detail,episode},i)=>{
 const title=m.title?.english||m.title?.userPreferred||m.title?.romaji||"Anime"
 const color=i===0?"text-amber-400":i===1?"text-slate-300":i===2?"text-amber-700":"text-[--muted]"
 return <div key={m.id} className="flex items-center gap-3 p-3 sm:p-4"><span className={"w-10 shrink-0 text-center text-2xl font-bold tabular-nums "+color}>{String(i+1).padStart(2,"0")}</span><SeaLink href={"/entry?id="+m.id} className="flex min-w-0 flex-1 items-center gap-4" onPointerEnter={()=>prefetchEpisodeMetadata(m,cardResume(m)?.episode||episode||1)}><img src={m.coverImage?.large||m.coverImage?.medium} alt="" loading="lazy" className="h-24 w-16 shrink-0 rounded-lg object-cover"/><div className="min-w-0"><p className="line-clamp-2 font-semibold">{title}</p><p className="text-sm text-[--muted]">{detail||[m.format,m.seasonYear,m.meanScore?m.meanScore+"% score":null].filter(Boolean).join(" · ")}</p></div></SeaLink><button type="button" aria-label={"Play "+title} onClick={()=>router.push("/entry?id="+m.id+"&episode="+(cardResume(m)?.episode||episode||1))} className="grid size-10 shrink-0 place-items-center rounded-full border hover:bg-[--subtle]"><LuPlay className="size-5"/></button></div>
 })}</div>}</PageWrapper>
}
