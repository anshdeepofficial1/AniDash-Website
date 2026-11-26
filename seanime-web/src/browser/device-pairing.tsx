import React from "react"
import { browserPreferences, setBrowserPreference } from "@/browser/transport"

type Pair = {code:string;qr:string;expiresAt:string}
export function DevicePairing(){
 const [pair,setPair]=React.useState<Pair|null>(null),[message,setMessage]=React.useState(""),[busy,setBusy]=React.useState(false)
 const [left,setLeft]=React.useState(0)
 async function start(){
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
     setPair(null);setMessage("Device connected.")
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
 const prefs=browserPreferences()
 return <div className="space-y-3">
  <button type="button" disabled={busy||!!pair} className="block rounded-lg border px-4 py-3 hover:bg-[--subtle]" onClick={start}>{busy?"Creating code…":"Connect with AniDash"}</button>
  {pair&&<section className="rounded-xl border p-4 space-y-3" aria-label="Device pairing">
   <p>On AniDash Android, open Settings → Devices. Scan this QR or enter the code, then confirm this device.</p>
   <img width={280} height={280} className="max-w-full rounded-lg" src={pair.qr} alt="Scan this pairing QR in AniDash"/>
   <p>Manual pairing code</p><code className="block break-all select-all font-mono">{pair.code}</code>
   <button type="button" className="rounded-lg border px-3 py-2" onClick={()=>navigator.clipboard.writeText(pair.code).catch(()=>setMessage("Select and copy the displayed code."))}>Copy code</button>
   <p role="status">Waiting for approval · {Math.floor(left/60)}:{String(left%60).padStart(2,"0")} remaining</p>
   <button type="button" className="rounded-lg border px-3 py-2" onClick={()=>{setPair(null);setMessage("Pairing cancelled on this browser. The code expires automatically.")}}>Cancel</button>
  </section>}
  {message&&<p role="status">{message}</p>}
  {prefs.pairedSource&&<p className="text-sm text-[--muted]">Android source preference: {prefs.pairedSource}. Browser availability may differ; review the selected source in the player.</p>}
 </div>
}
