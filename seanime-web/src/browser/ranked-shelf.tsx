import React from "react"
import { LuChevronDown, LuChevronRight, LuPlay } from "react-icons/lu"
import { cardResume } from "./resume"
import { prefetchEpisodeMetadata } from "./episode-metadata-cache"
import { useRouter } from "@/lib/navigation"
export function RankedShelf({items,label}:{items:{media:any;detail?:string;episode?:number}[];label:string}){
 const [expanded,setExpanded]=React.useState(false)
 const router=useRouter()
 if(!items.length)return null
 return <div className="mb-3 rounded-xl border bg-[--paper]"><button type="button" onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left font-semibold"><span>{expanded?"Hide":"View"} {label.toLowerCase()} ranking <span className="ml-1 text-xs text-[--muted]">{items.length} titles</span></span>{expanded?<LuChevronDown/>:<LuChevronRight/>}</button>{expanded&&<div className="divide-y border-t">{items.map(({media:m,detail,episode},i)=>{
 const title=m.title?.english||m.title?.userPreferred||m.title?.romaji||"Anime"
 const color=i===0?"text-amber-400":i===1?"text-slate-300":i===2?"text-orange-700":"text-[--muted]"
 return <div key={m.id} className="flex items-center gap-3 px-3 py-2 sm:px-4"><span className={"w-9 shrink-0 text-center text-xl font-bold tabular-nums "+color}>{String(i+1).padStart(2,"0")}</span><a href={"/entry?id="+m.id} className="flex min-w-0 flex-1 items-center gap-3" onPointerEnter={()=>prefetchEpisodeMetadata(m,cardResume(m)?.episode||episode||1)}><img src={m.coverImage?.large||m.coverImage?.medium} alt="" loading="lazy" className="h-16 w-11 shrink-0 rounded-md object-cover"/><div className="min-w-0"><p className="line-clamp-2 font-semibold">{title}</p><p className="text-xs text-[--muted]">{detail||[m.format,m.seasonYear,m.meanScore?m.meanScore+"% score":null].filter(Boolean).join(" · ")}</p></div></a><button type="button" aria-label={"Play "+title} onClick={()=>router.push("/entry?id="+m.id+"&episode="+(cardResume(m)?.episode||episode||1))} className="grid size-9 shrink-0 place-items-center rounded-full border hover:bg-[--subtle]"><LuPlay className="size-4"/></button></div>
 })}</div>}</div>
}
