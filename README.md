# AniDash Watch Web

A standalone responsive anime discovery and streaming PWA. This repository is separate from the AniDash Android app and the AniDash download/marketing website.

## Included

- AniList-powered anime discovery, search, rankings, artwork, details and mapped MyAnimeList IDs.
- Three fixed built-in source integrations: JustAnime, HiAnime and AniKoto. Users do not install or import provider extensions.
- Provider-specific search, episode IDs, SUB/DUB choices, server selection and stream resolution.
- Automatic provider failover: if a source resolver or returned video fails, AniDash tries the next built-in source for the same episode.
- JustAnime direct AniList-ID lookup, direct/relay API requests, automatic server selection and its Momo, Zoko, Gigi and Neko server choices.
- HiAnime legacy API and AniList episode-mapping fallback. The legacy VidNest resolver remains best-effort; failed decryption no longer needs to stop the player from trying other providers.
- AniKoto episode-session preservation and Kwik extraction, with a partner-embed fallback when the site's server-side session/AJAX route is blocked.
- Searchable episode lists with 50 episodes per page on details, 30 per page in the player, and direct episode-number jump.
- MP4/HLS playback, native HLS on Safari/iPhone, hls.js on supported browsers, iframe-based partner players, subtitle tracks and intro/outro skip metadata.
- Local watchlist and continue-watching history, playback resume and installable PWA shell.

## Vercel deployment

Import this repository as its own Vercel project:

- **Framework preset:** Other
- **Root directory:** repository root (leave blank or use `.`)
- **Build command:** leave empty
- **Output directory:** leave empty
- **Node.js runtime:** Node 20 or newer

The static website is served from the repository root and API routes live in `/api`. Do not point this project at the Android repository or its `website/` folder.

## Catalogue metadata

The app calls the AniList GraphQL API for discovery and anime information. AniList records include a MyAnimeList ID when mapped. AniList is the metadata catalogue; it does not supply video files.

## Built-in sources

The provider adapters are fixed in the website code:

- `/api/justanime` — JustAnime search, paginated episodes, direct-ID lookup, direct/relay requests, Automatic or explicit server selection, SUB/DUB and media URL normalization.
- `/api/hianime` — HiAnime search, episode API, AniList mapping fallback, server lookup and legacy VidNest resolver. The legacy decryption path is best-effort; player-level failover attempts other sources when it cannot resolve.
- `/api/anikoto` — AniKoto search and release list, composite anime/episode session IDs, SUB/DUB filtering and Kwik extraction. If the native server-side flow is blocked, the route can request iframe-ready partner links from AniKotoAPI.
- `/api/media` — same-origin media relay for explicitly allow-listed hosts only. HLS child playlists and segments are rewritten through the same origin; this is not an open proxy.

The provider sites and their APIs are third-party services. Their availability, domains, response formats, server protection, regional access and CORS behavior can change without notice. An API returning a URL does not guarantee that every browser can play it. AniDash attempts the other configured built-in providers when one source fails, and displays an error when no source returns a usable player.

## Episode navigation

Long episode lists are not rendered as one huge page. Anime details show 50 episodes per page; the player sidebar shows 30 per page. Both lists support text search, first/previous/next/last page controls and direct episode-number jump.

## Optional Vercel environment variables

- `HIANIME_API_URL` — override the legacy HiAnime API base URL.
- `HIANIME_SITE_URL` — override the legacy HiAnime catalogue base URL.
- `VIDNEST_SECRET` — override the server-side VidNest decryption key.
- `ANIKOTO_BASE_URL` — override the AniKoto base URL (must be the actual trusted AniKoto host).
- `JUSTANIME_RELAY_URL` — override the JustAnime relay URL; defaults to the existing AniDash relay.

Do not put secrets or private API keys in `app.js` or in any browser-delivered file.

## iPhone installation

Open the deployed site in Safari, tap Share, choose **Add to Home Screen**, then Add. The PWA shell can open offline; catalogue requests and streaming require an internet connection.

## Local static preview

Run `python -m http.server 8080` in the repository root and open `http://localhost:8080`. This static preview does not execute Vercel API routes, so source search and streaming must be tested on a Vercel deployment or a local Vercel development environment.

## Current limitations

- Provider APIs and embeds are third-party. They can stop working, change formats or refuse datacenter traffic; no code can guarantee every episode is streamable while those upstream services are unavailable.
- HiAnime's encrypted VidNest fallback can fail when its upstream encryption protocol/secret changes. The website tries other built-in sources rather than claiming that HiAnime worked.
- AniKoto's partner embeds are third-party iframe players and have their own availability and browser restrictions.
- Watchlist and playback progress are stored locally in the browser; account-based AniList/MAL cross-device sync is not implemented.
