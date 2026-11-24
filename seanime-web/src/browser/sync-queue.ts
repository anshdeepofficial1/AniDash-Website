// Offline-safe playback sync queue. Keeps only the newest item per media and never lets a stale
// queued write overwrite something another device saved later.

export type QueueItem = { mediaId: number; episode: number; position: number; duration: number; ended: boolean; at: number; session: string; platform: string }
export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void }
const KEY = "anidash.sync.queue.v1"
const SKEW_MS = 2000
export const SESSION = Math.random().toString(36).slice(2, 10)

const mem = (): Store | null => { try { return typeof localStorage !== "undefined" ? localStorage : null } catch { return null } }
let store: Store | null = null
export const useQueueStore = (s: Store | null) => { store = s }
const st = () => store || mem()

export function pending(): QueueItem[] {
  try { const v: any = JSON.parse(st()?.getItem(KEY) || "[]"); return Array.isArray(v) ? (v.filter((x: any) => x && Number.isFinite(x.mediaId) && Number.isFinite(x.at)) as QueueItem[]) : [] } catch { return [] }
}
function write(items: QueueItem[]) { try { st()?.setItem(KEY, JSON.stringify(items.slice(0, 60))) } catch { /* ignore */ } }
export function enqueue(item: QueueItem) {
  const rest = pending().filter(x => x.mediaId !== item.mediaId)
  const prev = pending().find(x => x.mediaId === item.mediaId)
  if (prev && prev.at > item.at) return
  write([item, ...rest])
}
export function dequeue(mediaId: number, upToAt: number) { write(pending().filter(x => !(x.mediaId === mediaId && x.at <= upToAt))) }

/** Apply only when no other device wrote after this action. A deliberate rewind is applied like any other newer write. */
export function decide(item: QueueItem, remoteUpdatedAtMs: number | null): "apply" | "drop" {
  return remoteUpdatedAtMs != null && remoteUpdatedAtMs > item.at + SKEW_MS ? "drop" : "apply"
}

let flushing = false
export async function flush(send: (i: QueueItem) => Promise<unknown>, remoteUpdatedAt: (mediaId: number) => Promise<number | null>): Promise<{ sent: number; dropped: number; failed: number }> {
  const r = { sent: 0, dropped: 0, failed: 0 }
  if (flushing) return r
  flushing = true
  try {
    for (const item of pending().sort((a, b) => a.at - b.at)) {
      try {
        const verdict = decide(item, await remoteUpdatedAt(item.mediaId))
        if (verdict === "apply") { await send(item); r.sent++ } else r.dropped++
        dequeue(item.mediaId, item.at)
      } catch { r.failed++; break }   // still offline: keep the rest for later
    }
  } finally { flushing = false }
  return r
}
