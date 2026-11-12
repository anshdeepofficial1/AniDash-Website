// SPDX-License-Identifier: GPL-3.0-only
// Browser transport for original Seanime screens. Public metadata is fetched
// from AniList; lists and preferences belong to the current browser only.
// No Go server, shared administrator, fake streaming provider or hosted files.
import { DEFAULT_HOME_ITEMS } from "@/app/(main)/_features/home/home-items.utils"
import { THEME_DEFAULT_VALUES } from "@/lib/theme/theme-hooks"
const BROWSER_HOME_ITEMS=[
 {id:"discover-header",type:"discover-header",schemaVersion:1},
 {id:"anime-continue-watching",type:"anime-continue-watching",schemaVersion:1},
 {id:"trending",type:"anime-carousel",schemaVersion:3,options:{name:"Trending right now",sorting:"TRENDING_DESC"}},
 {id:"aired-recently",type:"aired-recently",schemaVersion:1},
 {id:"popular",type:"anime-carousel",schemaVersion:3,options:{name:"Popular anime",sorting:"POPULARITY_DESC"}},
 {id:"top-rated",type:"anime-carousel",schemaVersion:3,options:{name:"Top rated",sorting:"SCORE_DESC"}},
 {id:"upcoming",type:"anime-carousel",schemaVersion:3,options:{name:"Coming soon",sorting:"POPULARITY_DESC",status:["NOT_YET_RELEASED"]}},
 {id:"movies",type:"anime-carousel",schemaVersion:3,options:{name:"Anime movies",sorting:"TRENDING_DESC",format:"MOVIE"}},
 {id:"anime-library",type:"anime-library",schemaVersion:1,options:{statuses:["CURRENT","PAUSED","PLANNING","COMPLETED","DROPPED"],layout:"grid"}}
]
const STORAGE="anidash.watch.web.v1"
const w=window as any
const read=()=>{try{return JSON.parse(localStorage.getItem(STORAGE)||"{}")}catch{return {}}}
function save(s:any){s.updatedAt=Date.now();localStorage.setItem(STORAGE,JSON.stringify(s));w.AniDashStorage?.save(s).catch(()=>{});}
const fields="id idMal siteUrl status season type format seasonYear bannerImage episodes synonyms isAdult countryOfOrigin meanScore averageScore description genres duration trailer{id site thumbnail} title{english native romaji userPreferred} coverImage{color extraLarge large medium} startDate{day month year} endDate{day month year} nextAiringEpisode{airingAt episode timeUntilAiring}"
const mangaFields="id idMal siteUrl status type format bannerImage chapters volumes synonyms isAdult countryOfOrigin meanScore description genres title{english native romaji userPreferred} coverImage{color extraLarge large medium} startDate{day month year} endDate{day month year}"
const mem=new Map<string,{at:number,value:any}>(),pending=new Map<string,Promise<any>>()
async function gql(query:string,variables:any={}){
 const key=JSON.stringify([query,variables]),cached=mem.get(key);if(cached&&Date.now()-cached.at<240000)return cached.value;
 if(pending.has(key))return pending.get(key);
 const p=(async()=>{const r=await fetch("https://graphql.anilist.co",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok||j.errors||!j.data)throw new Error(r.status===429?"AniList is rate limited. Try again shortly.":j.errors?.[0]?.message||"AniList metadata unavailable");mem.set(key,{at:Date.now(),value:j.data});return j.data})().finally(()=>pending.delete(key));pending.set(key,p);return p
}
function settings(){const s=read();return {id:1,library:{torrentProvider:"none",libraryPath:"",enableManga:s.preferences?.showMangaTab!==false,enableOnlinestream:false,disableAnimeCardTrailers:false},torrent:{defaultTorrentClient:"none"},anilist:{blurAdultContent:true},mediaPlayer:{},nakama:{enabled:false},autoDownloader:{enabled:false}}}
export function browserStatus(){return {os:"browser",clientDevice:"browser",clientPlatform:"web",clientUserAgent:navigator.userAgent,dataDir:"",version:"2.0.0",versionName:"AniDash Browser",settings:settings(),themeSettings:{...THEME_DEFAULT_VALUES,id:1,...read().seanimeTheme},isOffline:false,anilistClientId:"",updating:false,isDesktopSidecar:false,disabledFeatures:["ManageExtensions","OpenInExplorer","TorrentStreaming","DebridStreaming","ManageDebrid","ManageAutoDownloader","ViewAutoDownloader","ManageNakama","PushRequests"],serverReady:true,serverHasPassword:false,showChangelogTour:"",user:w.AniDashAccount?.currentUser?.()?{viewer:w.AniDashAccount.currentUser(),token:"",isSimulated:false}:undefined}}
function listData(s:any,id:number){const entry=s.watchlist?.[id];if(!entry)return undefined;return {status:s.libraryStatuses?.[id]||"PLANNING",progress:Math.max(0,(s.history?.[id]?.episode||1)-1)}}
function localLists(){const s=read(),groups=new Map<string,any[]>();for(const m of Object.values(s.watchlist||{}) as any[]){if(!m?.id)continue;const d=listData(s,m.id)!;const rows=groups.get(d.status)||[];rows.push({id:m.id,media:m,mediaId:m.id,...d,listData:d});groups.set(d.status,rows)}return [...groups].map(([status,entries])=>({name:status,status,type:status,entries}))}
async function media(id:number){return (await gql("query($id:Int!){Media(id:$id,type:ANIME,isAdult:false){"+fields+" streamingEpisodes{title thumbnail url site} externalLinks{id site url type}}}",{id})).Media}
export async function list(d:any={},type="ANIME"){const query="query($page:Int,$perPage:Int,$search:String,$sort:[MediaSort],$status:[MediaStatus],$genres:[String],$tags:[String],$score:Int,$season:MediaSeason,$year:Int,$format:MediaFormat,$country:CountryCode){Page(page:$page,perPage:$perPage){pageInfo{currentPage hasNextPage lastPage perPage total} media(type:"+type+",isAdult:false,search:$search,sort:$sort,status_in:$status,genre_in:$genres,tag_in:$tags,averageScore_greater:$score,season:$season,seasonYear:$year,format:$format,countryOfOrigin:$country){"+(type==="ANIME"?fields:mangaFields)+"}}}";return gql(query,{page:d.page||1,perPage:Math.min(50,d.perPage||20),search:d.search||undefined,sort:d.sort,status:d.status,genres:d.genres,tags:d.tags,score:d.averageScore_greater,season:d.season,year:Number(d.seasonYear||d.year)||undefined,format:d.format,country:d.countryOfOrigin})}
async function airing(d:any={}){return gql("query($page:Int,$perPage:Int,$after:Int,$before:Int,$future:Boolean,$sort:[AiringSort]){Page(page:$page,perPage:$perPage){pageInfo{currentPage hasNextPage lastPage perPage total} airingSchedules(airingAt_greater:$after,airingAt_lesser:$before,notYetAired:$future,sort:$sort){id airingAt episode timeUntilAiring media{"+fields+"}}}}",{page:d.page||1,perPage:Math.min(50,d.perPage||20),after:d.airingAt_greater,before:d.airingAt_lesser,future:d.notYetAired,sort:d.sort})}
function episodeRows(m:any){const count=m.status==="NOT_YET_RELEASED"?0:m.status==="RELEASING"&&m.nextAiringEpisode?.episode?Math.max(0,m.nextAiringEpisode.episode-1):m.episodes||0;return Array.from({length:Math.min(3000,count)},(_,i)=>({type:"main",displayTitle:"Episode "+(i+1),episodeTitle:"",episodeNumber:i+1,absoluteEpisodeNumber:i+1,progressNumber:i+1,isDownloaded:false,isInvalid:false,_isNakamaEpisode:false,baseAnime:m}))}
const supported=(e:string)=>["/api/v1/status","/api/v1/settings","/api/v1/anilist/list-anime","/api/v1/anilist/list-recent-anime","/api/v1/anilist/collection","/api/v1/anilist/collection/raw","/api/v1/anilist/list-entry","/api/v1/library/collection","/api/v1/library/unknown-media","/api/v1/manga/anilist/collection","/api/v1/manga/anilist/collection/raw","/api/v1/manga/list-manga","/api/v1/manga/anilist/list","/api/v1/library/schedule","/api/v1/anilist/cache-layer/status","/api/v1/manga/collection"].includes(e)||/^\/api\/v1\/(anilist\/media-details|library\/anime-entry|anime\/episode-collection)\/\d+$/.test(e)||e.includes("/home-items")
export const browserSupports=supported
export async function browserRequest(endpoint:string,method:string,data:any,params:any):Promise<any>{
 const d={...params,...data},s=read(),id=Number(endpoint.split("/").pop());
 if(endpoint==="/api/v1/status")return browserStatus();
 if(endpoint==="/api/v1/settings"&&method==="GET")return settings();
 if(endpoint==="/api/v1/anilist/list-anime")return list(d);
 if(endpoint==="/api/v1/manga/list-manga"||endpoint==="/api/v1/manga/anilist/list")return list(d,"MANGA");
 if(endpoint==="/api/v1/anilist/cache-layer/status"){try{await gql("query { Media(id:1){id} }");return true}catch{return false}}
 if(endpoint==="/api/v1/library/schedule"){const entries=await browserSchedule(true);return entries.map((a:any)=>({mediaId:a.media.id,title:a.media.title?.userPreferred||a.media.title?.english||a.media.title?.romaji,image:a.media.coverImage?.large,dateTime:new Date(a.airingAt*1000).toISOString(),episodeNumber:a.episode,isMovie:a.media.format==="MOVIE",isSeasonFinale:a.episode===a.media.episodes}))}
 if(endpoint==="/api/v1/manga/collection")return {lists:await mangaLists()};
 if(endpoint==="/api/v1/anilist/list-recent-anime"){const a=await airing(d);a.Page.airingSchedules=a.Page.airingSchedules.filter((x:any)=>x.media&&!x.media.isAdult);return a}
 if(endpoint==="/api/v1/anilist/collection"||endpoint==="/api/v1/anilist/collection/raw")return {MediaListCollection:{lists:await combinedLists()}};
 if(endpoint==="/api/v1/library/collection"){const lists=localLists();return {lists,continueWatchingList:[],stats:{totalEntries:lists.reduce((n,l)=>n+l.entries.length,0),totalFiles:0,totalShows:0,totalMovies:0,totalSpecials:0,totalSize:"0 B"}}}
 if(endpoint==="/api/v1/manga/anilist/collection"||endpoint==="/api/v1/manga/anilist/collection/raw")return {MediaListCollection:{lists:await mangaLists()}};
 if(endpoint.includes("/home-items")){if(method==="POST"){if(!Array.isArray(d.items))throw Error("Invalid home layout");save({...s,homeItems:d.items});return null}return Array.isArray(s.homeItems)&&s.homeItems.length?s.homeItems:BROWSER_HOME_ITEMS;}
 if(/^\/api\/v1\/anilist\/media-details\/\d+$/.test(endpoint))return media(id);
 if(/^\/api\/v1\/library\/anime-entry\/\d+$/.test(endpoint)){const m=await media(id);if(!m)throw new Error("Anime not found");const episodes=episodeRows(m);return {mediaId:id,media:m,listData:listData(s,id),episodes,localFiles:[],currentEpisodeCount:episodes.length,anidbId:0,_isNakamaEntry:false}}
 if(/^\/api\/v1\/anime\/episode-collection\/\d+$/.test(endpoint)){const m=await media(id);return {hasMappingError:false,episodes:episodeRows(m)}}
 if(endpoint==="/api/v1/library/unknown-media"||endpoint==="/api/v1/anilist/list-entry"){const ids=endpoint.endsWith("unknown-media")?d.mediaIds:[d.mediaId||d.id];s.watchlist||={};s.libraryStatuses||={};for(const raw of ids||[]){const id=Number(raw);if(!Number.isInteger(id)||id<=0)throw new Error("Invalid anime ID");const m=await media(id);if(!m)throw new Error("Anime not found");s.watchlist[id]=m;s.libraryStatuses[id]=d.status||"PLANNING";}save(s);return true}
 throw new Error("This feature is not available in AniDash Go")
}

