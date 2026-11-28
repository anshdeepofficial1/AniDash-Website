import Hls from "hls.js"

type CachedResponse={response:any;stats:any;at:number;size:number}
const cache=new Map<string,CachedResponse>()
let bytes=0
const MAX_BYTES=20*1024*1024
const TTL=45000
function prune(){for(const [key,item] of cache){if(Date.now()-item.at>TTL||bytes>MAX_BYTES){bytes-=item.size;cache.delete(key)}}}
function keyFor(c:any){return [c.url,c.responseType,c.rangeStart??"",c.rangeEnd??""].join("|")}
const BaseLoader=Hls.DefaultConfig.loader as any
// Only the standby player writes to this bounded, short-lived memory cache.
export function episodeLoader(warm:boolean):any{
 return class extends BaseLoader{
  load(context:any,config:any,callbacks:any){
   prune()
   const key=keyFor(context),hit=cache.get(key)
   if(!warm&&hit){const data=hit.response.data;const response={...hit.response,data:data instanceof ArrayBuffer?data.slice(0):data};this.context=context;this.stats={...hit.stats,loading:{...hit.stats.loading},parsing:{...hit.stats.parsing},buffering:{...hit.stats.buffering}};this.cachedTimer=window.setTimeout(()=>callbacks.onSuccess(response,this.stats,context,null),0);return}
   super.load(context,config,{...callbacks,onSuccess:(response:any,stats:any,ctx:any,network:any)=>{
    if(warm){const data=response.data;const size=typeof data==="string"?data.length*2:data instanceof ArrayBuffer?data.byteLength:0;if(size&&size<=MAX_BYTES){const old=cache.get(key);if(old)bytes-=old.size;cache.set(key,{response:{...response,data:data instanceof ArrayBuffer?data.slice(0):data},stats:{...stats,loading:{...stats.loading},parsing:{...stats.parsing},buffering:{...stats.buffering}},at:Date.now(),size});bytes+=size;prune()}}
    callbacks.onSuccess(response,stats,ctx,network)
   }})
  }
  cachedTimer:number|undefined
  abort(){if(this.cachedTimer!==undefined)clearTimeout(this.cachedTimer);super.abort()}
  destroy(){if(this.cachedTimer!==undefined)clearTimeout(this.cachedTimer);super.destroy()}
 }
}
export function prepareEpisode(source:{url:string;isM3U8?:boolean;type?:string},signal:AbortSignal):Promise<boolean>{
 return new Promise(resolve=>{
  if(signal.aborted||source.type==="embed"){resolve(false);return}
  const el=document.createElement("video");el.muted=true;el.preload="auto";el.playsInline=true
  let hls:Hls|undefined,done=false
  const timer=window.setTimeout(()=>finish(false),12000)
  function finish(ok:boolean){if(done)return;done=true;clearTimeout(timer);signal.removeEventListener("abort",cancel);el.removeEventListener("canplay",ready);el.removeEventListener("error",fail);hls?.destroy();el.removeAttribute("src");el.load();el.remove();resolve(ok)}
  const ready=()=>finish(true),fail=()=>finish(false),cancel=()=>finish(false)
  signal.addEventListener("abort",cancel,{once:true});el.addEventListener("canplay",ready,{once:true});el.addEventListener("error",fail,{once:true})
  const isHls=source.isM3U8===true||/m3u8|mpegurl|hls/i.test(source.url+" "+(source.type||""))
  if(isHls&&Hls.isSupported()){hls=new Hls({loader:episodeLoader(true),maxBufferLength:8,maxMaxBufferLength:12,autoStartLoad:true});hls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal)finish(false)});hls.loadSource(source.url);hls.attachMedia(el)}
  else el.src=source.url
  el.load()
 })
}
