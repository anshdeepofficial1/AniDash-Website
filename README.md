# AniDash Watch Web

A standalone responsive anime discovery and streaming PWA. This repository is separate from the AniDash Android app and the AniDash download/marketing website.

## User experience

- AniList-powered anime discovery, search, rankings, artwork, details and mapped MyAnimeList IDs.
- Mobile-first home screen with a featured anime hero and swipeable shelves: Continue Watching, Currently Airing, Trending, Popular, Watchlist, Coming Soon, Movies, Top Rated and Hidden Gems.
- Responsive desktop layout plus phone-first Android and iOS PWA layout, safe-area handling, sticky mobile search, bottom navigation and larger touch targets.
- Home-screen shortcuts for Search, Watchlist and Continue Watching.
- Searchable episode lists with 50 episodes per page on anime details, 30 per page in the player, and direct episode-number jump.
- Local watchlist and continue-watching history, resume position, and installable PWA shell.

## Built-in streaming providers

These three fixed source integrations are included. Viewers do not install or import extensions.

- **JustAnime** — AniList numeric ID is used as the canonical anime ID, matching the Android provider. Search/episode requests use the direct API and the existing AniDash relay fallback. The native Automatic mode races the Momo, Zoko, Gigi and Neko server endpoints.
- **HiAnime (legacy/best-effort)** — retains the Android app's legacy API, AniList episode-mapping fallback and VidNest resolver. The original HiAnime operation announced its goodbye in March 2026; similarly named current domains are not assumed to be official replacements. If its legacy resolver fails, the player moves on to other built-in sources.
- **AniKoto** — uses its currently listed official domains (`anikototv.to`, `anikoto.cz`, `anikoto.me`, `anikoto.net`, `anikototv.se`) for catalogue and episode requests. Verified mirrors are raced in parallel. It tries the native Kwik extraction flow and requests the documented partner-embed fallback alongside it when available.

## Playback and media relay

- Player tries all returned server candidates first, then tries the next built-in provider for the same episode.
- SUB/DUB, server and provider changes clear old failure state and start a fresh resolution.
- MP4/HLS playback, native HLS on Safari/iPhone, hls.js on supported browsers, iframe-based partner players, subtitles and intro/outro skip metadata.
- Same-origin `/api/media` relay is restricted to an explicit list of source/CDN hosts. Safe `Referer`, `Origin`, `User-Agent` and `Accept` headers are carried through HLS master playlists, child playlists and segments. Signed media responses are not cached.
- The player has a Retry all built-in sources action after a provider failure.

Provider sites and their APIs are third-party services. Their availability, domains, response formats, anti-bot protections, CDN hosts and browser restrictions can change. A catalogue or stream URL response does not guarantee that the browser can play it. No site can guarantee that every episode is available while upstream services refuse requests.

## Vercel deployment

Import this repository as its own Vercel project:

- **Framework preset:** Other
- **Root directory:** repository root (leave blank or use `.`)
- **Build command:** leave empty
- **Output directory:** leave empty
- **Node.js runtime:** Node 20 or newer

The static website is served from the repository root and serverless API routes live in `/api`. Do not point this project at the Android repository or its `website/` folder.

## Catalogue metadata

The app calls the AniList GraphQL API for discovery and anime information. AniList records include a MyAnimeList ID when mapped. AniList is the metadata catalogue; it does not supply video files.

## API routes

- `/api/justanime` — JustAnime search, full episode list, server catalogue and source resolution.
- `/api/hianime` — legacy HiAnime search/episodes/server/source route and AniList episode-mapping fallback.
- `/api/anikoto` — AniKoto search, paginated episode data, Kwik extraction and partner-embed fallback.
- `/api/media` — restricted same-origin media/HLS relay. This is not an open proxy.

## Optional Vercel environment variables

- `HIANIME_API_URL` — override the legacy HiAnime API base URL.
- `VIDNEST_SECRET` — override the server-side VidNest decryption key if the upstream protocol changes.
- `ANIKOTO_BASE_URL` — prefer one of the official AniKoto domains listed above.
- `JUSTANIME_RELAY_URL` — override the JustAnime relay URL; defaults to the existing AniDash relay.

Do not put secrets or private API keys in `app.js` or in any browser-delivered file.

## iPhone and Android installation

- **iPhone/iPad:** open the site in Safari, tap Share, choose **Add to Home Screen**, then Add.
- **Android:** open in Chrome, use the browser's **Install app** or **Add to Home screen** prompt.

The app uses a standalone display mode, safe-area-aware header and bottom navigation, and a versioned service-worker cache. Catalogue requests and streaming still require an internet connection.

## Local static preview

Run `python -m http.server 8080` in the repository root and open `http://localhost:8080`. This static preview does not execute Vercel API routes, so source search and streaming must be tested on a Vercel deployment or a local Vercel development environment.

## Current limitations

- Actual stream playback depends on third-party sites, their anti-bot protections and their CDN URLs. The website code can preserve source headers and try fallbacks, but it cannot override an upstream outage or a blocked host.
- The original HiAnime operation announced its goodbye in March 2026; its old API and VidNest decryption path are retained only as best-effort compatibility.
- AniKoto's own API documentation notes that its server-side streaming endpoints can be blocked by the source's anti-bot protection. Its iframe partner fallback is also subject to the partner player and browser's embedding policy.
- Watchlist and playback progress are stored locally in the browser; account-based AniList/MAL cross-device sync is not implemented.
