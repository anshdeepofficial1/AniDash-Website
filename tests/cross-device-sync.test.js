import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const aniSource = readFileSync(new URL("../anilist-account.js", import.meta.url), "utf8");
const malSource = readFileSync(new URL("../mal-account.js", import.meta.url), "utf8");
const onePiece = { id: 21, idMal: 1000, title: { english:"One Piece" },
  coverImage:{large:"https://example.org/poster.jpg"}, episodes: 2000, format:"TV" };
const cloudEntry = { id: 8, mediaId:21, status:"CURRENT", progress:380, updatedAt:1000,
  notes:"shx:ep=381&sec=300&dur=1440\nMy personal note", media:onePiece };

function store(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => map.get(key) || null,
    setItem: (key, value) => map.set(key,String(value)),
    removeItem: key => map.delete(key),
    map
  };
}

function aniHarness() {
  const localStorage = store({ "anidash.watch.anilist.token":"test-access-token" });
  const queries = [];
  const fetch = async (url, options) => {
    if (url === "/api/auth-config") return {ok:true,json:async()=>({enabled:true,clientId:"12345"})};
    assert.equal(url,"https://graphql.anilist.co");
    const body = JSON.parse(options.body);
    queries.push(body);
    if (body.query.includes("Viewer { id")) return {
      ok:true,json:async()=>({data:{Viewer:{id:1,name:"OnePieceFan"}}})
    };
    if (body.query.includes("MediaListCollection")) return {
      ok:true,json:async()=>({data:{MediaListCollection:{lists:[{entries:[cloudEntry]}]}}})
    };
    if (body.query.includes("SaveMediaListEntry")) return {
      ok:true,json:async()=>({data:{SaveMediaListEntry:{
        ...cloudEntry,progress:body.variables.progress,notes:body.variables.notes,updatedAt:1100
      }}})
    };
    throw Error("Unexpected AniList GraphQL request");
  };
  const window = {};
  vm.runInNewContext(aniSource,{ window,localStorage,sessionStorage:store(),URLSearchParams,
    location:{ hash:"#/home" },history:{replaceState(){}},fetch,crypto:{getRandomValues:()=>{}},console });
  return {client:window.AniDashAccount,queries};
}

test("Android shx notes resolve One Piece episode 381 at exactly 5m",async()=>{
  const {client} = aniHarness();
  await client.init(); await client.list();
  const tag = client.parseWatchNotes(cloudEntry.notes);
  assert.equal(tag.episode,381);
  assert.equal(tag.seconds,300);
  const resume = client.resumeFromEntry(client.getEntry(21),2000);
  assert.equal(resume.episode,381);
  assert.equal(resume.seconds,300);
  assert.equal(resume.duration,1440);
});

test("Exact 16-minute resume on episode 1 from phone notes is resolved accurately", () => {
  const {client} = aniHarness();
  const testEntry = {
    mediaId: 100,
    status: "CURRENT",
    progress: 0,
    notes: "shx:ep=1&sec=960&dur=1440",
    media: { id: 100, episodes: 12 }
  };
  const resume = client.resumeFromEntry(testEntry, 12);
  assert.equal(resume.episode, 1);
  assert.equal(resume.seconds, 960);
  assert.equal(resume.duration, 1440);
});

test("AniDash Watch writes Android-compatible notes while preserving other notes",async()=>{
  const {client,queries}=aniHarness();
  await client.init(); await client.list();
  const result=await client.syncPosition(21,381,330,1440,false);
  assert.equal(result.progress,380);
  const mutation=queries.find(item=>item.query.includes("SaveMediaListEntry"));
  assert.equal(mutation.variables.progress,380);
  assert.equal(mutation.variables.status,"CURRENT");
  assert.match(mutation.variables.notes,/shx:ep=381&sec=330&dur=1440/);
  assert.match(mutation.variables.notes,/My personal note/);
  assert.equal(client.resumeFromEntry(client.getEntry(21),2000).seconds,330);
});

function malHarness() {
  const localStorage=store(),sessionStorage=store();
  const history={replaceState(_s,_u,path){location.search="";location.hash="#/account";}};
  const location={origin:"https://anidash-watch.vercel.app",pathname:"/",search:"",hash:"#/account",
    assign(url){location.outgoing=url}};
  const requests=[];
  const fetch=async(url,opts={})=>{
    requests.push({url,opts});
    if(url==="/api/mal-config") return {ok:true,json:async()=>({enabled:true,clientId:"testMALClient123456789"})};
    if(url==="/api/mal-token") {
      const payload=JSON.parse(opts.body);
      assert.match(payload.code_verifier,/^[0-9a-f]{96}$/);
      return {ok:true,json:async()=>({access_token:"a".repeat(100),refresh_token:"b".repeat(100),expires_in:3600})};
    }
    if(url.startsWith("/api/mal-data?action=profile")) return {ok:true,json:async()=>({id:100,name:"MALFan"})};
    if(url.startsWith("/api/mal-data?action=list")) return {ok:true,json:async()=>({data:[
      {node:{id:1000,title:"One Piece"},list_status:{status:"watching",num_episodes_watched:380}}
    ],paging:{}})};
    throw Error("Unexpected MAL URL "+url);
  };
  const window={};
  const crypto={getRandomValues(bytes){bytes.forEach((_,i)=>bytes[i]=(i+2)%255);return bytes;}};
  vm.runInNewContext(malSource,{window,location,history,localStorage,sessionStorage,crypto,fetch,URLSearchParams,Date,Uint8Array,console});
  return {client:window.AniDashMal,localStorage,sessionStorage,location,requests};
}

test("MAL sign-in redirects to official PKCE site and exchanges only after state match",async()=>{
  const h=malHarness();
  await h.client.beginLogin();
  const url=new URL(h.location.outgoing);
  assert.equal(url.origin,"https://myanimelist.net");
  assert.equal(url.searchParams.get("code_challenge_method"),"plain");
  assert.equal(url.searchParams.get("response_type"),"code");
  const state=url.searchParams.get("state");
  h.location.search="?code=real-code&state="+state;
  assert.equal(await h.client.captureRedirect(),"success");
  const user=await h.client.init();
  assert.equal(user.name,"MALFan");
  const entries=await h.client.list();
  assert.equal(entries[0].list_status.num_episodes_watched,380);
  h.client.logout();
  assert.equal(h.client.authenticated(),false);
});

test("MAL invalid OAuth state is rejected without calling token exchange",async()=>{
  const h=malHarness();
  await h.client.beginLogin();
  h.location.search="?code=bad-code&state=wrong";
  assert.equal(await h.client.captureRedirect(),"invalid");
  assert.equal(h.requests.filter(item=>item.url==="/api/mal-token").length,0);
});

test("first playback sync fetches existing Android notes before writing",async()=>{const {client,queries}=aniHarness();await client.init();await client.syncPosition(21,381,345,1440,false);const mutation=queries.find(q=>q.query.includes("SaveMediaListEntry"));assert.equal(mutation.variables.progress,380);assert.match(mutation.variables.notes,/shx:ep=381&sec=345&dur=1440/);assert.match(mutation.variables.notes,/My personal note/);});
