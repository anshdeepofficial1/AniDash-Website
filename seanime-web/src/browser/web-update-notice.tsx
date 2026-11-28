import React from "react"
import webRelease from "./web-release.json"
import { LuRefreshCw, LuX } from "react-icons/lu"

function isNewer(candidate:string,current:string){
 if(!/^\d+\.\d+\.\d+$/.test(candidate))return false
 const a=candidate.split(".").map(Number),b=current.split(".").map(Number)
 for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i]}
 return false
}
function playbackIsVisible(){
 if(document.visibilityState!=="visible"||document.fullscreenElement)return true
 const route=new URL(location.href)
 if(route.pathname.startsWith("/watch/")||route.pathname==="/onlinestream"||route.pathname==="/mediastream"||(route.pathname==="/entry"&&route.searchParams.has("episode")))return true
 return Array.from(document.querySelectorAll("video")).some(v=>!v.paused&&!v.ended&&v.getBoundingClientRect().height>0)
}
export function WebUpdateNotice(){
 const [available,setAvailable]=React.useState("")
 const [dismissed,setDismissed]=React.useState("")
 const [blocked,setBlocked]=React.useState(true)
 React.useEffect(()=>{
  let alive=true,checking=false
  async function check(){
   if(checking||document.visibilityState!=="visible")return
   checking=true
   try{const r=await fetch("/version.json",{cache:"no-store",signal:AbortSignal.timeout(10000)});if(!r.ok)return;const d=await r.json();if(alive&&typeof d.version==="string"&&isNewer(d.version,webRelease.version))setAvailable(d.version)}catch{}finally{checking=false}
  }
  function update(){setBlocked(playbackIsVisible())}
  function wake(){update();void check()}
  wake()
  const interval=window.setInterval(()=>void check(),60000)
  const guard=window.setInterval(update,500)
  window.addEventListener("focus",wake);document.addEventListener("visibilitychange",wake);document.addEventListener("fullscreenchange",update)
  return()=>{alive=false;clearInterval(interval);clearInterval(guard);window.removeEventListener("focus",wake);document.removeEventListener("visibilitychange",wake);document.removeEventListener("fullscreenchange",update)}
 },[])
 if(blocked||!available||dismissed===available)return null
 return <aside role="status" className="fixed inset-x-3 top-[max(1rem,env(safe-area-inset-top))] z-[200] mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-brand-500/40 bg-gray-950 p-4 text-white shadow-2xl">
  <LuRefreshCw className="size-5 shrink-0 text-brand-400" aria-hidden="true"/><div className="min-w-0 flex-1"><strong className="block text-sm">Website has been updated</strong><p className="text-xs text-gray-300">Refresh for the latest version (v{available}).</p></div>
  <button type="button" className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black" onClick={()=>location.reload()}>Refresh</button><button type="button" aria-label="Dismiss update notice" onClick={()=>setDismissed(available)} className="p-1"><LuX className="size-5"/></button>
 </aside>
}
