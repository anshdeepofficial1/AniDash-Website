import React from "react"
import { LuListPlus, LuPlus, LuX } from "react-icons/lu"
import { LIST_STATUSES, localListStatus, setListStatus } from "./card-actions"
import { readWatchState, saveWatchState } from "./resume"
import { toast } from "sonner"

type LocalList={id:string;name:string;items:Record<string,any>}
function getLists():LocalList[]{const lists=readWatchState().customLists;return Array.isArray(lists)?lists:[]}
function createList(name:string,media?:any){
 const label=name.trim().slice(0,60)
 if(!label)throw Error("Enter a list name.")
 const s=readWatchState(),lists=getLists()
 if(lists.some(l=>l.name.toLowerCase()===label.toLowerCase()))throw Error("A list with that name already exists.")
 saveWatchState({...s,customLists:[...lists,{id:crypto.randomUUID(),name:label,items:media?{[media.id]:media}:{}}]})
}
function addToCustom(id:string,media:any){
 const s=readWatchState()
 saveWatchState({...s,customLists:getLists().map(l=>l.id===id?{...l,items:{...l.items,[media.id]:media}}:l)})
}
function removeFromCustom(id:string,mediaId:string){
 const s=readWatchState()
 saveWatchState({...s,customLists:getLists().map(l=>{if(l.id!==id)return l;const items={...l.items};delete items[mediaId];return {...l,items}})})
}
function useLists(){
 const [lists,setLists]=React.useState(getLists)
 React.useEffect(()=>{const change=()=>setLists(getLists());window.addEventListener("anidash-watch-progress",change);return()=>window.removeEventListener("anidash-watch-progress",change)},[])
 return lists
}
export function BrowserListPicker({media,status}:{media:any;status?:string}){
 const lists=useLists(),[creating,setCreating]=React.useState(false),[name,setName]=React.useState(""),[busy,setBusy]=React.useState(false)
 async function choose(value:string){
  if(!value)return
  if(value==="new"){setCreating(true);return}
  setBusy(true)
  try{if(value.startsWith("custom:")){addToCustom(value.slice(7),media);toast.success("Added to your custom list",{duration:2000,closeButton:true})}else{await setListStatus(media,value);toast.success("Library updated",{duration:2000,closeButton:true})}}catch(e){toast.error((e as Error).message,{duration:2000,closeButton:true})}finally{setBusy(false)}
 }
 function create(){try{createList(name,media);setName("");setCreating(false);toast.success("List created and anime added",{duration:2000,closeButton:true})}catch(e){toast.error((e as Error).message,{duration:2000,closeButton:true})}}
 return <div className="w-full space-y-2" onClick={e=>e.stopPropagation()}>
 <label className="flex items-center gap-2 rounded-lg border px-2 py-1.5"><LuListPlus className="size-4 shrink-0"/><select aria-label="Add to list" disabled={busy} value="" onChange={e=>void choose(e.target.value)} className="min-w-0 flex-1 bg-[--paper] text-xs"><option value="" disabled>{busy?"Saving…":status||localListStatus(media.id)?"Change or add to list":"Add to list"}</option><optgroup label="Your library">{LIST_STATUSES.map(([value,label])=><option value={value} key={value}>{label}</option>)}</optgroup><optgroup label="Custom lists (this browser)">{lists.map(l=><option value={"custom:"+l.id} key={l.id}>{l.name}</option>)}<option value="new">+ Create a new list</option></optgroup></select></label>
 {creating&&<div className="flex gap-1"><input value={name} onChange={e=>setName(e.target.value)} maxLength={60} placeholder="List name" aria-label="New list name" className="min-w-0 flex-1 rounded border bg-[--paper] px-2 text-xs" onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();create()}}}/><button type="button" className="rounded border px-2 text-xs" onClick={create}>Create</button><button type="button" aria-label="Cancel new list" onClick={()=>setCreating(false)}><LuX/></button></div>}
 </div>
}
export function BrowserCustomLists(){
 const lists=useLists(),[name,setName]=React.useState("")
 function add(){try{createList(name);setName("");toast.success("List created",{duration:2000,closeButton:true})}catch(e){toast.error((e as Error).message,{duration:2000,closeButton:true})}}
 return <section className="space-y-4 rounded-xl border p-4"><div><h2 className="text-xl font-semibold">Your custom lists</h2><p className="text-sm text-[--muted]">Personal collections stored in this browser, separate from tracker lists.</p></div><div className="flex gap-2"><input value={name} onChange={e=>setName(e.target.value)} maxLength={60} placeholder="New list name" aria-label="New list name" className="min-w-0 flex-1 rounded-lg border bg-[--paper] p-2"/><button type="button" onClick={add} className="flex items-center gap-1 rounded-lg border px-3"><LuPlus/>Create list</button></div>{lists.map(l=><details className="rounded-lg border p-3" key={l.id}><summary className="cursor-pointer font-semibold">{l.name} · {Object.keys(l.items).length}</summary><div className="mt-3 space-y-2">{Object.entries(l.items).map(([id,m])=><div className="flex items-center gap-3" key={id}><a href={"/entry?id="+id} className="flex min-w-0 flex-1 items-center gap-3"><img src={m.coverImage?.large||m.coverImage?.medium} className="h-12 w-8 rounded object-cover" alt=""/><span className="truncate">{m.title?.english||m.title?.userPreferred||m.title?.romaji||"Anime"}</span></a><button type="button" aria-label="Remove from custom list" onClick={()=>removeFromCustom(l.id,id)}><LuX/></button></div>)}</div></details>)}</section>
}
