# AniDash source engine (browser)

`src/browser/engine.ts` is a pure module (no React) holding the provider registry, per-device health, cooldowns, ordering, and honest status. `episodes.tsx` uses it to choose and order providers and to record **real** playback results. `extensions/page.tsx` is the marketplace UI. `manga/_components/manga-reader.tsx` is the reader.

## What it does
- **Registry**: built-in anime adapters, manga publisher links outside the Extensions catalog, and user manifests (PR #18 format). No remote code is ever downloaded or executed; Android APK/Dart extensions are listed as *Incompatible*.
- **Health (localStorage only)**: successes/failures, resolve time, time-to-first-frame, stalls, last error, last verified.
- **Status** (never green without proof): `Verified on this device` needs ≥ 60 s of healthy playback (clock advanced ≥ 45 s, not paused) recorded by the player. `Available` = played/resolved but not stable-verified, `Degraded`, `Temporarily unavailable` (cooldown), `Unverified` (never played), `Incompatible`. `Update available` is reserved for manifest sources (no remote repository is configured yet).
- **Selection**: providers are filtered by enabled + compatible + declared language + not cooling down, then sorted by priority adjusted by health (recent success/verification bonus; strikes, stalls and slow resolve penalties). Per-provider backoff 2 min → ×2 per consecutive failure (+2 steps for 401/403/404/410) capped at 6 h. If everything is cooling down, only the provider that recovers soonest is probed. A provider is only marked failed when *all* its requests returned nothing.
- **Language**: English DUB is the default; audio is never switched silently. Only declared languages are offered; Hindi DUB comes from a separate lookup and is shown only when found. Hindi subtitles are never labelled DUB.
- **Manga**: official MANGA Plus / VIZ search links (nothing copied or embedded); manifest/CBZ-style chapters read in-app with vertical and right-to-left modes, prev/next chapter, per-page progress, Continue Reading, history, bounded image retry.
- **Security/privacy**: HTTPS-only, no credentials, no private/loopback/`.internal` hosts (`isSafeHttpsUrl`), 2 MB manifest cap, `credentials: omit`, `referrerPolicy: no-referrer`, `redirect: error`. No analytics. AniList tokens are never passed to providers or manifests. Providers do see your IP and the requested title.

## Source compatibility (code audit — **not** live-verified)
The Extensions catalog is anime-only and excludes external publisher/OTT links. Manga discovery and reading remain independent.
| Source | Type | Authorization | Status in the engine | Languages claimed |
|---|---|---|---|---|
| JustAnime | native HLS | third-party, no licence evidence | Unverified until played | en-dub, ja-sub |
| Animetsu (Gojo) | native HLS | third-party | Unverified | en-dub, ja-sub |
| HiAnime | native | third-party | Unverified (upstream layout/crypto changed; parser untested on live HTML) | en-dub, ja-sub |
| AniKoto / AnimePahe | native | third-party | Unverified (returned 403/404/410 from Vercel) | en-dub, ja-sub |
| Hindi DUB lookup | native | third-party | Unverified | hi-dub (only when found) |
| AnimeKai, AnimeOnsen, Kaido, AniZone | Android-only | third-party | Incompatible | – |
| MANGA Plus, VIZ | external link | official | Available | en |
| MangaSee, Mangakakalot, MangaBat, AsuraScans | Android-only, unlicensed hosts | not authorised | Incompatible | – |
| User manifests | native | user-supplied | Unverified | as declared |

## Blockers (honest)
1. The development sandbox cannot reach any provider or Vercel host (agent proxy returns 403), so **no live playback, preview-site testing, cross-browser or device testing was possible**. No source is marked Verified; the status turns green only after real playback on a user's device.
2. Acceptance items that need live authorized content (verified English DUB / Japanese SUB source, Hindi DUB, manga chapter reading with authorized content) remain **open**. Manga reading is verified only with synthetic fixtures in tests.
3. No third-party provider has authorization evidence; they are retained as unverified, user-disable-able built-ins, not recommended as "licensed". External streaming-platform integrations are outside the Extensions catalog.
4. Subtitle default preference is not a setting yet (English tracks are listed first in the player; selection is manual).
5. Update-available/repository management is limited to manifest import; no remote repository index exists.
6. Screenshots were taken only from a local static build with mocked API (see PR).

## Preview reliability follow-up (2026-11-24)
Live preview API requests for One Piece episode 1 English dub returned JustAnime 502 (upstream 523/502), HiAnime 502 (authentication-data error), and AniKoto 502 (upstream 403/timeout). These are not playback successes. This change does not circumvent provider restrictions. Client changes: request-scoped errors, no global cooldown for missing episodes, empty provider list handled, late results isolated, per-stream subtitle/skip metadata, bounded cache, and no indefinite initial buffering. API error responses are no-store. No new upstream provider has been verified or added.

HiAnime previously received AniList ID and episode number in the browser but its server handler read only episodeId and defaulted to episode 1. Explicit AniList episode numbers are now required for mapped requests; native IDs are not confused with AniList IDs. This fixes request identity, not upstream access or availability. Animetsu also returned 502 (fetch failed) in the preview API check.

## Playback synchronization
Both apps already use AniList notes `shx:ep=...&sec=...&dur=...`; no additional hosted database is introduced. The website now stores pending checkpoints by AniList account and media, retries when online, and rejects queued writes when the remote entry is newer. Manual checkpoint UI preserves existing embeds and saves a real user-entered timestamp; no undocumented postMessage protocol is invented. Exact automatic embedded playback and seeking require a documented provider interface, which has not been verified. AniList notes may be visible according to the user's list privacy settings. MAL-only exact position sync is not implemented. Cross-device live testing remains required.

### Existing embedded player telemetry
Provider-published docs for the existing MegaPlay, Megavid and AniXo integrations describe playback message events. The website now parses bounded timestamp/duration messages only from the active iframe's window and exact approved origin. It uses actual events, never elapsed wall-clock time. These adapters only collect progress for already-open players; no new stream source is introduced. Docs: https://megaplay.buzz/api ; https://megavid.buzz/ ; https://anixo.buzz/ . These interfaces do not establish content rights. Automatic seek commands have not been documented/verified; manual checkpoint and resume guidance remain available. Live event delivery and cross-device resume are still unverified.

### User-approved anime repository format
A repository index is an HTTPS JSON file: `{"version":1,"name":"My catalog","packages":[{"id":"licensed","name":"Licensed anime","version":1,"manifest":"episodes.json","sha256":"<64 hex characters>"}]}`. Package IDs must match their anime-only v1/v2 manifest IDs; SHA-256 is calculated over the exact manifest bytes. Install/update is explicit, same-origin for catalog packages, capped downloads, no credentials, no redirects, no execution. Source removal is in the installed sources list; removal of a repository leaves installed media intact. This is not a native Aniyomi/Mangayomi runtime and no unauthorized remote source was preinstalled. Browser-level host validation cannot establish content rights or DNS-level safety; only use trusted repositories.
