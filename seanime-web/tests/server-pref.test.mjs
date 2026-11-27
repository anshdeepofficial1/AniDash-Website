import test from "node:test";import assert from "node:assert/strict";
import * as S from "../src/browser/server-pref.ts";
const mem=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)}};
test.beforeEach(()=>S.useServerPrefStore(mem()));
const valid=k=>["momo","onyx","gigi"].includes(k);
test("native pick is remembered per audio and survives reload",()=>{
 assert.equal(S.preferredNative("dub",valid,"momo"),"momo");
 S.rememberNative("dub","onyx");S.rememberNative("sub","gigi");
 assert.equal(S.preferredNative("dub",valid,"momo"),"onyx");assert.equal(S.preferredNative("sub",valid,"momo"),"gigi");
 assert.equal(S.loadServerPref().mode,"native");
});
test("removed/invalid server falls back to default",()=>{S.rememberNative("dub","local-source:gone");assert.equal(S.preferredNative("dub",valid,"momo"),"momo")});
test("embed pick matches same player next episode and never crosses language",()=>{
 S.rememberEmbed({serverId:"ravok",name:"Ravok",lang:"hi",audio:"dub"});
 const pref=S.loadServerPref();
 const eps=[{serverId:"megaplay-dub",server:"MegaPlay",isDub:true},{serverId:"ravok",server:"Ravok",lang:"hi"}];
 assert.equal(S.pickEmbed(pref,"dub",eps).serverId,"ravok");
 assert.equal(S.pickEmbed(pref,"dub",[eps[0]]),null);          // Hindi missing -> no silent switch to English embed
 S.rememberEmbed({serverId:"megaplay-dub",name:"MegaPlay",lang:"en",audio:"dub"});
 assert.equal(S.pickEmbed(S.loadServerPref(),"sub",eps),null);   // audio differs
 assert.equal(S.pickEmbed(S.loadServerPref(),"dub",eps).serverId,"megaplay-dub");
});
test("choosing a native server after an embed returns to native mode",()=>{S.rememberEmbed({lang:"hi",audio:"dub",name:"X"});S.rememberNative("dub","momo");assert.equal(S.pickEmbed(S.loadServerPref(),"dub",[{lang:"hi",server:"X"}]),null)});
test("corrupt storage is ignored",()=>{const m=mem();m.setItem("anidash.server-pref.v1","{bad");S.useServerPrefStore(m);assert.equal(S.preferredNative("dub",valid,"momo"),"momo");m.setItem("anidash.server-pref.v1",JSON.stringify({mode:"embed",embed:{lang:"<script>",audio:"dub"}}));assert.equal(S.loadServerPref().embed,null)});
