import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv } from "node:crypto";
import { deviceStore, MANAGEMENT_TTL, validDeviceId } from "./device-management.js";

const PAIR_TTL=300, SESSION_TTL=30*86400, COOKIE="__Host-anidash-paired", BIND="__Host-anidash-pair";
const hash=x=>createHash("sha256").update(x).digest("hex");
const random=n=>randomBytes(n).toString("hex");
class PairConfigError extends Error { constructor(category){super("Pairing unavailable");this.category=category} }
const key=()=>{const k=Buffer.from(process.env.DEVICE_PAIR_ENCRYPTION_KEY||"","base64");if(k.length!==32)throw new PairConfigError("encryption-key-invalid");return k};
function encrypt(value,aad){const iv=randomBytes(12),c=createCipheriv("aes-256-gcm",key(),iv);c.setAAD(Buffer.from(aad));return Buffer.concat([iv,c.update(JSON.stringify(value)),c.final(),c.getAuthTag()]).toString("base64")}
function decrypt(value,aad){const b=Buffer.from(value,"base64"),d=createDecipheriv("aes-256-gcm",key(),b.subarray(0,12));d.setAAD(Buffer.from(aad));d.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString())}
async function redis(...args){const explicit=process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN;const url=explicit?process.env.UPSTASH_REDIS_REST_URL:process.env.KV_REST_API_URL,token=explicit?process.env.UPSTASH_REDIS_REST_TOKEN:process.env.KV_REST_API_TOKEN;if(!url||!token)throw new PairConfigError("redis-credentials-missing");let r;try{r=await fetch(url,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(args),signal:AbortSignal.timeout(7000)})}catch{throw new PairConfigError("redis-connection-failed")}if(!r.ok)throw new PairConfigError(r.status===401||r.status===403?"redis-auth-rejected":"redis-http-failed");let v;try{v=await r.json()}catch{throw new PairConfigError("redis-response-invalid")}if(v.error)throw new PairConfigError("redis-command-failed");return v.result}
const pkey=code=>"anidash:pair:"+hash(code);
const marker=code=>"anidash:pair-known:"+hash(code);
const skey=id=>"anidash:session:"+hash(id);
const valid=x=>typeof x==="string"&&/^[0-9a-f]{32}$/.test(x);
function cookies(req){return Object.fromEntries(String(req.headers.cookie||"").split(";").map(x=>x.trim().split("=")).filter(x=>x.length===2))}
function cookie(name,value,age){return name+"="+value+"; Path=/; Max-Age="+age+"; Secure; HttpOnly; SameSite=Strict"}
const reply=(res,status,body)=>res.status(status).json(body);
const fail=(res,status)=>reply(res,status,{success:false,error:({400:"Invalid pairing request",401:"Browser login required",403:"Forbidden",404:"Device not found",405:"Method not allowed",410:"Pairing expired, denied or consumed",429:"Too many requests",503:"Pairing temporarily unavailable"})[status]||"Request failed"});
const body=req=>{if(Number(req.headers["content-length"]||0)>32768)throw Error("Invalid");const b=typeof req.body==="string"?JSON.parse(req.body):req.body;if(!b||typeof b!=="object"||Array.isArray(b)||JSON.stringify(b).length>32768)throw Error("Invalid");return b};
function originOK(req){return req.headers.origin==="https://"+req.headers.host}
async function limit(req,action,code){const ip=String(req.headers["x-vercel-forwarded-for"]||req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").split(",")[0].trim();const identity=createHmac("sha256",key()).update(ip).digest("hex");const lua="local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n";const cap=({create:8,session:30,approve:10,"approve-code":10,status:100,account:120,anilist:120,logout:10,devices:60,"device-revoke":20,management:10})[action]||30;const n=await redis("EVAL",lua,1,"anidash:rate:"+action+":"+identity);if(n>cap)return false;if(valid(code)&&action!=="status"){const c=await redis("EVAL",lua,1,"anidash:rate:"+action+":"+hash(code));if(c>cap)return false}return true}
function device(req){const ua=String(req.headers["user-agent"]||"").slice(0,512);const m=ua.match(/(Edg|OPR)\/(\d+)/)||ua.match(/(Chrome|Firefox|Version)\/(\d+)/);const browser=m?({Edg:"Edge",OPR:"Opera",Version:"Safari"}[m[1]]||m[1])+" "+m[2]:"Unknown browser";const os=/Android/.test(ua)?"Android":/iPhone|iPad/.test(ua)?"iOS/iPadOS":/Windows NT/.test(ua)?"Windows":/Macintosh/.test(ua)?"macOS":/Linux/.test(ua)?"Linux":"Unknown OS";return {name:browser.split(" ")[0]+" on "+os,browser,os}}
const read=async code=>{const v=await redis("GET",pkey(code));return v?JSON.parse(v):null};
const transition=String.raw`local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
local s=cjson.decode(raw); if s.state~='pending' or tonumber(s.expiresAt)<=tonumber(ARGV[1]) then return -1 end
if ARGV[2]=='denied' then redis.call('DEL',KEYS[1]); return 1 end; local ttl=redis.call('PTTL',KEYS[1]); if ttl<=0 then return -1 end; s.state=ARGV[2]; s.encrypted=ARGV[3]; redis.call('SET',KEYS[1],cjson.encode(s),'PX',ttl); if ARGV[4]~='' then redis.call('SET',KEYS[2],ARGV[4],'EX',ARGV[5]) end; return 1`;

function preferences(input){const p=input?.preferences||{},player=p.player||{};const pick=(v,allowed)=>allowed.includes(v)?v:undefined;const str=v=>typeof v==="string"&&/^[a-zA-Z0-9 _.-]{1,80}$/.test(v)?v:undefined;return {schemaVersion:1,preferences:{playbackSourceKind:str(p.playbackSourceKind),nativeSource:str(p.nativeSource),hindiSource:str(p.hindiSource),hindiSourceEnabled:typeof p.hindiSourceEnabled==="boolean"?p.hindiSourceEnabled:undefined,player:{preferredAudioLanguage:pick(player.preferredAudioLanguage,["sub","dub","hindi"]),defaultQuality:str(player.defaultQuality),autoEnableSubtitles:typeof player.autoEnableSubtitles==="boolean"?player.autoEnableSubtitles:undefined,subtitleLanguage:str(player.subtitleLanguage)}}}}
const access=x=>typeof x==="string"&&x.length>=20&&x.length<=8192&&!/[\s\r\n]/.test(x);
async function verifyAccounts(a){const out={};if(a?.anilist){const t=a.anilist.accessToken;if(!access(t))throw Error("Invalid account");const r=await fetch("https://graphql.anilist.co",{method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},body:JSON.stringify({query:"query { Viewer { id name avatar { medium large } siteUrl } }"}),signal:AbortSignal.timeout(9000)});const v=(await r.json()).data?.Viewer;if(!r.ok||!v?.id||String(v.id)!==String(a.anilist.userId))throw Error("Invalid account");out.anilist={accessToken:t,profile:v}}
if(a?.myanimelist){const t=a.myanimelist.accessToken;if(!access(t))throw Error("Invalid account");const r=await fetch("https://api.myanimelist.net/v2/users/@me?fields=id,name,picture",{headers:{Authorization:"Bearer "+t},signal:AbortSignal.timeout(9000)});const v=await r.json();if(!r.ok||!v?.id||String(v.id)!==String(a.myanimelist.userId))throw Error("Invalid account");out.myanimelist={accessToken:t,refreshToken:access(a.myanimelist.refreshToken)?a.myanimelist.refreshToken:undefined,profile:{id:v.id,name:v.name,picture:v.picture}}}
if(!Object.keys(out).length)throw Error("Invalid account");return out}
const store=()=>deviceStore(redis,key());
function endCookie(res){if(res){res.setHeader("Set-Cookie",cookie(COOKIE,"",0));res.setHeader("X-AniDash-Paired-Session","ended")}}
export async function browserSession(req,res){
 const id=cookies(req)[COOKIE];if(!id)return null;if(!valid(id)){endCookie(res);return null}
 const k=skey(id),v=await redis("GET",k);if(!v){endCookie(res);return null}
 const s=decrypt(v,k),ds=store(),owner=ds.identity(s.accounts),ttl=await redis("PTTL",k);
 if(ttl<=0){endCookie(res);return null}
 const d=await ds.active(k,owner,device(req),ttl);if(!d){endCookie(res);return null}
 return {...s,deviceRecord:d};
}
async function manage(req,res,action){
 const ds=store(),authorization=req.headers.authorization;
 const native=authorization!==undefined;
 let owner,currentId,token;
 if(native){
  const m=typeof authorization==="string"&&/^Bearer ([0-9a-f]{64})$/.exec(authorization);
  if(!m)return fail(res,401);token=m[1];const auth=await ds.readManagement(token);if(!auth)return fail(res,401);owner=auth.owner;
 }else{
  if(action==="management")return fail(res,401);
  if(req.method!=="GET"&&!originOK(req))return fail(res,403);
  const s=await browserSession(req,res);if(!s)return fail(res,401);owner=s.deviceRecord.owner;currentId=s.deviceRecord.id;
 }
 const count=await redis("EVAL","local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,"anidash:management-rate:"+action+":"+owner);
 if(count>(action==="devices"?60:20))return fail(res,429);
 if(action==="devices")return reply(res,200,{success:true,devices:await ds.list(owner,currentId)});
 if(action==="management"){
  // Token lifecycle is native-only; never return a management credential to a browser context.
  if(req.headers.origin||req.headers["sec-fetch-site"])return fail(res,403);
  if(req.method==="DELETE"){await ds.revokeManagement(token);return reply(res,200,{success:true})}
  const fresh=await ds.rotateManagement(token,owner);return fresh?reply(res,200,{success:true,deviceManagement:fresh}):fail(res,401);
 }
 const id=req.query?.deviceId;if(!validDeviceId(id))return fail(res,404);
 const ok=await ds.revoke(owner,id);if(ok!==1)return fail(res,404);
 if(id===currentId)endCookie(res);
 return reply(res,200,{success:true});
}
export function endpoint(action){return async(req,res)=>{res.setHeader("Cache-Control","no-store, private");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Content-Type-Options","nosniff");try{
const method=({create:"POST",session:"GET",approve:"POST",status:"GET",account:"GET",anilist:"POST",logout:"POST",devices:"GET","device-revoke":"DELETE"})[action];if(action==="management"?!["POST","DELETE"].includes(req.method):req.method!==method)return fail(res,405);
if(["create","anilist","logout"].includes(action)&&!originOK(req))return fail(res,403);
if(!await limit(req,action,req.query?.code))return fail(res,429);
if(["devices","device-revoke","management"].includes(action))return manage(req,res,action);
if(action==="create"){const code=random(16),bind=random(32),expiresAt=Date.now()+PAIR_TTL*1000;const s={state:"pending",expiresAt,bind:hash(bind),device:device(req)};const {default:QRCode}=await import("qrcode");const qr=await QRCode.toDataURL("https://anidashgo.vercel.app/connect?code="+code,{errorCorrectionLevel:"M",margin:4,width:280});const created=await redis("EVAL","if redis.call('EXISTS',KEYS[2])==1 then return 0 end; redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); redis.call('SET',KEYS[2],'1','EX',86400); return 1",2,pkey(code),marker(code),JSON.stringify(s),PAIR_TTL);if(created!==1)return fail(res,503);res.setHeader("Set-Cookie",cookie(BIND,bind,PAIR_TTL));return reply(res,201,{success:true,code,qr,expiresAt:new Date(expiresAt).toISOString()})}
if(action==="logout"){const id=cookies(req)[COOKIE];if(valid(id)){const s=await browserSession(req,res);if(s)await store().revoke(s.deviceRecord.owner,s.deviceRecord.id);else await redis("DEL",skey(id))}endCookie(res);return reply(res,200,{success:true})}
if(action==="account"||action==="anilist"){const s=await browserSession(req,res);if(!s)return fail(res,401);if(action==="account")return reply(res,200,{success:true,accounts:{anilist:s.accounts.anilist?.profile,myanimelist:s.accounts.myanimelist?.profile},sync:s.sync});if(!s.accounts.anilist)return fail(res,401);let b;try{b=body(req)}catch{return fail(res,400)}if(typeof b.query!=="string"||b.query.length>20000)return fail(res,400);const r=await fetch("https://graphql.anilist.co",{method:"POST",headers:{Authorization:"Bearer "+s.accounts.anilist.accessToken,"Content-Type":"application/json"},body:JSON.stringify({query:b.query,variables:b.variables||{}}),signal:AbortSignal.timeout(12000)});const data=await r.json();return reply(res,r.ok?200:r.status===401?401:502,r.ok?{data:data.data,...(data.errors?{errors:[{message:"AniList request failed"}]}:{})}:{error:"AniList request failed"})}
let input;if(action==="approve"){try{input=body(req)}catch{return fail(res,400)}}
const code=action==="approve"?input.code:req.query?.code;if(!valid(code))return fail(res,400);if(action==="approve"&&!await limit(req,"approve-code",code))return fail(res,429);
const s=await read(code);if(!s)return fail(res,await redis("EXISTS",marker(code))?410:400);if(s.expiresAt<=Date.now()||["denied","consumed"].includes(s.state))return fail(res,410);
if(action==="session"){if(s.state!=="pending")return fail(res,410);return reply(res,200,{success:true,session:{device:s.device,expiresAt:new Date(s.expiresAt).toISOString()}})}
if(action==="approve"){if(s.state!=="pending")return fail(res,410);const deny=input.approved===false||input.approve===false||input.denied===true;let encrypted="",mgmt=null;if(!deny){if(input.sync?.schemaVersion!==1||input.client?.platform!=="android")return fail(res,400);let accounts;try{accounts=await verifyAccounts(input.accounts)}catch{return fail(res,400)}encrypted=encrypt({accounts,sync:preferences(input.sync)},pkey(code));if(!req.headers.origin&&!req.headers["sec-fetch-site"]){const ds=store();mgmt=ds.management(ds.identity(accounts))}}const result=await redis("EVAL",transition,2,pkey(code),mgmt?.key||pkey(code),Date.now(),deny?"denied":"approved",encrypted,mgmt?.value||"",MANAGEMENT_TTL);return result===1?reply(res,200,{success:true,...(mgmt?{deviceManagement:{token:mgmt.token,expiresAt:mgmt.expiresAt}}:{})}):fail(res,410)}
if(action==="status"){const bind=cookies(req)[BIND];if(typeof bind!=="string"||hash(bind)!==s.bind)return fail(res,403);if(s.state==="pending")return reply(res,202,{success:true,status:"pending"});const id=random(16),k=skey(id);const data=decrypt(s.encrypted,pkey(code)),ds=store(),payload=encrypt(data,k);const result=await ds.consume({pairKey:pkey(code),sessionKey:k,binding:hash(bind),encrypted:payload,owner:ds.identity(data.accounts),info:s.device,ttl:SESSION_TTL});if(result!==1)return fail(res,result===-2?403:410);res.setHeader("Set-Cookie",[cookie(COOKIE,id,SESSION_TTL),cookie(BIND,"",0)]);return reply(res,200,{success:true,status:"connected"})}
return fail(res,400)
}catch(e){console.warn("[device-pair] "+(e instanceof PairConfigError?e.category:"internal-failure"));return fail(res,503)}}}
