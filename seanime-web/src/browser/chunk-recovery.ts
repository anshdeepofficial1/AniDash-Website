const recoveryKey="anidash-chunk-recovery-v1"
export function isChunkLoadError(error:unknown):boolean {
 const value=error as {name?:string;message?:string}
 return value?.name==="ChunkLoadError"||/Loading (?:CSS )?chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String(value?.message||error||""))
}
export async function refreshCurrentBuild(force=false):Promise<boolean>{
 if(typeof window==="undefined")return false
 const url=new URL(window.location.href)
 // The URL also protects against automatic reload loops when sessionStorage is unavailable.
 if(!force&&url.searchParams.has("__ad_refresh"))return false
 try{const previous=Number(sessionStorage.getItem(recoveryKey)||0);if(!force&&Date.now()-previous<60000)return false;sessionStorage.setItem(recoveryKey,String(Date.now()))}catch{}
 try{
  if("serviceWorker" in navigator){
   const registrations=await navigator.serviceWorker.getRegistrations()
   await Promise.all(registrations.filter(r=>{try{const script=r.active?.scriptURL||r.waiting?.scriptURL||r.installing?.scriptURL;return !!script&&new URL(script).origin===location.origin&&new URL(script).pathname==="/sw.js"}catch{return false}}).map(r=>r.unregister()))
  }
  if("caches" in window){const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith("anidash-watch-shell-")).map(k=>caches.delete(k)))}
 }catch{}
 url.searchParams.set("__ad_refresh",String(Date.now()))
 window.location.replace(url.href)
 return true
}
export function clearRecoveryMarker(){try{const url=new URL(window.location.href);if(url.searchParams.has("__ad_refresh")){url.searchParams.delete("__ad_refresh");history.replaceState(history.state,"",url.href)}}catch{}}
