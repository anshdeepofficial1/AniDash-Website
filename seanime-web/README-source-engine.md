# AniDash source engine (browser)

`src/browser/engine.ts` is a pure module (no React) holding the provider registry, per-device health, cooldowns, ordering, and honest status. `episodes.tsx` uses it to choose and order providers and to record **real** playback results. `extensions/page.tsx` is the marketplace UI. `manga/_components/manga-reader.tsx` is the reader.

## What it does
- **Registry**: reviewed built-in adapters, official-link providers, and user manifests (PR #18 format). No remote code is ever downloaded or executed; Android APK/Dart extensions are listed as *Incompatible*.
- **Health (localStorage only)**: successes/failures, resolve time, time-to-first-frame, stalls, last error, last verified.
- **Status** (never green without proof): `Verified on this device` needs ≥ 60 s of healthy playback (clock advanced ≥ 45 s, not paused) recorded by the player. `Available` = played/resolved but not stable-verified, `Degraded`, `Temporarily unavailable` (cooldown), `Unverified` (never played), `Incompatible`. `Update available` is reserved for manifest sources (no remote repository is configured yet).
- **Selection**: providers are filtered by enabled + compatible + declared language + not cooling down, then sorted by priority adjusted by health (recent success/verification bonus; strikes, stalls and slow resolve penalties). Per-provider backoff 2 min → ×2 per consecutive failure (+2 steps for 401/403/404/410) capped at 6 h. If everything is cooling down, only the provider that recovers soonest is probed. A provider is only marked failed when *all* its requests returned nothing.
- **Language**: English DUB is the default; audio is never switched silently. Only declared languages are offered; Hindi DUB comes from a separate lookup and is shown only when found. Hindi subtitles are never labelled DUB.
- **Manga**: official MANGA Plus / VIZ search links (nothing copied or embedded); manifest/CBZ-style chapters read in-app with vertical and right-to-left modes, prev/next chapter, per-page progress, Continue Reading, history, bounded image retry.
- **Security/privacy**: HTTPS-only, no credentials, no private/loopback/`.internal` hosts (`isSafeHttpsUrl`), 2 MB manifest cap, `credentials: omit`, `referrerPolicy: no-referrer`, `redirect: error`. No analytics. AniList tokens are never passed to providers or manifests. Providers do see your IP and the requested title.

## Source compatibility (code audit — **not** live-verified)
| Source | Type | Authorization | Status in the engine | Languages claimed |
|---|---|---|---|---|
| JustAnime | native HLS | third-party, no licence evidence | Unverified until played | en-dub, ja-sub |
| Animetsu (Gojo) | native HLS | third-party | Unverified | en-dub, ja-sub |
| HiAnime | native | third-party | Unverified (upstream layout/crypto changed; parser untested on live HTML) | en-dub, ja-sub |
| AniKoto / AnimePahe | native | third-party | Unverified (returned 403/404/410 from Vercel) | en-dub, ja-sub |
| Hindi DUB lookup | native | third-party | Unverified | hi-dub (only when found) |
| AnimeKai, AnimeOnsen, Kaido, AniZone | Android-only | third-party | Incompatible | – |
| Crunchyroll, Netflix, Prime Video | external link | official | Available (opens provider; no in-app playback) | provider-defined |
| Official YouTube channels | external link | official | Channel IDs **not verified**; nothing embedded | – |
| MANGA Plus, VIZ | external link | official | Available | en |
| MangaSee, Mangakakalot, MangaBat, AsuraScans | Android-only, unlicensed hosts | not authorised | Incompatible | – |
| User manifests | native | user-supplied | Unverified | as declared |

## Blockers (honest)
1. The development sandbox cannot reach any provider or Vercel host (agent proxy returns 403), so **no live playback, preview-site testing, cross-browser or device testing was possible**. No source is marked Verified; the status turns green only after real playback on a user's device.
2. Acceptance items that need live authorized content (verified English DUB / Japanese SUB source, Hindi DUB, manga chapter reading with authorized content) remain **open**. Manga reading is verified only with synthetic fixtures in tests.
3. No third-party provider has authorization evidence; they are retained as unverified, user-disable-able built-ins, not recommended as "licensed". Muse/Ani-One/Anime Times/Pokémon official YouTube channels need verified channel and video IDs before embedding.
4. Subtitle default preference is not a setting yet (English tracks are listed first in the player; selection is manual).
5. Update-available/repository management is limited to manifest import; no remote repository index exists.
6. Screenshots were taken only from a local static build with mocked API (see PR).

---
# Update 2: playback sync, embedded players, native servers

## Cross-device position sync (audit result)
Android (`CloudWatchProgressSync`) and the website already share one record: the AniList/MAL list entry `notes` field carries `shx:ep=<episode>&sec=<seconds>&dur=<duration>`. The website reads and writes the same tag (`anilist-account.js`, covered by `tests/cross-device-sync.test.js`), so **no Android change and no new backend are needed**. Limits of this channel: one record per anime (the latest episode), second-level precision, no per-device/session fields, and the timestamp is AniList's `updatedAt`. AniList tokens never leave the browser except to AniList.

Added here:
- Saves on pause, seek, source/episode change, close, `visibilitychange`, **`pagehide`**, end, and every 5 s locally / ≥10 s remotely during real playback (existing, kept).
- **Offline queue** (`sync-queue.ts`): newest item per anime, replayed on `online`/tab visible/startup. A queued write is **dropped** if AniList shows a newer write from another device (`updatedAt` > action time + 2 s); a deliberate rewind is applied because ordering is by action time, not by "largest position".

## Embedded players
| Player | Progress tracking | Evidence |
|---|---|---|
| MegaPlay | **Yes** – `postMessage` `{event:"time",time,duration}`, `{type:"watching-log",currentTime,duration}`, `{event:"complete"}` | Provider's API page (megaplay.buzz/api). No seek / start-time option is documented, so returning shows "last saved mm:ss — drag the bar to it". |
| Megavid | No | No documentation could be fetched/confirmed. Kept working, labelled "progress isn't tracked". |
| AniXo | No | Same. |
`embed-progress.ts` accepts messages only from the exact approved origin **and** the player's own iframe window, validates the schema and ranges, and never invents progress from a timer.

## Marketplace changes
Anime-only. Netflix/Prime/Crunchyroll/YouTube entries and the Manga tab were removed from Extensions (manga stays on its own page). Embedded players are listed as "Embedded player" sources and can be disabled. An episode that a provider doesn't have no longer triggers a cooldown for the whole provider.

## Native servers (momo, onyx, gigi, nami, calm, revo, zoko, neko)
New diagnostic: `/api/justanime?action=matrix&id=21&episode=440` returns, per server and audio, whether a stream is returned and whether the first media URL is really fetchable (HLS must start with `#EXTM3U`). Use it on the preview to see which servers truly work from Vercel.

## Still not verified (sandbox cannot reach providers/Vercel)
No live playback, no 14:37-style Android↔website round trip, no Playwright run against the preview. Android-side changes: none required.
