// Report the active stream, never the user's saved server preference.
const sourceId = value => typeof value === "string"
  ? value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)
  : "";

export function activePlaybackMeta(stream, requestedAudio) {
  if (!stream) return undefined;
  const code = typeof stream.lang === "string" ? stream.lang.trim().toLowerCase() : "";
  const explicit = typeof stream.isDub === "boolean" ? stream.isDub : undefined;
  let lang;
  if (/^[a-z]{2,3}-(dub|sub)$/.test(code)) lang = code;
  else if (code === "ja" || explicit === false) lang = "ja-sub";
  else if (/^[a-z]{2,3}$/.test(code) && code !== "en") lang = code + "-dub";
  else if (explicit === true) lang = "en-dub";
  else if (requestedAudio === "dub" || requestedAudio === "sub")
    lang = requestedAudio === "dub" ? "en-dub" : "ja-sub";
  if (!lang) return undefined;
  // Server IDs such as hi-ravok and megaplay-sub encode the selection; the
  // separate language field already conveys that information.
  const raw = sourceId(stream.serverId) || sourceId(stream.server) || sourceId(stream.provider);
  const src = raw.replace(/^(?:hi|ta|te|ml|kn|bn|mr|pa|gu|ur)-/, "").replace(/-(?:sub|dub)$/, "");
  return { lang, ...(src ? { src } : {}) };
}
