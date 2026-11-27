const KEY="anidash.watch.web.v1"
const account=()=> (window as any).AniDashAccount
const owner=()=>String(account()?.currentUser?.()?.id||"")
const QUEUE="anidash.position.queue.v1"
type Pending={owner:string;mediaId:number;episode:number;position:number;duration:number;ended:boolean;at:number;meta?:{lang:string;src?:string}}
function readQueue():Pending[]{try{const q=JSON.parse(localStorage.getItem(QUEUE)||"[]");return Array.isArray(q)?q:[]}catch{return []}}
function writeQueue(q:Pending[]){try{localStorage.setItem(QUEUE,JSON.stringify(q.slice(-100)))}catch{}}
export function parseManualPosition(value:string):number|null{const parts=value.trim().split(":");if(parts.length<1||parts.length>3||parts.some(x=>!/^\d{1,6}$/.test(x)))return null;const nums=parts.map(Number);if(nums.slice(1).some(n=>n>=60))return null;const total=nums.reduce((a,b)=>a*60+b,0);return total<=86400?total:null}
export function formatPosition(sec:number){const n=Math.max(0,Math.floor(sec));return Math.floor(n/60)+":"+String(n%60).padStart(2,"0")}

export function readWatchState(){try{return JSON.parse(localStorage.getItem(KEY)||"{}")}catch{return {}}}
export function saveWatchState(s:any){try{s.updatedAt=Date.now();localStorage.setItem(KEY,JSON.stringify(s));(window as any).AniDashStorage?.save(s).catch(()=>{});window.dispatchEvent(new Event("anidash-watch-progress"))}catch{}}
function released(m:any){return m.status==="NOT_YET_RELEASED"?0:m.format==="MOVIE"?1:m.status==="RELEASING"&&m.nextAiringEpisode?.episode?m.nextAiringEpisode.episode-1:m.episodes||0}
export function localResume(m:any){const h=readWatchState().history?.[m.id];if(!h||(h.owner&&h.owner!==owner()))return null;const done=h.ended===true||h.duration>0&&(h.position>=h.duration-30||h.position/h.duration>=0.97);const episode=Number(h.episode)+(done?1:0);if(released(m)&&episode>released(m))return null;return {media:m,episode,seconds:done?0:Number(h.position)||0,duration:done?0:Number(h.duration)||0,updatedAt:Number(h.updatedAt)||0,cloud:false}}
export function remoteResume(entry:any){const m=entry?.media;if(!m?.id||m.isAdult||!["CURRENT","REPEATING"].includes(entry.status))return null;const max=released(m);if(entry.progress>=max&&max>0)return null;const result=account()?.resumeFromEntry?.(entry,max);if(!result||result.episode<1)return null;return {...result,media:m,cloud:true,duration:result.seconds>0?result.duration:0}}
export function chooseResume(local:any,remote:any){if(!local)return remote;if(!remote)return local;return remote.updatedAt>=local.updatedAt?remote:local}
export async function browserContinueWatching(force=false){const s=readWatchState(),a=account();let remote:any[]=[];if(a?.authenticated?.())try{remote=await a.list(force)}catch{};const map=new Map<number,any>();for(const e of remote){const r=remoteResume(e);if(!r)continue;map.set(e.media.id,chooseResume(localResume(e.media),r))}
 for(const h of Object.values(s.history||{}) as any[]){if(!h?.media?.id||h.media.isAdult||map.has(h.media.id)||remote.some(e=>e.media?.id===h.media.id))continue;const r=localResume(h.media);if(r)map.set(h.media.id,r)}
 const hidden=s.continueHidden||{};return [...map.values()].filter(r=>{const h=hidden[r.media.id];return !(h&&h.episode===r.episode&&r.updatedAt<=h.at)}).sort((a,b)=>b.updatedAt-a.updatedAt)
}
export async function getEpisodeResume(m:any,episode:number){let local=localResume(m),remote=null;const a=account();if(a){try{if(!a.authenticated?.())await a.init();if(a.authenticated?.()){try{await a.list(true)}catch{}remote=remoteResume(a.getEntry(m.id))}}catch{}}const best=chooseResume(local,remote);return best?.episode===episode?best.seconds:0}
export function persistPlayback(m:any,episode:number,position:number,duration:number,ended=false){const s=readWatchState();const h={media:m,episode,position,duration,ended,owner:owner(),updatedAt:Date.now()};saveWatchState({...s,history:{...s.history,[m.id]:h},watchlist:{...s.watchlist,[m.id]:m},libraryStatuses:{...s.libraryStatuses,[m.id]:ended&&released(m)===episode&&m.status==="FINISHED"?"COMPLETED":"CURRENT"}});return h}
let flushing:Promise<boolean>|null=null
export async function flushPlaybackQueue():Promise<boolean>{
 if(flushing)return flushing
 const a=account(),user=owner();if(!a?.authenticated?.()||!user)return false
 const task=(async()=>{let ok=true;for(const item of readQueue().filter(x=>x.owner===user)){
   if(owner()!==user||!a.authenticated())return false
   try{const result=await a.syncPosition(item.mediaId,item.episode,item.position,item.duration,item.ended,item.at,item.meta);if(!result){ok=false;continue}
     writeQueue(readQueue().filter(x=>!(x.owner===user&&x.mediaId===item.mediaId&&x.at===item.at)))
   }catch{ok=false;break}
 }window.dispatchEvent(new Event("anidash-watch-progress"));return ok})()
 flushing=task;try{return await task}finally{if(flushing===task)flushing=null}
}
export async function syncPlayback(m:any,episode:number,position:number,duration:number,ended=false,meta?:{lang:string;src?:string}){
 const a=account(),user=owner();if(!a?.authenticated?.()||!user)return false
 const item:Pending={owner:user,mediaId:m.id,episode,position,duration,ended,at:Date.now(),...(meta?{meta}:{})}
 writeQueue([...readQueue().filter(x=>x.owner!==user||x.mediaId!==m.id),item])
 if(flushing)await flushing
 const ok=await flushPlaybackQueue()
 return ok&&!readQueue().some(x=>x.owner===user&&x.mediaId===m.id)
}

