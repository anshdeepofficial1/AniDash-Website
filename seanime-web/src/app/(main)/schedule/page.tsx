import React from "react"
import { useQuery } from "@tanstack/react-query"
import { LuChevronLeft, LuChevronRight, LuCalendarDays, LuClock } from "react-icons/lu"
import { browserScheduleRange } from "@/browser/transport"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { SeaLink } from "@/components/shared/sea-link"

const dateKey=(d:Date)=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")
const firstDay=(d:Date)=>new Date(d.getFullYear(),d.getMonth(),1)
export default function Page(){
 const [personal,setPersonal]=React.useState(false)
 const [month,setMonth]=React.useState(()=>firstDay(new Date()))
 const [selected,setSelected]=React.useState(()=>new Date())
 const end=new Date(month.getFullYear(),month.getMonth()+1,1)
 const q=useQuery({queryKey:["anidash-calendar",personal,dateKey(month)],queryFn:()=>browserScheduleRange(month,end,personal),retry:1,staleTime:120000})
 const byDay=React.useMemo(()=>{const grouped=new Map<string,any[]>();for(const row of q.data||[]){const key=dateKey(new Date(row.airingAt*1000));grouped.set(key,[...(grouped.get(key)||[]),row])}for(const rows of grouped.values())rows.sort((a,b)=>a.airingAt-b.airingAt);return grouped},[q.data])
 const days=Array.from({length:Math.ceil((month.getDay()+new Date(month.getFullYear(),month.getMonth()+1,0).getDate())/7)*7},(_,i)=>new Date(month.getFullYear(),month.getMonth(),1-month.getDay()+i))
 const today=dateKey(new Date()),chosen=dateKey(selected),rows=byDay.get(chosen)||[]
 function move(offset:number){const next=new Date(month.getFullYear(),month.getMonth()+offset,1);setMonth(next);const now=new Date();setSelected(next.getFullYear()===now.getFullYear()&&next.getMonth()===now.getMonth()?now:next)}
 function select(d:Date){setSelected(d);if(d.getMonth()!==month.getMonth()||d.getFullYear()!==month.getFullYear())setMonth(firstDay(d))}
 return <PageWrapper className="mx-auto max-w-6xl p-4 sm:p-8 space-y-5">
 <header><h1 className="flex items-center gap-3 text-2xl font-bold sm:text-3xl"><LuCalendarDays/>Release Schedule</h1><p className="mt-1 text-sm text-[--muted]">Select any date to see anime release times in your local time zone.</p></header>
 <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={!personal} onClick={()=>setPersonal(false)} className={"rounded-full border px-4 py-2 text-sm "+(!personal?"bg-white text-black":"")}>All releases</button><button type="button" aria-pressed={personal} onClick={()=>setPersonal(true)} className={"rounded-full border px-4 py-2 text-sm "+(personal?"bg-white text-black":"")}>My List</button></div>
 <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
 <section className="h-fit rounded-2xl border bg-[--paper] p-3 sm:p-5">
 <div className="mb-4 flex items-center justify-between gap-2"><button type="button" aria-label="Previous month" onClick={()=>move(-1)} className="grid size-9 place-items-center rounded-full border"><LuChevronLeft/></button><h2 className="font-semibold">{month.toLocaleDateString(undefined,{month:"long",year:"numeric"})}</h2><button type="button" aria-label="Next month" onClick={()=>move(1)} className="grid size-9 place-items-center rounded-full border"><LuChevronRight/></button></div>
 <div className="grid grid-cols-7 gap-1 text-center text-xs text-[--muted]">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><span key={d} className="py-2">{d}</span>)}{days.map(d=>{const key=dateKey(d),active=key===chosen,count=byDay.get(key)?.length||0,inMonth=d.getMonth()===month.getMonth();return <button type="button" key={key} aria-label={d.toLocaleDateString(undefined,{dateStyle:"full"})+(count?", "+count+" releases":"")} aria-pressed={active} aria-current={key===today?"date":undefined} onClick={()=>select(d)} className={"relative flex min-h-12 flex-col items-center justify-center rounded-lg border text-sm transition sm:min-h-16 "+(active?"border-white bg-white text-black font-bold":key===today?"border-brand-500 text-brand-400":inMonth?"border-transparent hover:bg-[--subtle]":"border-transparent opacity-40 hover:bg-[--subtle]")}><span>{d.getDate()}</span><span className="h-4 text-[10px] leading-4">{count>0?count+" ep":""}</span></button>})}</div>
 <button type="button" onClick={()=>{const d=new Date();setMonth(firstDay(d));setSelected(d)}} className="mt-4 w-full rounded-lg border py-2 text-sm hover:bg-[--subtle]">Today</button>
 </section>
 <section className="min-w-0 rounded-2xl border bg-[--paper] p-3 sm:p-5"><h2 className="text-lg font-semibold">{selected.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</h2><p className="mb-4 mt-1 text-sm text-[--muted]">{q.isPending?"Loading release times…":rows.length+" scheduled releases"}</p>
 {q.isError?<div role="alert" className="text-sm">Unable to load the schedule. <button type="button" onClick={()=>q.refetch()} className="underline">Try again</button></div>:q.isPending?<p role="status" className="py-6 text-sm text-[--muted]">Fetching anime schedule…</p>:rows.length===0?<p className="py-6 text-sm text-[--muted]">No confirmed releases for this date.</p>:<div className="divide-y">{rows.map(a=><SeaLink key={a.id} href={"/entry?id="+a.media.id} className="flex items-center gap-3 py-3 hover:bg-[--subtle]"><div className="flex w-[72px] shrink-0 flex-col gap-1 text-xs font-semibold"><LuClock className="size-4 text-[--muted]"/>{new Date(a.airingAt*1000).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})}</div><img src={a.media.coverImage?.large||a.media.coverImage?.medium} alt="" className="h-20 w-14 shrink-0 rounded-md object-cover" loading="lazy"/><div className="min-w-0"><p className="line-clamp-2 font-semibold">{a.media.title?.english||a.media.title?.userPreferred||a.media.title?.romaji||"Anime"}</p><p className="text-xs text-[--muted]">Episode {a.episode}</p></div></SeaLink>)}</div>}
 </section></div><p className="text-xs text-[--muted]">Release dates are provided by AniList and may change. All times are shown in your local time zone.</p></PageWrapper>
}
