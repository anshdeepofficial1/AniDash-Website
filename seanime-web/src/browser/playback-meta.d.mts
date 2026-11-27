export function activePlaybackMeta(
  stream: {lang?: string; isDub?: boolean; serverId?: string; server?: string; provider?: string} | null | undefined,
  requestedAudio?: "sub" | "dub"
): {lang: string; src?: string} | undefined;
