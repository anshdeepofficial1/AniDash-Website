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
async function call(action,{method="GET",code,body,cookie="",ip="198.51.100.1",ua="Mozilla/5.0 (Windows NT 10.0) Chrome/142.0"}={}){const res=fakeResponse();await endpoint(action)({method,query:{code},body,headers:{host:"anidashgo.vercel.app",origin,cookie,"x-vercel-forwarded-for":ip,"user-agent":ua}},res);return res}
const approval=code=>({code,accounts:{anilist:{accessToken:token,userId:"123",username:"Example"}},sync:{schemaVersion:1,preferences:{nativeSource:"hianime",player:{preferredAudioLanguage:"dub"},downloads:{preferredQuality:"1080p"}}},client:{platform:"android"}});
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
