# AniDash Watch Web

A standalone responsive anime discovery and streaming PWA. This repository is separate from the AniDash Android app and the AniDash download/marketing website.

## Included

- AniList-powered anime discovery, search, rankings, artwork, details and mapped MyAnimeList IDs.
- Three fixed built-in source integrations: JustAnime, HiAnime and AniKoto. Users do not install or import provider extensions.
- Provider-specific search, episode IDs, SUB/DUB choices, server selection and stream resolution.
- JustAnime automatic resolution and its Momo, Zoko, Gigi and Neko server choices.
- HiAnime's legacy API flow plus AniList episode-mapping fallback.
- AniKoto episode-session preservation and server-side Kwik extraction.
- MP4/HLS playback, native HLS on Safari/iPhone, hls.js on supported browsers, subtitle tracks and intro/outro skip metadata.
- Local watchlist and continue-watching history, playback resume and installable PWA shell.

## Vercel deployment

Import this repository as its own Vercel project:

- **Framework preset:** Other
- **Root directory:** repository root (leave blank or use `.`)
- **Build command:** leave empty
- **Output directory:** leave empty
- **Node.js runtime:** Node 20 or newer

The static website is served from the repository root and API routes live in /api. Do not point this project at the Android repository or its website/ folder.

## Catalogue metadata

The app calls the AniList GraphQL API for discovery and anime information. AniList records include a MyAnimeList ID when mapped. AniList is the metadata catalogue; it does not supply episode video files.

## Built-in sources

The provider adapters are fixed in the website code:

- /api/justanime — JustAnime search, paginated episodes, automatic or explicit server selection, SUB/DUB and media URL normalization.
- /api/hianime — HiAnime search, episode API, AniList mapping fallback, server lookup and legacy VidNest resolver.
- /api/anikoto — AniKoto search and release list, composite anime/episode session IDs, SUB/DUB filtering and Kwik stream extraction.
- /api/media — same-origin media relay for explicitly allow-listed hosts only. HLS child playlists and segments are rewritten through the same origin; this is not an open proxy.

The provider sites and their APIs are third-party services. Their availability, domains, response formats, server protection, regional access and CORS behavior can change without notice. A working API response does not guarantee that every returned stream is playable in every browser. If a provider is down, AniDash displays the upstream error and lets the viewer try another built-in source.

### HiAnime availability note

The Android app's HiAnime integration references a legacy API and the original HiAnime website. The original service was reported shut down in March 2026, so this integration is retained for compatibility but must be treated as best-effort until its configured API is confirmed live. A similarly named mirror is not automatically an official replacement.

### Optional Vercel environment variables

- HIANIME_API_URL — override the legacy HiAnime API base URL.
- HIANIME_SITE_URL — override the legacy HiAnime catalogue base URL.
- VIDNEST_SECRET — override the server-side VidNest decryption key.
- ANIKOTO_BASE_URL — override the AniKoto base URL (must be the actual trusted AniKoto host).

Do not put secrets or private API keys in app.js or in any browser-delivered file.

## Player behavior

Browser video elements cannot attach arbitrary Referer or Origin headers. Hosts that require those headers are handled through the restricted /api/media relay when they are on its explicit allow-list. Other HTTPS media URLs are used directly. The player supports HLS on iPhone Safari natively and uses hls.js where available.

## iPhone installation

Open the deployed site in Safari, tap Share, choose **Add to Home Screen**, then Add. The PWA shell can open offline; catalogue requests and streaming require an internet connection.

## Local static preview

Run `python -m http.server 8080` in the repository root and open `http://localhost:8080`. This static preview does not execute Vercel API routes, so source search and streaming must be tested on a Vercel deployment or a local Vercel development environment.

## Current limitations

- Provider APIs are third-party and can stop working or change their response formats. The three adapters are implemented against the Android app's current contracts, but production playback must be verified after Vercel deploy with live upstream services.
- HiAnime is a legacy/best-effort integration because the original service was reported shut down.
- Watchlist and playback progress are stored locally in the browser; account-based AniList/MAL cross-device sync is not implemented.