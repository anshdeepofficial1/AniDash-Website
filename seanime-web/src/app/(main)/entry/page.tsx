import React from "react"
import { AnimeEntryPage } from "@/app/(main)/entry/_containers/anime-entry-page"
import { useSearchParams } from "@/lib/navigation"
import { useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { BrowserEpisodes } from "@/browser/episodes"
import { PageWrapper } from "@/components/shared/page-wrapper"
export default function Page(){const params=useSearchParams();const episode=params.get("episode");return episode!==null?<WatchPage id={params.get("id")} episode={Number(episode)}/>:<AnimeEntryPage/>}
function WatchPage({id,episode}:{id:string|null;episode:number}){const q=useGetAnimeEntry(id);if(q.isPending&&!q.data)return <PageWrapper className="p-6">Loading player…</PageWrapper>;if(!q.data)return <PageWrapper className="p-6"><p role="alert">Could not load this title.</p><button onClick={()=>q.refetch()}>Retry</button></PageWrapper>;if(!Number.isInteger(episode)||episode<1||episode>(q.data.episodes?.length||0))return <PageWrapper className="p-6"><p>This episode has not been released or does not exist.</p><a href={"/entry?id="+id}>Back to details</a></PageWrapper>;return <PageWrapper className="w-full"><BrowserEpisodes key={id} entry={q.data} watchEpisode={episode}/></PageWrapper>}
