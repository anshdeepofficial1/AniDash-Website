# AniDash Watch Web

A standalone responsive anime discovery and streaming PWA. This repository is separate from the AniDash Android app and the AniDash download/marketing website.

## User experience

- AniList-powered anime discovery, search, rankings, artwork, details and mapped MyAnimeList IDs.
- Mobile-first Home screen with a trending spotlight cycling every 2 seconds, manual controls, and shelves for Currently Airing, Trending, Popular, Watchlist, Coming Soon, Movies, Top Rated and Hidden Gems. Each View All opens its own paginated section; Trending uses a ranked list like Android.
- Responsive desktop and mobile PWA with **Montserrat** typography matching the Android app, faithful season/movie badges (S1/S2/M/OVA/SP), and consistent premium SVG icons for Home/Discover/Manga/Library/Account.
- Home-screen shortcuts for Search, Watchlist and Account.
- Searchable episode lists with 50 episodes per page on anime details, 30 per page in the player, and direct episode-number jump.
- Continue Watching shelf and seven library tabs: Watching, Completed, On Hold, Plan to Watch, Dropped, Repeating, Favorites. Local watchlist/history stored in localStorage and IndexedDB. Manga discovery and on-device CBZ reading.

## Built-in streaming providers

These three fixed source integrations are included. Viewers do not install or import extensions.

- **JustAnime** — Uses AniList numeric IDs as the canonical anime IDs, matching the Android provider. Search and paginated episode requests use the same API contract as the Android source. Automatic playback races Momo, the default endpoint, Zoko, Gigi and Neko; direct API and relay requests now race rather than waiting for a full timeout.
- **HiAnime (legacy/best-effort)** — retains the Android app's legacy API and VidNest resolver. Numeric AniList IDs are validated correctly, and AniList/AniZip episode mapping is used even when another provider has already returned an episode list. The original HiAnime operation announced its goodbye in March 2026; similarly named current domains are not assumed to be official replacements.
- **AniKoto** — uses the current `AniKotoAPI` search and episode contract where available, with legacy website mirrors and Kwik extraction as compatibility paths. If AniKoto's session/AJAX endpoints fail, AniDash constructs its documented MegaPlay, AniXo and Megavid iframe URLs locally from AniList/MAL IDs, so the shared hosted AniKoto API is not a single point of failure.

## Playback and media relay

- Player defaults to English DUB and resolves JustAnime, HiAnime and AniKoto in parallel. Direct HLS/MP4 sources are preferred, with iframe players used as a fallback after a short grace period. SUB remains available as a manual choice. AniKoto constructs its partner iframe URLs locally without waiting on the shared API. JustAnime and HiAnime can use AniList episode-number mappings when their own episode APIs are down.
- SUB/DUB, server and provider changes clear old failure state and start a fresh resolution.
- MP4/HLS playback, native HLS on Safari/iPhone, hls.js on supported browsers, iframe-based partner players, subtitles and intro/outro skip metadata.
- Same-origin `/api/media` relay is restricted to an explicit list of source/CDN hosts. JustAnime follows the same two-hop `neko.justanime.to/m3u8-proxy` flow as the Android web relay; the relay carries safe `Referer`, `Origin`, `User-Agent` and `Accept` headers through HLS master playlists, child playlists, segments and keys. Other built-in providers use the restricted direct relay. Signed media responses are not cached.
- The player has a Retry all built-in sources action after a provider failure. Web settings let users choose preferred SUB/DUB, quality, source priority, subtitles, intro skip, appearance and layout.

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
- `/api/hianime` — legacy HiAnime search/episodes/server/source route and best-effort VidNest resolver.
- `/api/episode-map` — standalone AniList-to-episode metadata mapping via Ani-Zip, independent of the legacy HiAnime API.
- `/api/anikoto` — AniKoto search, paginated episode data, Kwik extraction and partner-embed fallback.
- `/api/media` — restricted same-origin media/HLS relay. This is not an open proxy.

## AniList account setup (required for cloud login)

AniDash Watch supports official AniList OAuth (implicit flow) and optional sync of the watchlist and completed episodes. Guest lists do **not** require login and use localStorage plus an IndexedDB recovery copy. Users can export/import JSON backups from Settings.

**One-time setup by the website owner:**

1. Go to AniList **Developer Settings → Create New Application**.
2. Name it **AniDash Watch**. Register the exact redirect URL `https://anidash-watch.vercel.app/` (including the trailing slash).
3. Copy the **Client ID** (not the Client Secret).
4. In the AniDash Watch Vercel project, set environment variable `ANILIST_WEB_CLIENT_ID` to that numeric Client ID for Production and Preview environments as appropriate.
5. Redeploy. Check `https://anidash-watch.vercel.app/api/auth-config`; its response must show `"enabled":true`. Then visit the live website, select **Account → Continue with AniList**, and approve the official AniList authorization screen.

