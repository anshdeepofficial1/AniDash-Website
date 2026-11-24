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
