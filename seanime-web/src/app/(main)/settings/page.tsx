import React from "react"
import { DevicePairing } from "@/browser/device-pairing"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { browserPreferences, setBrowserPreference, list } from "@/browser/transport"
import { installedSources } from "@/browser/sources"

const repo = "https://github.com/anshdeepofficial1/AniDash-Website"
const android = "https://github.com/anshdeepofficial1/AniDash/releases/latest"
const account = () => (window as any).AniDashAccount
const malAccount = () => (window as any).AniDashMal
type Connection = "checking" | "guest" | "account" | "paired" | "unavailable"
const sections = [
 ["profile","Profile & devices","Account and active sessions"],
 ["content","Content & streaming","Sources and manga"],
 ["tracking","Tracking & releases","Progress and upcoming episodes"],
 ["support","Support & updates","Feedback and release notes"],
 ["about","About AniDash Go","App, developer and licenses"],
] as const
const secondary = "inline-flex items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-semibold hover:bg-[--subtle] disabled:opacity-50"
const primary = "inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
const danger = secondary + " border-red-500/30 text-red-400 hover:bg-red-500/10"
function Section({id,title,description,children}:{id:string;title:string;description:string;children:React.ReactNode}) {
 return <section id={id} className="scroll-mt-24 rounded-2xl border bg-[--paper] p-4 sm:p-6 space-y-5"><div className="border-b pb-4"><h2 className="text-xl font-bold">{title}</h2><p className="mt-1 text-sm text-[--muted]">{description}</p></div>{children}</section>
}
function Row({title,description,children}:{title:string;description:string;children:React.ReactNode}){
 return <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-sm text-[--muted]">{description}</p></div><div className="shrink-0">{children}</div></div>
}
function ActionLink({href,title,description,external=false}:{href:string;title:string;description:string;external?:boolean}){
 return <a href={href} target={external?"_blank":undefined} rel={external?"noreferrer":undefined} className="group flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors hover:bg-[--subtle]"><div><strong className="text-sm">{title}</strong><p className="mt-1 text-sm text-[--muted]">{description}</p></div><span aria-hidden="true" className="text-[--muted] group-hover:text-current">{external?"↗":"→"}</span></a>
}
export default function Page() {
 const [prefs,setPrefs]=React.useState(browserPreferences),[user,setUser]=React.useState<any>(null),[malUser,setMalUser]=React.useState<any>(null),[message,setMessage]=React.useState(""),[busy,setBusy]=React.useState(false)
 const [connection,setConnection]=React.useState<Connection>("checking")
 const [active,setActive]=React.useState<string>("profile")
 const status=useServerStatus()
 React.useEffect(()=>{
  let alive=true, sequence=0
  async function refresh(){
   const seq=++sequence
   try{
    const r=await fetch("/api/device-pair/account",{cache:"no-store"})
    const paired=r.ok&&(await r.json()).success===true
    const a=account(),m=malAccount()
    const results=await Promise.allSettled([a?.init(),m?.init()])
    if(!alive||seq!==sequence)return
    const u=a?.currentUser()||null,mu=m?.currentUser()||null
    setUser(u);setMalUser(mu)
    setConnection(paired?"paired":u||mu?"account":r.status===401&&a&&m&&results.every(x=>x.status==="fulfilled")?"guest":"unavailable")
   }catch{if(alive&&seq===sequence)setConnection("unavailable")}
  }
  void refresh()
  const onFocus=()=>{void refresh()}
  const onVisible=()=>{if(document.visibilityState==="visible")void refresh()}
  window.addEventListener("focus",onFocus);document.addEventListener("visibilitychange",onVisible)
  const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void refresh()},60000)
  return()=>{alive=false;window.clearInterval(timer);window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onVisible)}
 },[])
 function pref(k:string,v:any){setBrowserPreference(k,v);setPrefs(browserPreferences())}
 async function signOut(){setBusy(true);setMessage("");try{if(connection==="paired"){const r=await fetch("/api/device-pair/logout",{method:"POST",cache:"no-store"});if(!r.ok&&r.status!==401)throw Error("Unable to disconnect this browser.");location.reload();return}if(user)await account()?.logout();else await malAccount()?.logout();location.reload()}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 async function check(){setBusy(true);setMessage("");try{const r=await fetch("https://api.github.com/repos/anshdeepofficial1/AniDash-Website/releases/latest");if(r.status===404){setMessage("No tagged web release is published yet. See GitHub for the latest changes.");return}if(!r.ok)throw Error("GitHub is temporarily unavailable");const x=await r.json() as {tag_name?:string};setMessage("Latest published web release: "+(x.tag_name||"unknown"))}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 async function testApi(){setBusy(true);setMessage("");try{if(user){await account().list(true);setMessage("AniList library refreshed.")}else if(malUser){await malAccount().list();setMessage("MyAnimeList library refreshed.")}else{await list({perPage:1,sort:["TRENDING_DESC"]});setMessage("AniList metadata request succeeded.")}window.dispatchEvent(new Event("anidash-watch-progress"))}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 const connected=connection==="paired"||connection==="account"
 return <PageWrapper className="mx-auto w-full max-w-[1440px] p-3 sm:p-6 lg:p-8 space-y-6">
  <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-5"><div><p className="text-xs font-semibold uppercase tracking-widest text-[--muted]">AniDash Go / Preferences</p><h1 className="mt-2 text-3xl font-bold sm:text-4xl">Settings</h1><p className="mt-2 text-sm text-[--muted]">Manage your account, viewing experience and connected devices.</p></div><span className="rounded-full border px-3 py-1.5 text-xs text-[--muted]">Web • {status?.version||"2.0.0"}</span></header>
  <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_250px]">
   <aside className="lg:sticky lg:top-20"><nav aria-label="Settings sections" className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible"><p className="hidden px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-[--muted] lg:block">Preferences</p>{sections.map(([id,label,detail],i)=><a key={id} href={"#"+id} onClick={()=>setActive(id)} aria-current={active===id?"location":undefined} className={"flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors "+(active===id?"bg-[--subtle] font-semibold ring-1 ring-inset ring-brand-500/40":"hover:bg-[--subtle]")}><span className="text-xs tabular-nums text-[--muted]">0{i+1}</span><span>{label}<span className="mt-1 hidden text-xs font-normal text-[--muted] lg:block">{detail}</span></span></a>)}</nav></aside>
   <main className="min-w-0 space-y-5">
    <Section id="profile" title="Profile & connected devices" description="Manage your tracker accounts, Android connection and browser sessions.">
     {connection==="checking"?<p role="status" className="text-sm text-[--muted]">Loading account details…</p>:<>
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-[--subtle] p-4"><div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-[--paper] text-lg font-bold">{user?.avatar?.large?<img className="size-full object-cover" src={user.avatar.large} alt=""/>:String(user?.name||malUser?.name||"G").slice(0,1).toUpperCase()}</div><div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{user?.name||malUser?.name||(connected?"Connected account":"Guest profile")}</h3><p className="text-sm text-[--muted]">{connection==="paired"?"Linked through AniDash Android":connected?"Tracker account connected":connection==="unavailable"?"Account status unavailable":"Your library is stored in this browser."}</p></div>{connected&&<button className={danger} disabled={busy} onClick={()=>void signOut()}>Sign out</button>}</div>
      <div className="divide-y"><Row title="AniList" description={user?"Connected as "+user.name:"Track anime, lists and supported playback positions."}>{user?<span className="text-sm font-semibold text-emerald-500">Connected</span>:connection==="guest"||connection==="account"?<button className={secondary} onClick={async()=>{try{if(!account())throw Error("AniList account module is unavailable");await account().beginLogin()}catch(e){setMessage((e as Error).message)}}}>Connect AniList</button>:<span className="text-sm text-[--muted]">Not connected</span>}</Row><Row title="MyAnimeList" description={malUser?"Connected as "+malUser.name:"Sync anime lists and completed episode counts."}><span className={"text-sm "+(malUser?"font-semibold text-emerald-500":"text-[--muted]")}>{malUser?"Connected":"Not connected"}</span></Row></div>
     </>}
     <div className="border-t pt-4 space-y-3"><h3 className="font-semibold">Device connection</h3><DevicePairing connection={connection}/>{connection==="account"&&<p className="text-sm text-[--muted]">Your tracker is already connected. No additional pairing is required.</p>}</div>
     <ActionLink href="/lists" title="Your library" description="Open your saved and tracked anime lists."/>
    </Section>
    <Section id="content" title="Content & streaming" description="Choose your streaming sources and personalize the content shown in AniDash Go.">
     <ActionLink href="/extensions" title="Manage extensions" description={installedSources().length+" installed · Review available streaming sources."}/>
     <Row title="Show manga in navigation" description="Display the manga section in the main navigation."><label className="relative inline-flex cursor-pointer items-center"><input aria-label="Show manga in navigation" className="peer sr-only" type="checkbox" checked={prefs.showMangaTab!==false} onChange={e=>{pref("showMangaTab",e.target.checked);location.reload()}}/><span className="h-6 w-11 rounded-full border bg-[--subtle] transition-colors peer-checked:bg-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500"/><span className="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"/></label></Row>
     <ActionLink href="/manga" title="Manga library & discovery" description="Browse manga and return to your reading list."/>
     <p className="text-xs text-[--muted]">Use authorized browser-compatible sources or official streaming providers.</p>
    </Section>
    <Section id="tracking" title="Tracking & release schedule" description="Keep your watch history current and discover upcoming episodes.">
     <Row title="Tracker synchronization" description={user?"AniList supports episode progress and compatible playback timestamps.":malUser?"MyAnimeList supports completed episode counts.":"Connect a tracker to synchronize progress across devices."}><button className={secondary} disabled={busy||!connected} onClick={()=>void testApi()}>Refresh tracker</button></Row>
     <ActionLink href="/schedule" title="Release calendar" description="See upcoming releases and episodes from your list."/>
     <p className="text-sm text-[--muted]">External embedded players may not report playback positions. Use supported players for automatic tracking.</p>
    </Section>
    <Section id="support" title="Support & updates" description="Get help, report problems and discover the latest improvements.">
     <div className="grid gap-3 sm:grid-cols-2"><ActionLink external href={repo+"/issues/new/choose"} title="Report an issue" description="Send a bug report or request a feature."/><ActionLink external href={repo+"/issues"} title="Known issues" description="Browse reports and their status."/><ActionLink external href={repo+"/releases"} title="Release notes" description="Explore published versions and changes."/><div className="rounded-xl border p-4 space-y-3"><div><strong className="text-sm">Check for updates</strong><p className="mt-1 text-sm text-[--muted]">Find the latest published web release.</p></div><button disabled={busy} className={secondary} onClick={()=>void check()}>Check now</button></div></div>
    </Section>
    {message&&<p role="status" className="sticky bottom-4 z-10 rounded-xl border bg-[--paper] p-4 text-sm shadow-lg">{message}</p>}
    <Section id="about" title="About AniDash Go" description="The web companion for AniDash.">
     <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-[--muted]">Version</dt><dd className="mt-1 font-semibold">{status?.version||"2.0.0"}</dd></div><div><dt className="text-[--muted]">Developer</dt><dd className="mt-1 font-semibold">Anshdeep Singh</dd></div></dl>
     <div className="grid gap-3 sm:grid-cols-2"><ActionLink external href={android} title="AniDash Android" description="Download the companion app."/><ActionLink external href="https://github.com/anshdeepofficial1" title="Developer GitHub" description="Explore other projects."/><ActionLink external href="https://anshdeepofficial1.vercel.app" title="Developer website" description="Visit the portfolio."/><ActionLink external href={repo+"/blob/main/LICENSE.seanime"} title="Licenses & attribution" description="Open-source notices and credits."/></div>
    </Section>
   </main>
   <aside className="hidden space-y-4 xl:sticky xl:top-20 xl:block"><div className="rounded-2xl border bg-[--paper] p-4 space-y-3"><p className="text-xs font-semibold uppercase tracking-wider text-[--muted]">Account overview</p><div className="flex items-center gap-2"><span className={"size-2 rounded-full "+(connected?"bg-emerald-500":"bg-gray-500")}/><strong className="text-sm">{connection==="paired"?"Connected from AniDash":connection==="account"?"Tracker connected":connection==="checking"?"Checking…":connection==="unavailable"?"Status unavailable":"Guest session"}</strong></div><p className="text-sm text-[--muted]">{user?"AniList connected":malUser?"MyAnimeList connected":"No tracker detected"}</p><a href="#profile" onClick={()=>setActive("profile")} className={secondary+" w-full"}>Manage account</a></div><div className="rounded-2xl border bg-[--paper] p-4 space-y-3"><h3 className="font-semibold">Need help?</h3><p className="text-sm text-[--muted]">Find known issues or share feedback with the developer.</p><a href="#support" onClick={()=>setActive("support")} className={secondary+" w-full"}>Support center</a></div></aside>
  </div>
 </PageWrapper>
}
