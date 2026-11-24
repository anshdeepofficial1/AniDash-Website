// Playback telemetry only. No stream retrieval, authentication bypass, or player injection.
export type EmbedCheckpoint={position:number;duration:number;ended:boolean}
const supported=new Set(["https://megaplay.buzz","https://megavid.buzz","https://anixo.buzz"])
export function embedProgressOrigin(url:string){try{const origin=new URL(url).origin;return supported.has(origin)?origin:null}catch{return null}}
export function readEmbedCheckpoint(origin:string,raw:unknown,previous:EmbedCheckpoint|null=null):EmbedCheckpoint|null{
 if(!supported.has(origin))return null
 let d:any=raw;if(typeof raw==="string"){if(raw.length>4096)return null;try{d=JSON.parse(raw)}catch{return null}}
 if(!d||typeof d!=="object"||Array.isArray(d))return null
 const anixo=origin==="https://anixo.buzz"
 const channel=origin==="https://megaplay.buzz"?"megacloud":"kisskh"
 const log=!anixo&&d.type==="watching-log"
 const time=anixo?["aniembed:timeupdate","aniembed:pause","aniembed:play"].includes(d.type):d.channel===channel&&d.event==="time"
 const ended=anixo?d.type==="aniembed:ended":d.channel===channel&&d.event==="complete"
 if(!log&&!time&&!ended)return null
 const duration=typeof d.duration==="number"?d.duration:ended?previous?.duration:undefined
 const position=typeof d.currentTime==="number"?d.currentTime:typeof d.time==="number"?d.time:ended?previous?.position:undefined
 if(typeof duration!=="number"||typeof position!=="number"||!Number.isFinite(duration)||!Number.isFinite(position)||duration<=0||duration>86400||position<0||position>duration+2)return null
 // Do not turn an isolated premature completion message into a completed episode.
 if(ended&&duration-position>30)return null
 return {position:ended?duration:Math.min(position,duration),duration,ended}
}
