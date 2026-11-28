import React from "react"
import { DevicePairing } from "@/browser/device-pairing"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { browserPreferences,setBrowserPreference,list } from "@/browser/transport"
import { installedSources } from "@/browser/sources"
import { LuUser, LuSettings, LuBookOpen, LuCalendar, LuLifeBuoy, LuInfo, LuChevronRight, LuExternalLink, LuLogOut, LuRefreshCw, LuCheck, LuLibrary, LuPuzzle, LuGithub, LuSmartphone } from "react-icons/lu"

const repo="https://github.com/anshdeepofficial1/AniDash-Website", android="https://github.com/anshdeepofficial1/AniDash"
const account=()=> (window as any).AniDashAccount
const sections=[{id:"profile",label:"Account",icon:LuUser},{id:"content",label:"Content & streaming",icon:LuBookOpen},{id:"tracking",label:"Tracking",icon:LuCalendar},{id:"support",label:"Support & updates",icon:LuLifeBuoy},{id:"about",label:"About",icon:LuInfo}]
const primary="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[--brand] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
const secondary="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border bg-[--subtle]/30 px-4 py-2 text-sm font-semibold transition hover:bg-[--subtle] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
const danger="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-500/10"
function Section({id,title,description,icon:Icon,children}:{id:string;title:string;description:string;icon:React.ElementType;children:React.ReactNode}){
 return <section id={id} className="scroll-mt-24 overflow-hidden rounded-2xl border bg-[--paper]">
  <div className="flex items-start gap-3 border-b p-4 sm:p-5"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[--brand]/10 text-[--brand]"><Icon size={22}/></div><div className="min-w-0"><h2 className="text-lg font-semibold leading-tight sm:text-xl">{title}</h2><p className="mt-1 text-sm text-[--muted]">{description}</p></div></div>
  <div className="space-y-3 p-4 sm:p-5">{children}</div>
 </section>
}
function LinkRow({title,description,href,external=false,icon:Icon=LuChevronRight}:{title:string;description?:string;href:string;external?:boolean;icon?:React.ElementType}){
 return <a href={href} target={external?"_blank":undefined} rel={external?"noreferrer":undefined} className="group flex min-h-16 items-center gap-3 rounded-xl border bg-[--subtle]/20 px-3 py-3 transition hover:bg-[--subtle] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-4"><Icon size={19} className="shrink-0 text-[--muted]"/><span className="min-w-0 flex-1"><span className="block font-medium">{title}</span>{description&&<span className="mt-1 block text-sm text-[--muted]">{description}</span>}</span>{external?<LuExternalLink className="shrink-0 text-[--muted]" size={17}/>:<LuChevronRight size={19} className="shrink-0 text-[--muted] transition group-hover:translate-x-0.5"/>}</a>
}
function ActionRow({title,description,label,onClick,busy}:{title:string;description:string;label:string;onClick:()=>void;busy:boolean}){
 return <div className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3 sm:px-4"><div className="min-w-0 flex-1"><p className="font-medium">{title}</p><p className="mt-1 text-sm text-[--muted]">{description}</p></div><button className={secondary+" w-full sm:w-auto"} type="button" disabled={busy} onClick={onClick}><LuRefreshCw className={busy?"animate-spin":""} size={16}/>{busy?"Checking…":label}</button></div>
}
export default function Page(){
 const [prefs,setPrefs]=React.useState(browserPreferences),[user,setUser]=React.useState<any>(null),[malUser,setMalUser]=React.useState<any>(null),[message,setMessage]=React.useState(""),[messageFor,setMessageFor]=React.useState<"api"|"update"|null>(null),[busy,setBusy]=React.useState<"api"|"update"|null>(null)
 const [accountReady,setAccountReady]=React.useState(false),[paired,setPaired]=React.useState(false),[accountMessage,setAccountMessage]=React.useState("")
 const status=useServerStatus()
 React.useEffect(()=>{let alive=true;async function load(){const a=account(),mal=(window as any).AniDashMal;try{await Promise.allSettled([a?.init(),mal?.init()]);if(!alive)return;setUser(a?.currentUser()||null);setMalUser(mal?.currentUser()||null);try{const r=await fetch("/api/device-pair/account",{cache:"no-store"});if(alive&&r.ok){const v=await r.json();if(alive)setPaired(v.success===true)}}catch{}}finally{if(alive)setAccountReady(true)}}void load();return()=>{alive=false}},[])
 function pref(k:string,v:any){setBrowserPreference(k,v);setPrefs(browserPreferences())}
 async function check(){setBusy("update");setMessageFor("update");setMessage("");try{const r=await fetch("https://api.github.com/repos/anshdeepofficial1/AniDash-Website/releases/latest");if(r.status===404){setMessage("No tagged web release is published. View the latest changes on GitHub.");return}if(!r.ok)throw Error("GitHub is temporarily unavailable");const x=await r.json();setMessage("Latest published web release: "+x.tag_name)}catch(e){setMessage((e as Error).message)}finally{setBusy(null)}}
 async function testApi(){setBusy("api");setMessageFor("api");setMessage("");try{await list({perPage:1,sort:["TRENDING_DESC"]});setMessage("AniList metadata request succeeded.")}catch(e){setMessage((e as Error).message)}finally{setBusy(null)}}
 async function signOut(){try{if(paired){const r=await fetch("/api/device-pair/logout",{method:"POST"});if(!r.ok)throw Error("Sign-out failed")}else if(user){await account()?.logout()}else{await (window as any).AniDashMal?.logout()}location.reload()}catch(e){setAccountMessage((e as Error).message)}}
 return <PageWrapper className="mx-auto max-w-6xl space-y-6 p-4 pb-28 sm:p-8">
 <header className="flex items-center gap-4"><div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-[--subtle]"><LuSettings size={27}/></div><div><p className="text-xs font-semibold uppercase tracking-widest text-[--muted]">AniDash Go</p><h1 className="text-3xl font-bold tracking-tight">AniDash Go settings</h1><p className="mt-1 text-sm text-[--muted]">Manage your account, content and preferences.</p></div></header>
 <div className="grid min-w-0 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
 <nav aria-label="Settings sections" className="flex gap-2 overflow-x-auto pb-2 lg:sticky lg:top-24 lg:h-fit lg:flex-col lg:rounded-2xl lg:border lg:bg-[--paper] lg:p-3">{sections.map(({id,label,icon:Icon})=><a key={id} href={"#"+id} className="flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition hover:bg-[--subtle] lg:border-transparent"><Icon size={18}/>{label}</a>)}</nav>
 <main className="min-w-0 space-y-5">
 <Section id="profile" title="Profile & account" description="Your identity, tracker connections and paired browsers." icon={LuUser}>
  <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-[--subtle]/30 p-4">
   {user?.avatar?.large?<img className="size-14 shrink-0 rounded-full object-cover" src={user.avatar.large} alt=""/>:<div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[--subtle] text-[--muted]"><LuUser size={26}/></div>}
   <div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{user?.name||malUser?.name||(accountReady?"Guest profile":"Loading profile…")}</h3><p className="mt-1 text-sm text-[--muted]">{paired?"Signed in through AniDash Android":user||malUser?"Your tracker account is connected.":"Your local library is saved in this browser."}</p></div>
   {accountReady&&(paired||user||malUser)?<button type="button" className={danger+" w-full sm:w-auto"} onClick={()=>void signOut()}><LuLogOut size={17}/> Sign out</button>:accountReady?<button type="button" className={primary+" w-full sm:w-auto"} onClick={async()=>{try{if(!account())throw Error("AniList account module is unavailable");await account().beginLogin()}catch(e){setAccountMessage((e as Error).message)}}}>Connect AniList</button>:null}
  </div>
  {accountReady&&!paired&&!user&&malUser&&<button type="button" className={primary} onClick={async()=>{try{if(!account())throw Error("AniList account module is unavailable");await account().beginLogin()}catch(e){setAccountMessage((e as Error).message)}}}>Connect AniList</button>}
  {(user||malUser)&&<div className="flex flex-wrap gap-2">{user&&<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400"><LuCheck/> AniList connected</span>}{malUser&&<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400"><LuCheck/> MyAnimeList connected</span>}</div>}
  {accountMessage&&<p role="alert" className="text-sm text-red-400">{accountMessage}</p>}
  <DevicePairing/>
  <LinkRow title="My List / Your Library" description="Manage your anime and manga lists." href="/lists" icon={LuLibrary}/>
 </Section>
 <Section id="content" title="Content & streaming" description="Choose how you browse and access content." icon={LuBookOpen}>
  <p className="text-sm text-[--muted]">Online streaming only. Use an authorized browser-compatible source or an official streaming provider.</p>
  <LinkRow title="Manage extensions" description={installedSources().length+" installed"} href="/extensions" icon={LuPuzzle}/>
  <div className="flex items-center justify-between gap-4 rounded-xl border p-4"><div><p className="font-medium">Show manga in navigation</p><p className="mt-1 text-sm text-[--muted]">Display the manga tab in your navigation.</p></div><button type="button" role="switch" aria-label="Show manga in navigation" aria-checked={prefs.showMangaTab!==false} onClick={()=>{pref("showMangaTab",prefs.showMangaTab===false);location.reload()}} className={"relative h-7 w-12 shrink-0 rounded-full transition "+(prefs.showMangaTab!==false?"bg-[--brand]":"bg-gray-600")}><span className={"absolute top-1 size-5 rounded-full bg-white shadow transition-transform "+(prefs.showMangaTab!==false?"translate-x-[2px] right-1":"left-1")}/></button></div>
  <LinkRow title="Manga library & discovery" href="/manga" icon={LuBookOpen}/>
 </Section>
 <Section id="tracking" title="Tracking & release schedule" description="Stay up to date with upcoming episodes." icon={LuCalendar}>
  <LinkRow title="Release calendar" description="My List and all upcoming episodes." href="/schedule" icon={LuCalendar}/>
  <ActionRow title="AniList connection" description="Check whether the metadata service is responding." label="Test connection" busy={busy!==null} onClick={()=>void testApi()}/>
  {message&&messageFor==="api"&&<p role="status" className="rounded-xl border p-3 text-sm">{message}</p>}
 </Section>
 <Section id="support" title="Support & updates" description="Get help, report problems and check what's new." icon={LuLifeBuoy}>
  <LinkRow title="Report an issue / feedback" description="Share a bug report or suggestion." href={repo+"/issues/new/choose"} external/>
  <LinkRow title="Community issues" href={repo+"/issues"} external/>
  <ActionRow title="Website updates" description="Check the latest published web release." label="Check for updates" busy={busy!==null} onClick={()=>void check()}/>
  <LinkRow title="Web releases" href={repo+"/releases"} external/>
  <LinkRow title="Latest website changes" href={repo+"/commits/main"} external/>
  {message&&messageFor==="update"&&<p role="status" className="rounded-xl border p-3 text-sm">{message}</p>}
 </Section>
 <Section id="about" title="About AniDash Go" description="Anime & manga web companion." icon={LuInfo}>
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-[--subtle]/30 p-4"><div><p className="font-semibold">AniDash Go</p><p className="text-sm text-[--muted]">Developed by Anshdeep Singh</p></div><span className="rounded-full border px-3 py-1 text-xs font-medium">Version {status?.version||"2.0.0"}</span></div>
  <LinkRow title="AniDash Android app" href={android} external icon={LuSmartphone}/>
  <LinkRow title="Developer GitHub" href="https://github.com/anshdeepofficial1" external icon={LuGithub}/>
  <LinkRow title="Developer website" href="https://anshdeepofficial1.vercel.app" external/>
  <LinkRow title="Open-source licenses and attribution" href={repo+"/blob/main/LICENSE.seanime"} external/>
 </Section>
 </main></div></PageWrapper>
}