The OAuth state is validated before accepting a callback. AniDash never asks for AniList passwords; the user’s token is stored in browser localStorage so login survives a reload. Users should sign out of shared computers. **Exact playback timestamps are synchronized through AniList notes when available**. The app reads/writes the Android-compatible `shx:ep=381&sec=300&dur=1440` tag, preserving other user notes. Browser settings and local-only data are not synchronized. Import of existing cloud entries merges rather than deletes local watchlist items. Deleting a local title doesn't automatically delete an AniList entry; removal from AniList Planning prompts for confirmation.

No supported external OAuth APIs for JustAnime/HiAnime/AniKoto website account sessions were established. **Do not enter passwords for streaming sites into AniDash.** JustAnime advertises no sign-up required and optional AniList/MAL sync; the original HiAnime.to shut down in March 2026. Do not assume similarly branded sites share its accounts.

## MyAnimeList sign-in setup (independent of AniList)

MyAnimeList (MAL) is a separate OAuth provider and requires a different registered MAL application. An AniList Client ID/Secret **cannot** activate MAL login.

1. Register the **AniDash Watch** web app on the official MyAnimeList API application dashboard and configure its exact redirect URL `https://anidash-watch.vercel.app/`.
2. In the Vercel project, configure `MAL_WEB_CLIENT_ID` and, if required by the MAL client configuration, **server-only** `MAL_WEB_CLIENT_SECRET`. Never add either secret to `app.js` or GitHub. The web page receives only the public ID; the token exchange takes place on `/api/mal-token` using authorization-code + PKCE.
3. Redeploy, open `/api/mal-config`, check `"enabled":true`, then open **Account → Continue with MyAnimeList** and approve authorization on the official MAL site.
4. Import the MAL list and sync watched-episode counts. MAL's current Android integration does **not** upload exact paused-seconds notes; for native-player 5-minute handoff use AniList on both devices.

**Cross-device exact resume**: On Android, enable AniList authentication and Tracking & Sync, then watch an episode in a supported player. The app writes `shx:ep=<episode>&sec=<seconds>&dur=<duration>` to AniList tracking notes. On the website, connect the same AniList account and sync; Continue Watching restores the episode and native video playback automatically seeks to the saved position when the stream loads. Cross-origin iframe players do not expose a seekable HTML video element, so AniDash cannot guarantee exact-time resume on those external players. AniList sync may be delayed by offline/background tracking on Android.

**Manga**: Browse/search the AniList Manga catalogue and see details. Where verified publisher reading links exist, open the licensed publisher directly; users can also open their own CBZ files locally and have their page number saved. The current web Manga implementation is not the complete Android extension-based chapter scraper/reader.

## Optional Vercel environment variables

- `ANILIST_WEB_CLIENT_ID` — public numeric OAuth client ID, required for AniList account login. Never configure the client secret in the browser.
- `MAL_WEB_CLIENT_ID` — public web client ID from MyAnimeList (separate from AniList).
- `MAL_WEB_CLIENT_SECRET` — optional/when required MAL OAuth secret; Vercel server-only, never exposed in frontend.
- `HIANIME_API_URL` — override the legacy HiAnime API base URL.
- `VIDNEST_SECRET` — override the server-side VidNest decryption key if the upstream protocol changes.
- `ANIKOTO_API_URL` — override the current AniKotoAPI base URL (defaults to `https://anikototvapi.vercel.app/api`).
- `ANIKOTO_BASE_URL` — override a legacy AniKoto website mirror used only as a fallback.
- `JUSTANIME_RELAY_URL` — override the JustAnime JSON relay endpoint; the endpoint must support the `?path=` passthrough contract.

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
- AniKoto's API documentation notes that its AJAX-dependent server/stream endpoints can be blocked by anti-bot protection. The current direct embed provider route avoids that AJAX path, but iframe playback is still subject to each partner player and browser embedding policy.
- If AniList has no episode count and Ani-Zip has no episode mapping, AniDash cannot generate a reliable episode list for that title.
- Local watchlists and playback positions remain in browser storage; wiping browser data can remove unsynced positions. Use Settings → Export JSON. AniList and MyAnimeList web login are available only after their corresponding OAuth application and Vercel environment variables have been configured and redeployed; real-provider sign-in needs testing with an authorized account. Streaming-provider account login is not supported.
- **Security**: The browser stores the OAuth tokens in localStorage; signing out clears them. This is not equivalent to server-side HttpOnly session storage. Do not run unknown third-party scripts or extensions in the website; protect the production host from XSS. For a broader multi-user service, migrate to Authorization Code + server-side sessions.
