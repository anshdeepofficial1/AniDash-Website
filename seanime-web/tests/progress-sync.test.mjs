import test from "node:test";import assert from "node:assert/strict";
import * as P from "../src/browser/embed-progress.ts";
import * as Q from "../src/browser/sync-queue.ts";
const mp=P.embedCapability("https://megaplay.buzz/stream/ani/21/1/dub");
test("only MegaPlay is trusted, and only from its own origin",()=>{
 assert.ok(mp.progress);assert.equal(P.embedCapability("https://megavid.buzz/x").progress,false);
 const ok={event:"time",time:874,duration:1420,percent:61};
 assert.deepEqual(P.parseEmbedMessage("https://megaplay.buzz",ok,mp),{position:874,duration:1420,ended:false});
 for(const o of["https://evil.example","http://megaplay.buzz","https://megaplay.buzz.evil.com","*","null"])assert.equal(P.parseEmbedMessage(o,ok,mp),null,o);
 assert.equal(P.parseEmbedMessage("https://megavid.buzz",ok,P.embedCapability("https://megavid.buzz/a")),null);
 assert.equal(P.parseEmbedMessage("https://megaplay.buzz",ok,null),null);
});
test("schema validation, JSON strings, watching-log, complete",()=>{
 const o="https://megaplay.buzz";
 assert.equal(P.parseEmbedMessage(o,JSON.stringify({event:"time",time:5,duration:10}),mp).position,5);
 assert.deepEqual(P.parseEmbedMessage(o,{type:"watching-log",currentTime:100,duration:1400},mp),{position:100,duration:1400,ended:false});
 assert.equal(P.parseEmbedMessage(o,{event:"complete"},mp).ended,true);
 for(const bad of[{event:"time",time:-1,duration:10},{event:"time",time:"5",duration:10},{event:"time",time:50,duration:10},{event:"time",time:1,duration:0},{event:"x"},null,[],"not json",{event:"time",time:NaN,duration:5},{event:"time",time:1,duration:1e9}])assert.equal(P.parseEmbedMessage(o,bad,mp),null,JSON.stringify(bad));
 assert.equal(P.parseEmbedMessage(o,{event:"time",time:1400,duration:1420},mp).ended,true);
});
const mem=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)}};
const it=(o={})=>({mediaId:21,episode:445,position:877,duration:1420,ended:false,at:1000,session:"s",platform:"web",...o});
test("queue keeps newest per media and survives reload",()=>{
 Q.useQueueStore(mem());Q.enqueue(it({at:1}));Q.enqueue(it({at:5,position:9}));Q.enqueue(it({at:3,position:1}));
 assert.equal(Q.pending().length,1);assert.equal(Q.pending()[0].position,9);
});
test("stale queued writes are dropped; newer-local writes applied; rewinds respected",()=>{
 assert.equal(Q.decide(it({at:10_000}),20_000),"drop");
 assert.equal(Q.decide(it({at:10_000}),10_500),"apply");
 assert.equal(Q.decide(it({at:10_000}),null),"apply");
 assert.equal(Q.decide(it({at:10_000,position:60}),5_000),"apply");
});
test("flush sends, drops stale, stops offline and keeps data",async()=>{
 Q.useQueueStore(mem());Q.enqueue(it({mediaId:1,at:100}));Q.enqueue(it({mediaId:2,at:100}));
 const sent=[];let r=await Q.flush(async i=>{sent.push(i.mediaId)},async id=>id===2?999_999:0);
 assert.deepEqual(sent,[1]);assert.equal(r.dropped,1);assert.equal(Q.pending().length,0);
 Q.enqueue(it({mediaId:3,at:100}));r=await Q.flush(async()=>{throw new Error("offline")},async()=>0);
 assert.equal(r.failed,1);assert.equal(Q.pending().length,1);
 r=await Q.flush(async()=>{},async()=>null);assert.equal(r.sent,1);assert.equal(Q.pending().length,0);
});
