# Prompt for the Android (AniDash) agent

You are working on the AniDash Android app (repo `anshdeepofficial1/AniDash`). Use a NEW development branch and a pull request. Do not touch release/production builds and do not merge to main.

## Context
The AniDash Go website (repo `anshdeepofficial1/AniDash-Website`) already has:
- **Device pairing** (website PR #20, with PR #21 fixing the Vercel function limit): the website shows a QR/one-time code; the app opens Settings → Devices, shows what is being linked (browser, OS), the user explicitly approves or denies, and the app POSTs the approval payload from the contract you were already given. Do not redefine that contract. Only accept QR/links whose host is exactly the configured AniDash site, over HTTPS. Never log tokens or put them in a URL.
- **Exact-position sync** through the AniList/MAL list-entry `notes` field. The website already reads/writes your existing tag `shx:ep=<episode>&sec=<seconds>&dur=<duration>` (same regex as `CloudWatchProgressSync`). Keep that format unchanged.

## What to implement
1. **Language/source metadata (new, backward compatible).** The website now writes an optional SECOND line in the notes, never inside the `shx:` tag:
   `shx-meta:lang=<code>&src=<id>`
   - `lang` is one of `en-dub`, `ja-sub`, `hi-dub`, `ta-dub`, `te-dub` (pattern `^[a-z]{2,3}-(dub|sub)$`); `src` is a short provider/server id (`[a-z0-9-]{1,24}`), e.g. `momo`, `ravok`.
   - Your existing formatter only replaces the first `shx:` match, so it already preserves this line. Add a parser for it, and when the app plays an episode, write/refresh the same line with the language actually being played.
   - Use it to show, in history/Continue Watching/detail: "Watched in Hindi DUB", etc. A missing meta line means "unknown", never assume English.
   - Hindi subtitles on Japanese audio are `ja-sub`, never `hi-dub`.
2. **Conflict rule.** Before writing, compare the entry's AniList `updatedAt` with the time of your own last local action. If the remote entry changed after your action (another device), do not overwrite; refresh instead. Do not pick "largest position": a deliberate rewind is valid. Keep an offline queue (newest item per anime) and drop queued items that lost to a newer remote write.
3. **What the website can and cannot record.** Exact seconds exist only for the native player and for embeds that publish playback events (MegaPlay, Megavid, AniXo). Other embeds only get manual checkpoints. Never invent progress from timers. If the entry has `sec` without `shx-meta`, treat it as valid position with unknown language.
4. **Preferences snapshot.** The website imports the allowlisted preference snapshot at pairing time only (audio, native source, Hindi fields). Continuous preference sync is not defined; do not add a new endpoint for it without agreement.
5. **Tests.** Unit tests for: parsing/writing `shx-meta`, formatter preserving it and the user's own notes, conflict/drop behaviour, offline queue, and rejecting a QR with a wrong host. Run the existing test suite.

## Acceptance
- Watch an episode on the website in Hindi at ~14:37 → the app's Continue Watching shows the same episode, ≈14:37, labelled Hindi DUB.
- Watch on the app at ~21:48 → the website resumes at ≈21:48.
- Existing app behaviour is unchanged when the `shx-meta` line is absent.
Report anything you could not verify on a real device.
