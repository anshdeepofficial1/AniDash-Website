# AniDash Watch Web

A standalone responsive anime discovery and streaming PWA. This repository is separate from the AniDash Android app and the AniDash download/marketing website.

## User experience

- AniList-powered anime discovery, search, rankings, artwork, details and mapped MyAnimeList IDs.
- Mobile-first home screen with a featured anime hero and swipeable shelves: Currently Airing, Trending, Popular, Watchlist, Coming Soon, Movies, Top Rated and Hidden Gems.
- Responsive desktop layout plus phone-first Android and iOS PWA layout, safe-area handling, sticky mobile search, bottom navigation and larger touch targets.
- Home-screen shortcuts for Search, Watchlist and Account.
- Searchable episode lists with 50 episodes per page on anime details, 30 per page in the player, and direct episode-number jump.
- Persistent local watchlist, last watched episode and playback position without a visible Continue Watching shelf, plus an installable PWA shell.

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

The OAuth state is validated before accepting a callback. AniDash never asks for AniList passwords; the user’s token is stored in browser localStorage so login survives a reload. Users should sign out of shared computers. Cross-device playback timestamps and settings are not synchronized; AniList tracks anime-list status and episode progress. Import of existing cloud entries merges rather than deletes local watchlist items. Deleting a local title doesn't automatically delete an AniList entry; removal from AniList Planning prompts for confirmation.

No supported external OAuth APIs for JustAnime/HiAnime/AniKoto website account sessions were established. **Do not enter passwords for streaming sites into AniDash.** JustAnime advertises no sign-up required and optional AniList/MAL sync; the original HiAnime.to shut down in March 2026. Do not assume similarly branded sites share its accounts.

## Optional Vercel environment variables

- `ANILIST_WEB_CLIENT_ID` — public numeric OAuth client ID, required for AniList account login. Never configure the client secret in the browser.
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
- Local watchlists and playback progress use browser storage; wiping all browser site data can still remove unsynced data. Use Settings → Export JSON for backup. AniList cloud sync works after the website OAuth application is configured and the user signs in. MyAnimeList and streaming-provider account login are not supported by this website.
