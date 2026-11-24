import { useUiLanguage } from "@/browser/ui-language"
import React from "react"
import { useQuery } from "@tanstack/react-query"
import { browserSchedule } from "@/browser/transport"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { SeaLink } from "@/components/shared/sea-link"
export default function Page(){
 const {t,language}=useUiLanguage()
 const [personal,setPersonal]=React.useState(false),[week,setWeek]=React.useState(0)
 const q=useQuery({queryKey:["anidash-schedule",personal,week],queryFn:()=>browserSchedule(personal,week),retry:1,staleTime:120000})
 const start=new Date();start.setHours(0,0,0,0);start.setDate(start.getDate()+week*7)
 const days=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return d})
 return <PageWrapper className="p-4 sm:p-8 space-y-6"><header><h1>{t("Release schedule")}</h1><p className="text-[--muted]">{t("Upcoming anime episodes in your local time. Dates are provided by AniList and may change.")}</p></header><div className="flex flex-wrap gap-2"><button className={"rounded-lg border px-4 py-2 "+(!personal?"bg-[--subtle]":"")} onClick={()=>setPersonal(false)}>{t("All releases")}</button><button className={"rounded-lg border px-4 py-2 "+(personal?"bg-[--subtle]":"")} onClick={()=>setPersonal(true)}>{t("My List")}</button><button className="rounded-lg border px-4 py-2 ml-auto" onClick={()=>setWeek(w=>w-1)}>{t("Previous week")}</button><button className="rounded-lg border px-4 py-2" onClick={()=>setWeek(0)}>{t("This week")}</button><button className="rounded-lg border px-4 py-2" onClick={()=>setWeek(w=>w+1)}>{t("Next week")}</button></div>
 {q.isPending?<p>{t("Loading release dates…")}</p>:q.isError?<div role="alert"><p>{(q.error as Error).message}</p><button className="border rounded-lg p-2" onClick={()=>q.refetch()}>{t("Try again")}</button></div>:<div className="space-y-5">{days.map(day=>{const rows=(q.data||[]).filter(a=>new Date(a.airingAt*1000).toDateString()===day.toDateString());return <section key={day.toISOString()} className="border rounded-xl p-4 space-y-3"><h2 className="text-lg font-semibold">{day.toLocaleDateString(language,{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</h2>{rows.length?<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map(a=><SeaLink key={a.id} href={"/entry?id="+a.media.id} className="flex gap-3 rounded-lg border p-3 hover:bg-[--subtle]"><img className="w-14 h-20 rounded object-cover" src={a.media.coverImage?.large} alt=""/><div><p className="font-semibold">{a.media.title?.english||a.media.title?.userPreferred||a.media.title?.romaji}</p><p className="text-sm text-[--muted]">{t("Episode")} {a.episode} · {new Date(a.airingAt*1000).toLocaleTimeString(language,{hour:"numeric",minute:"2-digit"})}</p></div></SeaLink>)}</div>:<p className="text-sm text-[--muted]">{t(personal?"No confirmed My List releases for this date.":"No confirmed releases for this date.")}</p>}</section>})}</div>}</PageWrapper>
}
