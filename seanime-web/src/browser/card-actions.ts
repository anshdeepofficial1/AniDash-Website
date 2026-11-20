import { persistPlayback, readWatchState, saveWatchState, syncPlayback } from "./resume"

const account = () => (window as any).AniDashAccount

export const LIST_STATUSES: [string, string][] = [
  ["CURRENT", "Watching"],
  ["PLANNING", "Planning to watch"],
  ["COMPLETED", "Completed"],
  ["PAUSED", "On hold"],
  ["DROPPED", "Dropped"],
  ["REPEATING", "Rewatching"],
]

export function localListStatus(id: number): string | undefined {
  return (readWatchState() as any).libraryStatuses?.[id]
}

/** Saves the status on this device and, when AniList is connected, on AniList too. */
export async function setListStatus(media: any, status: string) {
  const s: any = readWatchState()
  saveWatchState({ ...s, watchlist: { ...s.watchlist, [media.id]: media }, libraryStatuses: { ...s.libraryStatuses, [media.id]: status } })
  if (account()?.authenticated?.()) await account().setStatus(media.id, status)
}

export async function removeFromList(media: any) {
  const s: any = readWatchState()
  const watchlist = { ...s.watchlist }; delete watchlist[media.id]
  const libraryStatuses = { ...s.libraryStatuses }; delete libraryStatuses[media.id]
  saveWatchState({ ...s, watchlist, libraryStatuses })
  if (account()?.authenticated?.()) await account().deleteEntry(media.id)
}

/** Hides the card until the viewer watches something new (it comes back automatically then). */
export function hideFromContinueWatching(media: any, episode: number) {
  const s: any = readWatchState()
  saveWatchState({ ...s, continueHidden: { ...s.continueHidden, [media.id]: { episode, at: Date.now() } } })
}

export function markEpisodeWatched(media: any, episode: number) {
  persistPlayback(media, episode, 1, 1, true)
  void syncPlayback(media, episode, 1, 1, true).catch(() => {})
}

export function restartEpisode(media: any, episode: number) {
  persistPlayback(media, episode, 0, 0, false)
}
