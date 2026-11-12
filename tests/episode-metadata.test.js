import test from "node:test";
import assert from "node:assert/strict";
import handler,{normalizeAniZip} from "../api/episode-metadata.js";
test("AniZip maps numbered regular episodes, English titles and secure artwork, not specials",()=>{
 const data={episodes:{"1":{title:{en:"I'm Luffy!",ja:"タイトル"},image:"https://example.org/e1.jpg"},"S1":{title:{en:"Special"}},"101":{title:{en:"Next arc"},image:"http://invalid.example"}}};
 assert.deepEqual(normalizeAniZip(data,1),[{number:1,title:"I'm Luffy!",image:"https://example.org/e1.jpg",aired:null}]);
 assert.deepEqual(normalizeAniZip(data,2),[{number:101,title:"Next arc",image:null,aired:null}]);
});
test("episode metadata merges artwork and Jikan filler classification",async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes("ani.zip")?{episodes:{"1":{title:{en:"Episode title"},image:"https://example.org/1.jpg"}}}:{data:[{mal_id:1,title:"Alternate title",filler:true,recap:false}]}});
  const res={setHeader(){},status(n){this.statusCode=n;return this},json(data){this.data=data;return this}};
  await handler({method:"GET",query:{anilist:"21",id:"21",page:"1"}},res);
  assert.equal(res.statusCode,200);assert.equal(res.data.episodes[0].title,"Episode title");assert.equal(res.data.episodes[0].image,"https://example.org/1.jpg");assert.equal(res.data.episodes[0].filler,true);
 }finally{globalThis.fetch=original}
});
