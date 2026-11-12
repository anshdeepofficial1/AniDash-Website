// Only convert explicit legal episode URLs returned by AniList, never search or scrape a mirror.
export function youtubeEpisodeEmbed(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    let id;
    if (url.hostname === "youtu.be") id = url.pathname.slice(1);
    else if (["youtube.com","www.youtube.com","m.youtube.com"].includes(url.hostname) && url.pathname === "/watch") id = url.searchParams.get("v");
    else return null;
    return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id)
      ? "https://www.youtube-nocookie.com/embed/" + id + "?playsinline=1&rel=0"
      : null;
  } catch { return null; }
}