export function browserPreferences(){return read().preferences||{}}
export function setBrowserPreference(key:string,value:any){const s=read();save({...s,preferences:{...s.preferences,[key]:value}})}
function groupEntries(entries:any[]){const groups=new Map<string,any[]>();for(const e of entries){if(!e?.media?.id)continue;const status=e.status||"PLANNING";const rows=groups.get(status)||[];rows.push({...e,media:{...e.media,title:{...e.media.title,userPreferred:e.media.title?.userPreferred||e.media.title?.english||e.media.title?.romaji}},listData:{status,progress:e.progress||0}});groups.set(status,rows)}return [...groups].map(([status,entries])=>({name:status,status,type:status,entries}))}
async function combinedLists(){const rows=localLists().flatMap(g=>g.entries);if(w.AniDashAccount?.authenticated?.()){try{const remote=await w.AniDashAccount.list();const merged=new Map(rows.map((e:any)=>[e.media.id,e]));for(const e of remote)if(e.media?.id)merged.set(e.media.id,e);return groupEntries([...merged.values()])}catch{}}return groupEntries(rows)}
export async function mangaLists(){const rows=Object.values(read().mangaList||{}) as any[];if(w.AniDashAccount?.authenticated?.()){try{const remote=await w.AniDashAccount.listManga();const merged=new Map(rows.map(e=>[e.media.id,e]));for(const e of remote)if(e.media?.id)merged.set(e.media.id,e);return groupEntries([...merged.values()])}catch{}}return groupEntries(rows)}
export async function saveBrowserManga(m:any){const s=read();s.mangaList||={};s.mangaList[m.id]={id:m.id,mediaId:m.id,media:m,status:"PLANNING",progress:0};save(s);if(w.AniDashAccount?.authenticated?.())await w.AniDashAccount.saveManga(m.id,0)}
export async function browserSchedule(personal=false,offset=0){const start=new Date();start.setHours(0,0,0,0);start.setDate(start.getDate()+offset*7);const end=new Date(start);end.setDate(end.getDate()+7);const ids=personal?(await combinedLists()).filter(g=>["CURRENT","PLANNING","REPEATING","PAUSED"].includes(g.status)).flatMap(g=>g.entries.map((e:any)=>e.media.id)):null;if(ids&&!ids.length)return [];const query="query($page:Int,$after:Int,$before:Int,$ids:[Int]){Page(page:$page,perPage:50){pageInfo{hasNextPage} airingSchedules(airingAt_greater:$after,airingAt_lesser:$before,mediaId_in:$ids,sort:[TIME]){id airingAt episode media{"+fields+"}}}}";const rows:any[]=[];for(let page=1;page<=12;page++){const a=await gql(query,{page,after:Math.floor(start.getTime()/1000)-1,before:Math.floor(end.getTime()/1000),ids:ids||undefined});rows.push(...a.Page.airingSchedules.filter((x:any)=>x.media&&!x.media.isAdult));if(!a.Page.pageInfo.hasNextPage)break}return rows.sort((a,b)=>a.airingAt-b.airingAt)}
