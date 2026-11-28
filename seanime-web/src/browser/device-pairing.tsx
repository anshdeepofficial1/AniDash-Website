import React from "react"
import { LuCheck, LuSmartphone, LuQrCode, LuMonitor, LuRefreshCw, LuCopy, LuShieldCheck, LuLogOut } from "react-icons/lu"
import { browserPreferences, setBrowserPreference } from "@/browser/transport"

type Pair = {code:string;qr:string;expiresAt:string}
export function DevicePairing(){
 const [pair,setPair]=React.useState<Pair|null>(null),[message,setMessage]=React.useState(""),[busy,setBusy]=React.useState(false)
 const [left,setLeft]=React.useState(0)
 const [connection,setConnection]=React.useState<"checking"|"connected"|"disconnected"|"unavailable">("checking")
 const verify=React.useCallback(async()=>{try{const r=await fetch("/api/device-pair/account",{cache:"no-store"});if(r.status===401){setConnection("disconnected");return}if(!r.ok)throw Error("Session unavailable");const data=await r.json();setConnection(data.success===true?"connected":"disconnected")}catch{setConnection("unavailable")}},[])
 React.useEffect(()=>{void verify();window.addEventListener("focus",verify);return()=>window.removeEventListener("focus",verify)},[verify])
 async function start(){
  if(connection!=="disconnected")return
  setBusy(true);setMessage("");setPair(null)
  try{
   const r=await fetch("/api/device-pair/create",{method:"POST",cache:"no-store"})
   const p=await r.json();if(!r.ok)throw Error(p.error||"Unable to create pairing")
   setPair(p);setLeft(300)
  }catch(e){setMessage((e as Error).message)}finally{setBusy(false)}
 }
 React.useEffect(()=>{
  if(!pair)return
  let stop=false,timer:number|undefined
  const clock=window.setInterval(()=>setLeft(Math.max(0,Math.ceil((Date.parse(pair.expiresAt)-Date.now())/1000))),1000)
  async function poll(){
   if(stop||!pair)return
   if(Date.now()>=Date.parse(pair.expiresAt)){setPair(null);setMessage("Code expired. Generate a new code.");return}
   let delay=2500
   try{
    const r=await fetch("/api/device-pair/status?code="+encodeURIComponent(pair.code),{cache:"no-store"})
    if(stop)return
    if(r.status===200){
     setPair(null);setConnection("connected");setMessage("Device connected.")
     const account=await fetch("/api/device-pair/account",{cache:"no-store"})
     if(!account.ok){setMessage("Connection established, but account settings could not be loaded. Reload to continue.");return}
     const a=await account.json(),p=a.sync?.preferences||{},player=p.player||{}
     if(["sub","dub","hindi"].includes(player.preferredAudioLanguage))setBrowserPreference("preferredAudio",player.preferredAudioLanguage)
     if(typeof player.autoEnableSubtitles==="boolean")setBrowserPreference("playerSubtitles",player.autoEnableSubtitles)
     if(player.defaultQuality)setBrowserPreference("pairedQuality",player.defaultQuality)
     if(player.subtitleLanguage)setBrowserPreference("pairedSubtitleLanguage",player.subtitleLanguage)
     setBrowserPreference("pairedSource",p.nativeSource||null)
     setBrowserPreference("pairedSourceKind",p.playbackSourceKind||null)
     setBrowserPreference("pairedHindiSource",p.hindiSource||null)
     setBrowserPreference("pairedHindiEnabled",p.hindiSourceEnabled===true)
     location.reload();return
    }
    if(r.status===410||r.status===403||r.status===400){setPair(null);setMessage("Pairing expired, was denied, or is no longer valid.");return}
    if(r.status===429)delay=10000
   }catch{delay=5000}
   if(!stop)timer=window.setTimeout(poll,delay)
  }
  void poll()
  return()=>{stop=true;clearInterval(clock);if(timer)clearTimeout(timer)}
 },[pair])
 const disconnected=React.useCallback(()=>setConnection("disconnected"),[])
 const prefs=browserPreferences()
 return <div className="space-y-3">
  <div className="rounded-2xl border bg-[--subtle]/40 p-4 sm:p-5">
   <div className="flex flex-wrap items-center gap-3">
    <div className={"flex size-12 shrink-0 items-center justify-center rounded-xl "+(connection==="connected"?"bg-emerald-500/15 text-emerald-400":"bg-[--brand]/15 text-[--brand]")}><LuSmartphone size={23}/></div>
    <div className="min-w-0 flex-1"><div className="font-semibold">{connection==="connected"?"Connected from AniDash":"AniDash Android"}</div><p className="mt-1 text-sm text-[--muted]">{connection==="connected"?"This browser is securely paired with your AniDash account.":connection==="checking"?"Checking your connection…":connection==="unavailable"?"Unable to check the pairing service.":"Link this browser to your Android app and sync your account."}</p></div>
    {connection==="connected"?<span role="status" className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-400"><LuCheck/> Connected</span>:connection==="disconnected"?<button type="button" disabled={busy||!!pair} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[--brand] px-4 py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50 sm:w-auto" onClick={start}><LuQrCode/>{busy?"Creating code…":"Connect from AniDash"}</button>:connection==="unavailable"?<button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2 font-medium hover:bg-[--subtle]" onClick={()=>void verify()}><LuRefreshCw/> Retry</button>:null}
   </div>
  </div>
  {pair&&<section className="space-y-4 rounded-2xl border p-4 sm:p-5" aria-label="Device pairing">
   <p>On AniDash Android, open Settings → Devices. Scan this QR or enter the code, then confirm this device.</p>
   <img width={280} height={280} className="mx-auto max-w-full rounded-xl bg-white p-2" src={pair.qr} alt="Scan this pairing QR in AniDash"/>
   <p>Manual pairing code</p><code className="block select-all break-all rounded-xl bg-[--subtle] p-3 font-mono text-sm">{pair.code}</code>
   <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2 font-medium hover:bg-[--subtle]" onClick={()=>navigator.clipboard.writeText(pair.code).catch(()=>setMessage("Select and copy the displayed code."))}><LuCopy/> Copy code</button>
   <p role="status">Waiting for approval · {Math.floor(left/60)}:{String(left%60).padStart(2,"0")} remaining</p>
   <button type="button" className="rounded-lg border px-3 py-2" onClick={()=>{setPair(null);setMessage("Pairing cancelled on this browser. The code expires automatically.")}}>Cancel</button>
  </section>}
  {message&&<p role="status">{message}</p>}
  {connection==="connected"&&<Devices onDisconnected={disconnected}/> }
  {connection==="connected"&&prefs.pairedSource&&<p className="text-sm text-[--muted]">Android source preference: {prefs.pairedSource}. Browser availability may differ; review the selected source in the player.</p>}
 </div>
}

type PairedDevice = {id:string;name:string;browser:string;os:string;location?:string;pairedAt:string;lastActiveAt:string;sessionExpiresAt:string;current:boolean}
function friendlyTime(iso:string,now:number){
 const minutes=Math.max(0,Math.floor((now-Date.parse(iso))/60000))
 return minutes<1?"Just now":minutes<60?minutes+" min ago":minutes<1440?Math.floor(minutes/60)+" hr ago":Math.floor(minutes/1440)+" days ago"
}
function Devices({onDisconnected}:{onDisconnected:()=>void}){
 const [devices,setDevices]=React.useState<PairedDevice[]|null>(null),[error,setError]=React.useState(""),[loading,setLoading]=React.useState(false)
 const [pending,setPending]=React.useState<string|null>(null),[confirm,setConfirm]=React.useState<PairedDevice|null>(null),[now,setNow]=React.useState(Date.now())
 const load=React.useCallback(async()=>{
  setLoading(true);setError("")
  try{
   const r=await fetch("/api/device-pair/devices",{cache:"no-store"})
   if(r.status===401){setDevices(null);onDisconnected();if(r.headers.get("X-AniDash-Paired-Session")==="ended")location.replace("/settings?tab=profile");return}
   if(!r.ok)throw Error("Unable to load connected devices. Try again.")
   const body=await r.json();setDevices(Array.isArray(body.devices)?body.devices:[]);setNow(Date.now())
  }catch(e){setError((e as Error).message)}finally{setLoading(false)}
 },[onDisconnected])
 React.useEffect(()=>{void load();const clock=window.setInterval(()=>setNow(Date.now()),60000);const refresh=window.setInterval(()=>{if(document.visibilityState==="visible")void load()},300000);return()=>{clearInterval(clock);clearInterval(refresh)}},[load])
 async function revoke(d:PairedDevice){
  setPending(d.id);setConfirm(null);setError("")
  try{
   const r=await fetch("/api/device-pair/devices/"+encodeURIComponent(d.id),{method:"DELETE",cache:"no-store"})
   if(!r.ok&&r.status!==404)throw Error("Unable to revoke device. Try again.")
   if(d.current){location.replace("/settings?tab=profile");return}
   await load()
  }catch(e){setError((e as Error).message)}finally{setPending(null)}
 }
 if(devices===null&&!error&&!loading)return null
 return <section aria-label="Devices" className="space-y-4 rounded-2xl border p-4 sm:p-5">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="flex items-center gap-2 text-lg font-semibold"><LuShieldCheck className="text-[--brand]"/> Devices {devices&&<span className="text-sm font-normal text-[--muted]">({devices.length})</span>}</h3><p className="text-sm text-[--muted]">Manage browsers connected through AniDash.</p></div><button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium hover:bg-[--subtle]" disabled={loading} onClick={()=>void load()}><LuRefreshCw className={loading?"animate-spin":""}/>{loading?"Refreshing…":"Refresh"}</button></div>
  {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
  {devices?.length===0&&<p className="text-sm text-[--muted]">No active paired devices.</p>}
  {devices?.map(d=><article key={d.id} className="space-y-3 rounded-xl border bg-[--subtle]/30 p-4">
   <div className="flex flex-wrap items-center gap-2"><LuMonitor className="shrink-0 text-[--muted]" size={21}/><strong className="break-words">{d.name}</strong>{d.current&&<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-400">Current device</span>}</div>
   <p className="text-sm text-[--muted]">{d.browser} · {d.os}{d.location?" · "+d.location:""}</p>
   <dl className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-2"><div><dt className="text-[--muted]">Connected</dt><dd>{new Date(d.pairedAt).toLocaleString()}</dd></div><div><dt className="text-[--muted]">Last active · {friendlyTime(d.lastActiveAt,now)}</dt><dd>{new Date(d.lastActiveAt).toLocaleString()}</dd></div><div><dt className="text-[--muted]">Session {Date.parse(d.sessionExpiresAt)<=now?"expired":"expires"}</dt><dd>{new Date(d.sessionExpiresAt).toLocaleString()}</dd></div></dl>
   <button type="button" disabled={pending!==null} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/10" onClick={()=>setConfirm(d)}><LuLogOut/>{pending===d.id?"Revoking…":"Revoke"}</button>
  </article>)}
  {confirm&&<div role="alertdialog" aria-label="Confirm device revocation" className="rounded-lg border p-3 space-y-3"><p>Revoke {confirm.name}? {confirm.current?"You will be signed out of this browser.":"This browser will lose access immediately."}</p><div className="flex flex-wrap gap-2"><button type="button" className="rounded-lg border px-3 py-2" onClick={()=>setConfirm(null)}>Cancel</button><button type="button" className="rounded-lg border border-red-500/40 px-3 py-2 text-red-400" onClick={()=>void revoke(confirm)}>Confirm revoke</button></div></div>}
 </section>
}
