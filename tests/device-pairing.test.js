import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { endpoint } from "../server/device-pair.js";
const hash=s=>createHash("sha256").update(s).digest("hex");
const redis=(...args)=>JSON.parse(execFileSync("redis-cli",["-p",process.env.TEST_REDIS_PORT||"6379","--json",...args.map(String)],{encoding:"utf8"}));
const origin="https://anidashgo.vercel.app";
const token="server-only-"+randomBytes(30).toString("hex");
function fakeResponse(){return {headers:{},statusCode:0,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(x){this.data=x;return this}}}
async function call(action,{method="GET",code,body,cookie="",ip="198.51.100.1",ua="Mozilla/5.0 (Windows NT 10.0) Chrome/142.0",authorization,deviceId,requestOrigin=origin}={}){const res=fakeResponse();await endpoint(action)({method,query:{code,deviceId},body,headers:{host:"anidashgo.vercel.app",...(requestOrigin?{origin:requestOrigin}:{}),...(authorization?{authorization}:{}),cookie,"x-vercel-forwarded-for":ip,"user-agent":ua}},res);return res}
const approval=code=>({code,accounts:{anilist:{accessToken:token,userId:"123",username:"Example"}},sync:{schemaVersion:1,preferences:{nativeSource:"hianime",player:{preferredAudioLanguage:"dub"},downloads:{preferredQuality:"1080p"}}},client:{platform:"android",manufacturer:"Samsung",model:"Galaxy M36 5G",androidVersion:"16",sdkInt:36,appVersion:"3.3.10",buildNumber:"3031000"}});
for (const [urlKey,tokenKey] of [["UPSTASH_REDIS_REST_URL","UPSTASH_REDIS_REST_TOKEN"],["KV_REST_API_URL","KV_REST_API_TOKEN"]]) test("five minute pairing, atomic redemption, server-only credentials, denial and rate limit ("+urlKey+")",async()=>{
 process.env.DEVICE_PAIR_ENCRYPTION_KEY=randomBytes(32).toString("base64");
 for(const k of ["UPSTASH_REDIS_REST_URL","UPSTASH_REDIS_REST_TOKEN","KV_REST_API_URL","KV_REST_API_TOKEN"])delete process.env[k];
 process.env[urlKey]="https://redis.test";
 process.env[tokenKey]="test";
 const original=global.fetch;
 global.fetch=async(url,opts={})=>{
  if(url==="https://redis.test"){assert.equal(opts.headers.Authorization,"Bearer test");const cmd=JSON.parse(opts.body);return Response.json({result:redis(...cmd)})}
  if(url==="https://graphql.anilist.co"){assert.equal(opts.headers.Authorization,"Bearer "+token);return Response.json({data:{Viewer:{id:123,name:"Example"}}})}
  throw Error("Unexpected upstream");
 };
 try{
  redis("FLUSHDB");
  const created=await call("create",{method:"POST"});assert.equal(created.statusCode,201);
  const {code,expiresAt,qr}=created.data;
  assert.match(code,/^[0-9a-f]{32}$/);assert.match(qr,/^data:image\/png;base64,/);
  assert.ok(Date.parse(expiresAt)-Date.now()<=300000&&Date.parse(expiresAt)-Date.now()>290000);
  const binding=created.headers["Set-Cookie"].split(";")[0];assert.match(created.headers["Set-Cookie"],/Secure; HttpOnly; SameSite=Strict/);
  const inspected=await call("session",{code});assert.equal(inspected.statusCode,200);assert.equal(inspected.data.session.device.browser,"Chrome 142");assert.equal(inspected.data.session.device.os,"Windows");assert.doesNotMatch(JSON.stringify(inspected.data),/198\.51\.100\.1|fingerprint|server-only/);
  assert.equal((await call("status",{code,cookie:binding})).statusCode,202);
  assert.equal((await call("status",{code})).statusCode,403);
  assert.equal((await call("approve",{method:"POST",body:approval(code)})).statusCode,200);
  const raw=redis("GET","anidash:pair:"+hash(code));assert.doesNotMatch(raw,/server-only/);
  assert.equal((await call("session",{code})).statusCode,410);
  const results=await Promise.all([call("status",{code,cookie:binding}),call("status",{code,cookie:binding})]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,410]);
  const ok=results.find(r=>r.statusCode===200),cookie=ok.headers["Set-Cookie"][0].split(";")[0];assert.match(ok.headers["Set-Cookie"][0],/Secure; HttpOnly; SameSite=Strict/);assert.doesNotMatch(JSON.stringify(ok.data),/server-only/);
  assert.equal(redis("EXISTS","anidash:pair:"+hash(code)),0);
  assert.equal((await call("approve",{method:"POST",body:approval(code)})).statusCode,410);
  const account=await call("account",{cookie});assert.equal(account.statusCode,200);assert.equal(account.data.accounts.anilist.id,123);assert.equal(account.data.sync.preferences.nativeSource,"hianime");assert.equal(account.data.sync.preferences.downloads,undefined);assert.doesNotMatch(JSON.stringify(account.data),/server-only|accessToken|refreshToken/);
  assert.equal((await call("logout",{method:"POST",cookie})).statusCode,200);assert.equal((await call("account",{cookie})).statusCode,401);
  const denied=await call("create",{method:"POST"});const d=denied.data.code;
  assert.equal((await call("approve",{method:"POST",body:{code:d,approved:false}})).statusCode,200);
  assert.equal((await call("status",{code:d,cookie:denied.headers["Set-Cookie"].split(";")[0]})).statusCode,410);
  const expired=await call("create",{method:"POST"});redis("DEL","anidash:pair:"+hash(expired.data.code));assert.equal((await call("session",{code:expired.data.code})).statusCode,410);
  assert.equal((await call("session",{code:"bad"})).statusCode,400);
  for(let i=0;i<9;i++){const r=await call("create",{method:"POST",ip:"198.51.100.9"});assert.equal(r.statusCode,i===8?429:201)}
 }finally{global.fetch=original}
});

