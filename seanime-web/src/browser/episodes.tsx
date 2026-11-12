import React from "react"
import Hls from "hls.js"
import { Anime_Entry } from "@/api/generated/types"
import { EpisodeGridItem } from "@/app/(main)/_features/anime/_components/episode-grid-item"
import { EpisodeListPaginatedGrid } from "@/app/(main)/entry/_components/episode-list-grid"
import { Button } from "@/components/ui/button"
import { installedSources, officialLinks } from "./sources"
export function BrowserEpisodes({entry}:{entry:Anime_Entry}){
 const m=entry.media!,rows=entry.episodes||[],[selected,setSelected]=React.useState(0),[audio,setAudio]=React.useState<"dub"|"sub">(()=>{try{return JSON.parse(localStorage.getItem("anidash.watch.web.v1")||"{}").preferences?.preferredAudio==="sub"?"sub":"dub"}catch{return "dub"}})
 const [sourceId,setSourceId]=React.useState(""),[error,setError]=React.useState(""),[revision,setRevision]=React.useState(0)
 const video=React.useRef<HTMLVideoElement>(null)
 React.useEffect(()=>{setSelected(0);setSourceId("");setError("")},[entry.mediaId])
 React.useEffect(()=>{const f=()=>setRevision(x=>x+1);window.addEventListener("anidash-sources",f);return()=>window.removeEventListener("anidash-sources",f)},[])
 const options=React.useMemo(()=>installedSources().flatMap(s=>s.episodes.filter(e=>e.mediaId===entry.mediaId&&e.episode===selected&&e.audio===audio).map(e=>({...e,id:s.id,name:s.name}))),[entry.mediaId,selected,audio,revision])
 const active=options.find(x=>x.id===sourceId)||options[0]
 React.useEffect(()=>{setError("");const el=video.current;if(!el||!active)return;let hls:Hls|undefined;if(/\.m3u8(?:$|\?)/i.test(active.url)&&Hls.isSupported()){hls=new Hls();hls.loadSource(active.url);hls.attachMedia(el);hls.on(Hls.Events.ERROR,(_,e)=>{if(e.fatal)setError("This source could not be played in the browser.")})}else el.src=active.url;return()=>{hls?.destroy();el.removeAttribute("src");el.load()}},[active?.url])
 const links=officialLinks(m)
 return <section className="space-y-6" data-anidash-browser-episodes>
 <div className="flex flex-wrap gap-3 items-center justify-between"><h2>Episodes {rows.length>0&&<span className="text-[--muted] text-sm">({rows.length})</span>}</h2><a href="/extensions" className="text-sm underline">Manage sources</a></div>
 {selected>0&&<div className="rounded-xl border bg-[--paper] p-4 space-y-4"><div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto">Episode {selected}</h3><Button intent={audio==="dub"?"white":"gray-outline"} onClick={()=>{setAudio("dub");setSourceId("")}}>DUB</Button><Button intent={audio==="sub"?"white":"gray-outline"} onClick={()=>{setAudio("sub");setSourceId("")}}>SUB</Button></div>
 {options.length>0?<><div className="flex flex-wrap gap-2">{options.map(x=><Button key={x.id} intent={active?.id===x.id?"white":"gray-outline"} onClick={()=>setSourceId(x.id)}>{x.name}</Button>)}</div><video ref={video} controls playsInline preload="metadata" className="w-full aspect-video bg-black rounded-lg" onError={()=>setError("Media unavailable or unsupported by this browser.")}/>{error&&<p role="alert">{error}</p>}</>:<div className="space-y-2"><p>No installed browser source provides this episode in {audio.toUpperCase()}.</p><a href="/extensions" className="underline">Install a compatible source</a>{links.length>0&&<div className="flex flex-wrap gap-2">{links.filter(x=>new RegExp("(?:episode|ep)\\s*"+selected+"(?:\\D|$)","i").test(x.title)).map((x,i)=><a key={i} href={x.url} target="_blank" rel="noopener noreferrer" className="border rounded-lg px-3 py-2">{x.site} · {x.title}</a>)}</div>}</div>}</div>}
 {rows.length?<EpisodeListPaginatedGrid length={rows.length} itemsPerPage={24} maxCol={3} renderItem={i=>{const e=rows[i];return <EpisodeGridItem key={e.episodeNumber} media={m} title={e.displayTitle} episodeNumber={e.episodeNumber} progressNumber={e.progressNumber} watchedProgress={entry.listData?.progress} image={e.episodeMetadata?.image||m.bannerImage||m.coverImage?.large} isSelected={selected===e.episodeNumber} onClick={()=>{setSelected(e.episodeNumber);setSourceId("")}} action={<Button size="sm" intent="gray-outline" onClick={()=>{setSelected(e.episodeNumber);setSourceId("")}}>Watch</Button>}/>}}/>:<p>No released episodes are listed by AniList yet.</p>}
 {links.length>0&&<div className="space-y-2"><h3>Official streaming links</h3><div className="flex flex-wrap gap-2">{[...new Map(links.map(x=>[x.site,x])).values()].map(x=><a key={x.site} className="rounded-lg border px-3 py-2" href={x.url} target="_blank" rel="noopener noreferrer">{x.site} ↗</a>)}</div></div>}
 </section>
}
