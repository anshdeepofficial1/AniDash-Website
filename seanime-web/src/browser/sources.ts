// SPDX-License-Identifier: GPL-3.0-only
// Declarative, user-authorized sources only. Never execute repository code.
export type SourceEpisode={mediaId:number;episode:number;audio:"dub"|"sub";url:string;format?:"mp4"|"hls"}
export type SourceChapter={mediaId:number;chapter:number;title?:string;pages:string[]}
export type BrowserSource={id:string;name:string;episodes:SourceEpisode[];chapters?:SourceChapter[];enabled?:boolean}
const KEY="anidash.browser.sources.v1"
export const ANDROID_SOURCES=["AniKoto","AnimeKai","AnimeOnsen","AnimePahe","HiAnime","Kaido","AniZone","Gojo","JustAnime"] as const
export const ANDROID_MANGA_DEFAULTS=["MangaSee","Mangakakalot","MangaBat","AsuraScans"] as const
export function installedSources():BrowserSource[]{try{const a=JSON.parse(localStorage.getItem(KEY)||"[]");if(!Array.isArray(a))return [];return a.flatMap(x=>{try{return [{...parseSource(JSON.stringify({...x,version:2})),enabled:x.enabled!==false}]}catch{return []}})}catch{return []}}
function https(raw:unknown){if(typeof raw!=="string"||raw.length>8192)throw Error("Invalid media URL");const u=new URL(raw);if(u.protocol!=="https:"||u.username||u.password)throw Error("Only HTTPS media URLs without credentials are allowed");const h=u.hostname.toLowerCase().replace(/\.$/,"");if(h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local")||h.endsWith(".internal")||!h.includes(".")||/^\d+(\.\d+){3}$/.test(h)||h.startsWith("["))throw Error("Use a public HTTPS hostname");return u.href}
const positiveInt=(n:unknown)=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0
export function parseSource(raw:string):BrowserSource{
 const x=JSON.parse(raw);if(!x||![1,2].includes(x.version)||typeof x.id!=="string"||!/^[a-zA-Z0-9_-]{1,64}$/.test(x.id)||typeof x.name!=="string"||!x.name.trim()||x.name.length>100)throw Error("Invalid browser source manifest")
 const ep=x.episodes??[],ch=x.version===2?(x.chapters??[]):[];if(!Array.isArray(ep)||ep.length>10000||!Array.isArray(ch)||ch.length>2000)throw Error("Invalid source records")
 const episodes:SourceEpisode[]=ep.map((e:any)=>{if(!e||!positiveInt(e.mediaId)||!positiveInt(e.episode)||!["dub","sub"].includes(e.audio)||e.format!==undefined&&!["mp4","hls"].includes(e.format))throw Error("Invalid episode record");return {mediaId:e.mediaId,episode:e.episode,audio:e.audio,url:https(e.url),...(e.format?{format:e.format}:{})}})
 let pageCount=0;
 const chapters:SourceChapter[]=ch.map((e:any)=>{if(!e||!positiveInt(e.mediaId)||typeof e.chapter!=="number"||!Number.isFinite(e.chapter)||e.chapter<=0||e.chapter>100000||!Array.isArray(e.pages)||!e.pages.length||e.pages.length>300||e.title!==undefined&&(typeof e.title!=="string"||e.title.length>200))throw Error("Invalid chapter record");pageCount+=e.pages.length;if(pageCount>20000)throw Error("Too many page URLs");return {mediaId:e.mediaId,chapter:e.chapter,title:e.title,pages:e.pages.map(https)}})
 if(!episodes.length&&!chapters.length)throw Error("Manifest contains no media records")
 return {id:x.id,name:x.name.trim(),episodes,chapters}
}
function saveSources(sources:BrowserSource[]){localStorage.setItem(KEY,JSON.stringify(sources));window.dispatchEvent(new Event("anidash-sources"))}
export function installSource(source:BrowserSource){const prior=installedSources();saveSources([...prior.filter(s=>s.id!==source.id),{...source,enabled:prior.find(s=>s.id===source.id)?.enabled!==false}])}
export function removeSource(id:string){saveSources(installedSources().filter(s=>s.id!==id))}
export function setSourceEnabled(id:string,enabled:boolean){saveSources(installedSources().map(s=>s.id===id?{...s,enabled}:s))}
export function episodeSources(sources:BrowserSource[],mediaId:number,episode:number,audio:"dub"|"sub"){return sources.filter(s=>s.enabled!==false).flatMap(s=>s.episodes.filter(e=>e.mediaId===mediaId&&e.episode===episode&&e.audio===audio).map(e=>({...e,sourceId:s.id,sourceName:s.name})))}
export function chapterSources(sources:BrowserSource[],mediaId:number){return sources.filter(s=>s.enabled!==false).flatMap(s=>(s.chapters||[]).filter(e=>e.mediaId===mediaId).map(e=>({...e,sourceId:s.id,sourceName:s.name}))).sort((a,b)=>a.chapter-b.chapter)}
export function officialLinks(media:any):{title:string;site:string;url:string}[]{return (Array.isArray(media?.streamingEpisodes)?media.streamingEpisodes:[]).flatMap((e:any)=>{try{const url=https(e.url),h=new URL(url).hostname.toLowerCase();if(!["crunchyroll.com","netflix.com","hulu.com","hidive.com","amazon.com","primevideo.com","disneyplus.com","youtube.com","youtu.be","bilibili.tv","tubitv.com","retrocrush.tv"].some(d=>h===d||h.endsWith("."+d)))return [];return [{title:String(e.title||"Watch on provider"),site:String(e.site||h),url}]}catch{return []}})}

export function officialSeriesLinks(media:any):{title:string;site:string;url:string}[]{return officialLinks({streamingEpisodes:(Array.isArray(media?.externalLinks)?media.externalLinks:[]).filter((x:any)=>x.type==="STREAMING").map((x:any)=>({...x,title:"Open series on "+x.site}))})}
