// Data-only, opt-in repository catalog. No remote code execution or server-side fetch.
import {parseSource,installSource,installedSources} from "./sources.ts"
export type RepoPackage={id:string;name:string;version:number;manifest:string;sha256:string}
export type Repository={url:string;name:string;packages:RepoPackage[];checkedAt:number;installed:Record<string,{sourceId:string;version:number}>}
const KEY="anidash.anime.repositories.v1"
function publicHttps(value:unknown,base?:string){
 if(typeof value!=="string"||value.length>2048)throw Error("Invalid repository URL")
 const url=new URL(value,base),host=url.hostname.toLowerCase().replace(/\.$/,"")
 if(url.protocol!=="https:"||url.username||url.password||url.hash||url.search||!host.includes(".")||host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||/^\d+(\.\d+){3}$/.test(host)||host.startsWith("["))throw Error("Use a public HTTPS URL without credentials, query or fragment")
 return url.href
}
export function parseRepository(raw:string,rawUrl:string):Repository{
 const url=publicHttps(rawUrl),root=new URL(url).origin,d=JSON.parse(raw)
 if(!d||d.version!==1||typeof d.name!=="string"||!d.name.trim()||d.name.length>100||!Array.isArray(d.packages)||d.packages.length>100)throw Error("Invalid repository index")
 const ids=new Set<string>()
 const packages:RepoPackage[]=d.packages.map((p:any)=>{
  if(!p||typeof p.id!=="string"||!/^[-_a-zA-Z0-9]{1,40}$/.test(p.id)||ids.has(p.id)||typeof p.name!=="string"||!p.name.trim()||p.name.length>100||!Number.isSafeInteger(p.version)||p.version<1||typeof p.sha256!=="string"||!(/^[a-fA-F0-9]{64}$/).test(p.sha256))throw Error("Invalid package entry")
  const manifest=publicHttps(p.manifest,url);if(new URL(manifest).origin!==root)throw Error("Package manifests must be on the repository origin")
  ids.add(p.id);return{id:p.id,name:p.name.trim(),version:p.version,manifest,sha256:p.sha256.toLowerCase()}
 })
 return {url,name:d.name.trim(),packages,checkedAt:Date.now(),installed:{}}
}
export function repositories():Repository[]{try{const data=JSON.parse(localStorage.getItem(KEY)||"[]");if(!Array.isArray(data))return [];return data.filter(r=>r&&typeof r.url==="string"&&Array.isArray(r.packages)&&r.installed&&typeof r.installed==="object")}catch{return []}}
function save(rows:Repository[]){localStorage.setItem(KEY,JSON.stringify(rows))}
async function bytes(url:string,max:number){
 const response=await fetch(publicHttps(url),{credentials:"omit",referrerPolicy:"no-referrer",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)})
 if(!response.ok||!response.body)throw Error("Repository request failed ("+response.status+")")
 if(Number(response.headers.get("content-length"))>max)throw Error("Repository file exceeds size limit")
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max){await reader.cancel();throw Error("Repository file exceeds size limit")}parts.push(value)}}finally{reader.releaseLock()}
 const out=new Uint8Array(total);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length}return out
}
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,"0")).join("")
export async function refreshRepository(rawUrl:string){
 const url=publicHttps(rawUrl),prior=repositories().find(r=>r.url===url)
 const next=parseRepository(new TextDecoder().decode(await bytes(url,256_000)),url)
 next.installed=prior?.installed||{}
 save([...repositories().filter(r=>r.url!==url),next]);return next
}
export function removeRepository(url:string){save(repositories().filter(r=>r.url!==url))}
export function packageState(repo:Repository,p:RepoPackage){
 const record=repo.installed[p.id],exists=record&&installedSources().some(s=>s.id===record.sourceId)
 return !exists?"install":p.version>record.version?"update":p.version<record.version?"older":"installed"
}
export async function installRepositoryPackage(url:string,id:string){
 const repo=repositories().find(r=>r.url===url),p=repo?.packages.find(x=>x.id===id);if(!repo||!p)throw Error("Refresh the repository first")
 const state=packageState(repo,p);if(state==="older")throw Error("Repository attempted to downgrade an installed source")
 const raw=await bytes(p.manifest,2_000_000)
 if(hex(await crypto.subtle.digest("SHA-256",raw))!==p.sha256)throw Error("Manifest checksum mismatch. Refresh repository before retrying")
 const source=parseSource(new TextDecoder().decode(raw))
 if(source.id!==p.id||!source.episodes.length||source.chapters?.length)throw Error("Package must contain matching anime-only manifest")
 const sourceId="repo-"+hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(repo.url))).slice(0,16)+"-"+p.id
 installSource({...source,id:sourceId})
 const latest=repositories().find(r=>r.url===url);if(latest){latest.installed={...latest.installed,[id]:{sourceId,version:p.version}};save([...repositories().filter(r=>r.url!==url),latest])}
 return source.name
}