import authConfig from "../api/auth-config.js";
import { readFileSync } from "node:fs";
test("pairing runs inside auth-config (Vercel Hobby 12-function limit) and every public path is rewritten", () => {
  const rewrites = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url))).rewrites;
  for (const a of ["create", "session", "approve", "status", "account", "anilist", "logout"]) {
    assert.ok(rewrites.some(r => r.source === "/api/device-pair/" + a && r.destination === "/api/auth-config?pair=" + a), a);
  }
  const out = {}; const res = { setHeader() {}, status(c) { out.code = c; return this }, json(b) { out.body = b; return this }, end() {} };
  authConfig({ method: "GET", query: { pair: "nope" }, headers: {} }, res);
  assert.equal(out.code, 404);
  authConfig({ method: "GET", query: {}, headers: {} }, res);
  assert.equal(out.code, 200);
});


test("paired device management: isolated identities, active time, revocation, token rotation and expiry", async()=>{
 process.env.DEVICE_PAIR_ENCRYPTION_KEY=randomBytes(32).toString("base64");
 process.env.UPSTASH_REDIS_REST_URL="https://redis.test";
 process.env.UPSTASH_REDIS_REST_TOKEN="test";
 const original=global.fetch, originalNow=Date.now;
 const secret2="other-tracker-secret-"+randomBytes(30).toString("hex");
 let offset=0;Date.now=()=>originalNow()+offset;
 global.fetch=async(url,opts={})=>{
  if(url==="https://redis.test")return Response.json({result:redis(...JSON.parse(opts.body))});
  if(url==="https://graphql.anilist.co"){
   const id=opts.headers.Authorization==="Bearer "+token?123:opts.headers.Authorization==="Bearer "+secret2?456:null;
   return Response.json({data:{Viewer:{id,name:"Example "+id}}});
  }
  throw Error("Unexpected upstream");
 };
 const native=(action,managementToken,opts={})=>call(action,{requestOrigin:null,authorization:"Bearer "+managementToken,...opts});
 async function pairFor(id,secret,ip){
  const created=await call("create",{method:"POST",ip});
  assert.equal(created.statusCode,201);
  const code=created.data.code,binding=created.headers["Set-Cookie"].split(";")[0];
  const payload=approval(code);payload.accounts.anilist={accessToken:secret,userId:String(id)};
  const approve=await call("approve",{method:"POST",body:payload,requestOrigin:null,ip});
  assert.equal(approve.statusCode,200);const management=approve.data.deviceManagement;
  assert.match(management.token,/^[0-9a-f]{64}$/);assert.ok(Date.parse(management.expiresAt)>Date.now());
  assert.doesNotMatch(JSON.stringify(approve.data),/server-only|other-tracker-secret|accessToken|refreshToken/);
  assert.equal((await call("approve",{method:"POST",body:payload,requestOrigin:null,ip})).statusCode,410);
  const logged=await call("status",{code,cookie:binding,ip});assert.equal(logged.statusCode,200);
  assert.doesNotMatch(JSON.stringify(logged.data),/deviceManagement|accessToken|refreshToken/);
  return {cookie:logged.headers["Set-Cookie"][0].split(";")[0],management};
 }
 try{
  redis("FLUSHDB");
  const a=await pairFor(123,token,"198.51.100.10"),b=await pairFor(123,token,"198.51.100.11"),other=await pairFor(456,secret2,"198.51.100.12");
  const list=await native("devices",a.management.token);
  assert.equal(list.statusCode,200);assert.equal(list.data.devices.length,2);
  assert.ok(list.data.devices.every(d=>!d.current&&/^[0-9a-f-]{36}$/.test(d.id)));
  assert.equal(list.data.devices[0].approvedBy.name,"Samsung Galaxy M36 5G");
  assert.equal(list.data.devices[0].approvedBy.appVersion,"3.3.10");
  assert.doesNotMatch(JSON.stringify(list.data),/server-only|accessToken|refreshToken|sessionHash|owner|198\.51\.100|deviceManagement/);
  const browser=await call("devices",{cookie:a.cookie});
  assert.equal(browser.statusCode,200);assert.equal(browser.data.devices.filter(d=>d.current).length,1);
  const current=browser.data.devices.find(d=>d.current);
  const second=browser.data.devices.find(d=>!d.current);
  const alien=(await native("devices",other.management.token)).data.devices[0];
  assert.equal((await native("device-revoke",a.management.token,{method:"DELETE",deviceId:alien.id})).statusCode,404);
  assert.equal((await native("device-revoke",other.management.token,{method:"DELETE",deviceId:current.id})).statusCode,404);
  assert.equal((await call("device-revoke",{method:"DELETE",deviceId:second.id,cookie:a.cookie,requestOrigin:"https://attacker.example"})).statusCode,403);
  offset=240000;
  const before=(await call("devices",{cookie:a.cookie})).data.devices.find(d=>d.current);
  assert.equal(before.lastActiveAt,current.lastActiveAt);
  offset=301000;
  const after=(await call("devices",{cookie:a.cookie})).data.devices.find(d=>d.current);
  assert.ok(Date.parse(after.lastActiveAt)>Date.parse(before.lastActiveAt));
  assert.equal((await native("device-revoke",a.management.token,{method:"DELETE",deviceId:second.id})).statusCode,200);
  assert.equal((await native("device-revoke",a.management.token,{method:"DELETE",deviceId:second.id})).statusCode,200);
  const revoked=await call("account",{cookie:b.cookie});assert.equal(revoked.statusCode,401);
  assert.equal(revoked.headers["X-AniDash-Paired-Session"],"ended");assert.match(revoked.headers["Set-Cookie"],/Max-Age=0/);
  assert.equal((await native("devices",a.management.token)).data.devices.length,1);
  assert.equal((await native("devices","f".repeat(64))).statusCode,401);
  const claimed=await call("management",{method:"POST",requestOrigin:null,body:{accounts:{anilist:{accessToken:token,userId:"123"}},client:approval("unused").client}});
  assert.equal(claimed.statusCode,200);
  assert.match(claimed.data.deviceManagement.token,/^[0-9a-f]{64}$/);
  assert.equal((await native("devices",claimed.data.deviceManagement.token)).statusCode,200);
  const rotated=await native("management",a.management.token,{method:"POST"});assert.equal(rotated.statusCode,200);
  assert.equal((await native("devices",a.management.token)).statusCode,401);
  assert.equal((await native("devices",rotated.data.deviceManagement.token)).statusCode,200);
  assert.equal((await native("management",rotated.data.deviceManagement.token,{method:"DELETE"})).statusCode,200);
  assert.equal((await native("devices",rotated.data.deviceManagement.token)).statusCode,401);
  assert.equal((await call("logout",{method:"POST",cookie:a.cookie})).statusCode,200);
  assert.equal((await native("devices",b.management.token)).data.devices.length,0);
  offset=31*86400000;
  assert.equal((await native("devices",other.management.token)).statusCode,401);
 }finally{Date.now=originalNow;global.fetch=original}
});
