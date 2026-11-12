// SPDX-License-Identifier: GPL-3.0-only
// Data-only extension format; no arbitrary third-party executable code.
export type SourceEpisode={mediaId:number;episode:number;audio:"dub"|"sub";url:string}
export type BrowserSource={id:string;name:string;episodes:SourceEpisode[]}
const KEY="anidash.browser.sources.v1"
export const ANDROID_SOURCES=["AniKoto","AnimeKai","AnimeOnsen","AnimePahe","HiAnime","Kaido","AniZone","Gojo","JustAnime"] as const
export function installedSources():BrowserSource[]{try{const a=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(a)?a:[]}catch{return []}}
function https(raw:unknown){if(typeof raw!=="string")throw Error("Invalid media URL");const u=new URL(raw);if(u.protocol!=="https:"||u.username||u.password)throw Error("Only HTTPS media URLs without credentials are allowed");return u.href}
export function parseSource(raw:string):BrowserSource{
 const x=JSON.parse(raw);if(!x||x.version!==1||typeof x.id!=="string"||!/^[a-zA-Z0-9_-]{1,64}$/.test(x.id)||typeof x.name!=="string"||!x.name.trim()||x.name.length>100||!Array.isArray(x.episodes)||x.episodes.length>10000)throw Error("Invalid browser source manifest")
 const episodes=x.episodes.map((e:any)=>{if(!Number.isSafeInteger(e.mediaId)||e.mediaId<=0||!Number.isSafeInteger(e.episode)||e.episode<=0||!["dub","sub"].includes(e.audio))throw Error("Invalid episode record");return {mediaId:e.mediaId,episode:e.episode,audio:e.audio,url:https(e.url)}})
 if(!episodes.length)throw Error("Manifest contains no episodes")
 return {id:x.id,name:x.name.trim(),episodes}
}
export function installSource(source:BrowserSource){localStorage.setItem(KEY,JSON.stringify([...installedSources().filter(s=>s.id!==source.id),source]));window.dispatchEvent(new Event("anidash-sources"))}
export function removeSource(id:string){localStorage.setItem(KEY,JSON.stringify(installedSources().filter(s=>s.id!==id)));window.dispatchEvent(new Event("anidash-sources"))}
export function officialLinks(media:any):{title:string;site:string;url:string}[]{return (Array.isArray(media?.streamingEpisodes)?media.streamingEpisodes:[]).flatMap((e:any)=>{try{const url=https(e.url),h=new URL(url).hostname.toLowerCase();if(!["crunchyroll.com","netflix.com","hulu.com","hidive.com","amazon.com","primevideo.com","disneyplus.com","youtube.com","bilibili.tv","tubitv.com","retrocrush.tv"].some(d=>h===d||h.endsWith("."+d)))return [];return [{title:String(e.title||"Watch on provider"),site:String(e.site||h),url}]}catch{return []}})}
