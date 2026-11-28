export type Metadata = {
  number: number
  title: string
  image?: string
  aired?: string
  filler?: boolean
  recap?: boolean
}

const metadataCache = new Map<string, Metadata[]>()
const metadataPending = new Map<string, Promise<Metadata[]>>()
const metadataStoragePrefix = "anidash.episodes.v2:"
export function cachedEpisodePage(id: number, page: number): Metadata[] | undefined {
  const key = id + ":" + page
  const memory = metadataCache.get(key)
  if (memory) return memory
  try {
    const item = JSON.parse(localStorage.getItem(metadataStoragePrefix + key) || "null")
    if (item && Date.now() - item.at < 7 * 86400000 && Array.isArray(item.episodes)) {
      metadataCache.set(key, item.episodes)
      return item.episodes
    }
  } catch {}
}
export function loadEpisodePage(id: number, mal: number, page: number, fast = true, force = false): Promise<Metadata[]> {
  const key = id + ":" + page
  const old = cachedEpisodePage(id, page)
  if (old?.length && !force) return Promise.resolve(old)
  const pending = metadataPending.get(key)
  if (pending) return pending
  const request = fetch("/api/episode-metadata?anilist=" + id + "&id=" + mal + "&page=" + page + (fast ? "&fast=1" : ""), { signal: AbortSignal.timeout(12000) })
    .then(async response => {
      if (!response.ok) throw Error("Metadata unavailable")
      const items = (await response.json()).episodes
      if (!Array.isArray(items) || !items.length) throw Error("Episode metadata empty")
      const byNumber = new Map<number, Metadata>((old || []).map(item => [item.number, item]))
      for (const item of items as Metadata[]) {
        const prior = byNumber.get(item.number)
        byNumber.set(item.number, { ...prior, ...item, title: item.title || prior?.title || "", image: item.image || prior?.image })
      }
      const merged = [...byNumber.values()]
      if (metadataCache.size >= 120) metadataCache.delete(metadataCache.keys().next().value!)
      metadataCache.set(key, merged)
      try {
        localStorage.setItem(metadataStoragePrefix + key, JSON.stringify({ at: Date.now(), episodes: merged }))
        const keys = Object.keys(localStorage).filter(k => k.startsWith(metadataStoragePrefix))
        while (keys.length > 50) localStorage.removeItem(keys.shift()!)
      } catch {}
      return merged
    }).finally(() => metadataPending.delete(key))
  metadataPending.set(key, request)
  return request
}
export function cachedEpisodeMetadata(id: number, pages: number[]) {
  return Object.fromEntries(pages.flatMap(page => cachedEpisodePage(id, page) || []).map(item => [item.number, item])) as Record<number, Metadata>
}
export function prefetchEpisodeMetadata(media: {id:number;idMal?:number|null},episode=1){
 if(!Number.isSafeInteger(media.id)||media.id<=0)return
 const page=Math.max(1,Math.ceil(episode/100))
 if(page<=30)void loadEpisodePage(media.id,media.idMal||0,page,true).catch(()=>{})
}
