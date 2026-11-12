// Read-only public episode metadata. No video URLs or media extraction.
const cache=new Map();
const inFlight=new Map();
export default async function handler(req,res){
 if(req.method!=="GET")return res.status(405).json({error:"GET only"});
 const id=Number(req.query?.id),page=Number(req.query?.page||1);
 if(!Number.isSafeInteger(id)||id<=0||id>1000000||!Number.isSafeInteger(page)||page<1||page>30)return res.status(400).json({error:"Invalid anime ID or page"});
 const key=id+":"+page;const cached=cache.get(key);
 const send=(data)=>{res.setHeader("Cache-Control","public, s-maxage=3600, stale-while-revalidate=86400");return res.status(200).json({episodes:data})};
 if(cached&&Date.now()-cached.at<3600000)return send(cached.data);
 try{
  if(!inFlight.has(key))inFlight.set(key,(async()=>{const response=await fetch("https://api.jikan.moe/v4/anime/"+id+"/episodes?page="+page,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error("Episode metadata unavailable");const j=await response.json();if(!Array.isArray(j.data))throw Error("Invalid metadata");return j.data.filter(e=>Number.isSafeInteger(e.mal_id)).map(e=>({number:e.mal_id,title:typeof e.title==="string"?e.title:"",aired:e.aired||null,filler:e.filler===true,recap:e.recap===true}))})().finally(()=>inFlight.delete(key)));
  const data=await inFlight.get(key);if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{at:Date.now(),data});return send(data);
 }catch{res.setHeader("Cache-Control","no-store");return res.status(503).json({error:"Episode metadata temporarily unavailable"})}
}
