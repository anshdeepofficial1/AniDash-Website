import { pairedMalEntries } from "./transport"
const KEY="anidash.watch.web.v1"
const account=()=> (window as any).AniDashAccount
export function readWatchState(){try{return JSON.parse(localStorage.getItem(KEY)||"{}")}catch{return {}}}
export function saveWatchState(s:any){try{s.updatedAt=Date.now();localStorage.setItem(KEY,JSON.stringify(s));(window as any).AniDashStorage?.save(s).catch(()=>{});window.dispatchEvent(new Event("anidash-watch-progress"))}catch{}}
function released(m:any){return m.status==="NOT_YET_RELEASED"?0:m.format==="MOVIE"?1:m.status==="RELEASING"&&m.nextAiringEpisode?.episode?m.nextAiringEpisode.episode-1:m.episodes||0}
export function localResume(m:any){const h=readWatchState().history?.[m.id];if(!h)return null;const done=h.ended===true||h.duration>0&&(h.position>=h.duration-30||h.position/h.duration>=0.97);const episode=Number(h.episode)+(done?1:0);if(released(m)&&episode>released(m))return null;return {media:m,episode,seconds:done?0:Number(h.position)||0,duration:done?0:Number(h.duration)||0,updatedAt:Number(h.updatedAt)||0,cloud:false}}
export function remoteResume(entry:any){const m=entry?.media;if(!m?.id||m.isAdult||!["CURRENT","REPEATING"].includes(entry.status))return null;const max=released(m);if(entry.progress>=max&&max>0)return null;const result=account()?.authenticated?.()?account()?.resumeFromEntry?.(entry,max):{episode:Number(entry.progress||0)+1,seconds:0,duration:0,updatedAt:Number(entry.updatedAt||0)*1000};if(!result||result.episode<1)return null;return {...result,media:m,cloud:true,duration:result.seconds>0?result.duration:0}}
export function chooseResume(local:any,remote:any){if(!local)return remote;if(!remote)return local;if(remote.episode>local.episode)return remote;if(local.episode>remote.episode)return local;return remote.updatedAt>=local.updatedAt?remote:local}
export async function browserContinueWatching(force=false){const s=readWatchState(),a=account();let remote:any[]=[];if(a?.authenticated?.())remote=await a.list(force);else try{remote=await pairedMalEntries()}catch{};const map=new Map<number,any>();for(const e of remote){const r=remoteResume(e);if(!r)continue;map.set(e.media.id,chooseResume(localResume(e.media),r))}
 for(const h of Object.values(s.history||{}) as any[]){if(!h?.media?.id||h.media.isAdult||map.has(h.media.id)||remote.some(e=>e.media?.id===h.media.id))continue;const r=localResume(h.media);if(r)map.set(h.media.id,r)}
 const hidden=s.continueHidden||{};return [...map.values()].filter(r=>{const h=hidden[r.media.id];return !(h&&h.episode===r.episode&&r.updatedAt<=h.at)}).sort((a,b)=>b.updatedAt-a.updatedAt)
}
export async function getEpisodeResume(m:any,episode:number){let local=localResume(m),remote=null;const a=account();if(a){try{if(!a.authenticated?.())await a.init();if(a.authenticated?.()){try{await a.list(true)}catch{}remote=remoteResume(a.getEntry(m.id))}}catch{}}const best=chooseResume(local,remote);return best?.episode===episode?best.seconds:0}
export function persistPlayback(m:any,episode:number,position:number,duration:number,ended=false){const s=readWatchState();const h={media:m,episode,position,duration,ended,updatedAt:Date.now()};saveWatchState({...s,history:{...s.history,[m.id]:h},watchlist:{...s.watchlist,[m.id]:m},libraryStatuses:{...s.libraryStatuses,[m.id]:ended&&released(m)===episode&&m.status==="FINISHED"?"COMPLETED":"CURRENT"}});return h}
// Keep writes in playback order, including forced end-of-episode saves.
const pendingSync = new Map<number, Promise<boolean>>()
export function syncPlayback(m:any,episode:number,position:number,duration:number,ended=false):Promise<boolean>{
 const id=Number(m.id)
 const prior=pendingSync.get(id)||Promise.resolve(false)
 const task=prior.catch(()=>false).then(async()=>{
  const a=account(),mal=(window as any).AniDashMal
  const writes:Promise<boolean>[]=[]
  if(a?.authenticated?.())writes.push((async()=>{const result=await a.syncPosition(id,episode,position,duration,ended);if(!result)throw Error("AniList did not confirm playback progress");return true})())
  if(m.idMal&&mal?.authenticated?.())writes.push((async()=>{await mal.list();const existing=mal.getEntry(m.idMal)?.list_status;const progress=Math.max(Number(existing?.num_episodes_watched)||0,ended?episode:episode-1);const result=await mal.updateProgress(m.idMal,progress,progress>=released(m)&&m.status==="FINISHED"?"completed":"watching");if(!result)throw Error("MyAnimeList did not confirm playback progress");return true})())
  const results=await Promise.allSettled(writes)
  const synced=results.some(r=>r.status==="fulfilled"&&r.value)
  if(synced)window.dispatchEvent(new Event("anidash-watch-progress"))
  if(results.some(r=>r.status==="rejected"))throw Error("One or more tracker updates failed")
  return synced
 }).finally(()=>{if(pendingSync.get(id)===task)pendingSync.delete(id)})
 pendingSync.set(id,task)
 return task
}

/** Resolve the same episode used by Continue Watching, from local and loaded tracker state. */
export function cardResume(m:any, progress=0, status?:string){
 const a=account()
 const remote=a?.authenticated?.()?remoteResume(a.getEntry?.(m.id)):null
 const local=localResume(m)
 const best=chooseResume(local,remote)
 if(best)return best
 if(["CURRENT","PAUSED","REPEATING"].includes(status||"")&&(!released(m)||progress<released(m)))return {episode:Math.max(1,progress+1),seconds:0,duration:0,updatedAt:0,media:m,cloud:false}
 return null
}
