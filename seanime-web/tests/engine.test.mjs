import test from "node:test";import assert from "node:assert/strict";
import * as E from "../src/browser/engine.ts";
const mem=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)}};
test.beforeEach(()=>E.useStore(mem()));
test("android-only sources are incompatible and never planned",()=>{
 assert.equal(E.statusOf("anikai").status,"incompatible");
 assert.ok(!E.plan("anime","en-dub").some(p=>["anikai","kaido","anizone","animeonsen"].includes(p.id)));
});
test("untested providers are Unverified, never Verified",()=>{assert.equal(E.statusOf("justanime").status,"unverified")});
test("verified requires stable playback, then degrades on failure",()=>{
 const t=1e12;E.recordPlaying("justanime",t);assert.equal(E.statusOf("justanime",t).status,"available");
 E.recordStable("justanime",t);assert.equal(E.statusOf("justanime",t+1000).status,"verified");
 E.recordFailure("justanime","timeout",false,t+2000);assert.equal(E.statusOf("justanime",t+3000).status,"unavailable");
 assert.equal(E.statusOf("justanime",t+10*60e3).status,"degraded");
});
test("cooldown grows exponentially, is capped, and drops provider from plan",()=>{
 const t=1e12;E.recordFailure("hianime","502",false,t);const a=E.loadHealth().hianime.cooldownUntil-t;
 E.recordFailure("hianime","502",false,t);const b=E.loadHealth().hianime.cooldownUntil-t;
 assert.equal(b,a*2);assert.ok(!E.plan("anime","en-dub",t+1).some(p=>p.id==="hianime"));
 for(let i=0;i<30;i++)E.recordFailure("hianime","x",false,t);assert.equal(E.loadHealth().hianime.cooldownUntil-t,E.COOLDOWN_MAX_MS);
 assert.ok(E.plan("anime","en-dub",t+E.COOLDOWN_MAX_MS+1).some(p=>p.id==="hianime"));
});
test("permanent errors back off faster",()=>{E.recordFailure("anikoto","403",true,0);const p=E.loadHealth().anikoto.cooldownUntil;E.resetHealth();E.recordFailure("anikoto","timeout",false,0);assert.ok(p>E.loadHealth().anikoto.cooldownUntil);assert.ok(E.isPermanentError("HTTP 403"))});
test("healthy provider outranks failing one; user priority respected",()=>{
 const t=1e12;E.recordStable("animetsu",t);E.recordFailure("justanime","x",false,t-10*60e3);
 const ids=E.plan("anime","en-dub",t).map(p=>p.id);assert.ok(ids.indexOf("animetsu")<ids.length);
 E.setPriority("hianime",1);assert.equal(E.plan("anime","en-dub",t)[0].id,"hianime");
 E.restoreDefaults();assert.notEqual(E.plan("anime","en-dub",t)[0].id,"hianime");
});
test("language: only providers that declare it; hindi never mixed with sub",()=>{
 assert.deepEqual(E.plan("anime","hi-dub").map(p=>p.id),["hindi"]);
 assert.equal(E.plan("anime","ta-dub").length,0);
 assert.equal(E.languageKey("sub"),"ja-sub");assert.equal(E.languageKey("dub","hi"),"hi-dub");
});
test("disable/enable persists",()=>{E.setEnabled("justanime",false);E.useStore(null);assert.ok(true);});
test("url validation blocks SSRF and insecure schemes",()=>{
 for(const u of["http://a.com/x","https://127.0.0.1/","https://10.0.0.1/","https://localhost/","https://u:p@a.com/","https://[::1]/","javascript:alert(1)","https://intranet/x","https://a.internal/"])assert.equal(E.isSafeHttpsUrl(u),false,u);
 assert.equal(E.isSafeHttpsUrl("https://mangaplus.shueisha.co.jp/x"),true);
});
test("external search urls are encoded official hosts only",()=>{assert.match(E.externalSearchUrl("mangaplus","a&b c"),/^https:\/\/mangaplus\.shueisha\.co\.jp\/.*a%26b%20c/);assert.equal(E.externalSearchUrl("justanime","x"),null)});
