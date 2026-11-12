// Public metadata only: AniZip episode artwork/titles with Jikan title/filler fallback.
const cache=new Map(), pending=new Map();
const positive=n=>Number.isSafeInteger(n)&&n>0&&n<=1000000;
const secure=v=>typeof v==="string"&&/^https:\/\//i.test(v)?v:null;
export function normalizeAniZip(data,page){
 const first=(page-1)*100+1,last=page*100;
 return Object.entries(data?.episodes||{}).flatMap(([key,e])=>{
  const n=Number(key);if(!Number.isSafeInteger(n)||n<first||n>last||!e)return [];
  const title=typeof e.title==="string"?e.title:e.title?.en||e.title?.["x-jat"]||e.title?.ja||Object.values(e.title||{}).find(x=>typeof x==="string")||"";
  return [{number:n,title,image:secure(e.image),aired:e.airDate||null}];
 }).sort((a,b)=>a.number-b.number);
}
async function json(url){const r=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(9500)});if(!r.ok)throw Error("Metadata provider unavailable");return r.json()}
async function zip(id,mal){const key="zip:"+(id?"al"+id:"mal"+mal),old=cache.get(key);if(old&&Date.now()-old.at<6*3600000)return old.data;if(pending.has(key))return pending.get(key);const req=json("https://api.ani.zip/mappings?"+(id?"anilist_id="+id:"mal_id="+mal)).then(data=>{if(!data?.episodes||typeof data.episodes!=="object")throw Error("No mapped episodes");if(cache.size>80)cache.delete(cache.keys().next().value);cache.set(key,{at:Date.now(),data});return data}).finally(()=>pending.delete(key));pending.set(key,req);return req}
export default async function handler(req,res){
 if(req.method!=="GET")return res.status(405).json({error:"GET only"});
 const mal=Number(req.query?.id),id=Number(req.query?.anilist),page=Number(req.query?.page||1);
 if((!positive(mal)&&!positive(id))||!Number.isSafeInteger(page)||page<1||page>30)return res.status(400).json({error:"Invalid anime ID or page"});
 const key="page:"+id+":"+mal+":"+page,old=cache.get(key);
 const send=data=>{res.setHeader("Cache-Control","public, s-maxage=1800, stale-while-revalidate=86400");return res.status(200).json({episodes:data})};
 if(old&&Date.now()-old.at<1800000)return send(old.data);
 const [z,j]=await Promise.allSettled([zip(positive(id)?id:0,mal).then(data=>normalizeAniZip(data,page)),positive(mal)?json("https://api.jikan.moe/v4/anime/"+mal+"/episodes?page="+page).then(data=>{if(!Array.isArray(data.data))throw Error("Invalid data");return data.data.filter(e=>Number.isSafeInteger(e.mal_id)).map(e=>({number:e.mal_id,title:e.title||"",aired:e.aired||null,filler:e.filler===true,recap:e.recap===true}))}):Promise.resolve([])]);
 const rows=new Map();if(j.status==="fulfilled")for(const e of j.value)rows.set(e.number,e);if(z.status==="fulfilled")for(const e of z.value){const prior=rows.get(e.number)||{};rows.set(e.number,{...prior,...e,title:e.title||prior.title||"",aired:e.aired||prior.aired||null})}
 const data=[...rows.values()].sort((a,b)=>a.number-b.number);
 if(!data.length&&z.status==="rejected"&&j.status==="rejected"){if(old)return send(old.data);res.setHeader("Cache-Control","no-store");return res.status(503).json({error:"Episode metadata temporarily unavailable"})}
 if(cache.size>100)cache.delete(cache.keys().next().value);cache.set(key,{at:Date.now(),data});return send(data);
}
