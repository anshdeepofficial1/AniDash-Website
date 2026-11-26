# AniDash Go device pairing

Website counterpart of Android Settings → Devices. Only the feature branch is changed.

## Deployment prerequisites
Configure these server-only environment variables for the intended Vercel environment:
- UPSTASH_REDIS_REST_URL — HTTPS REST endpoint of a dedicated Redis database.
- UPSTASH_REDIS_REST_TOKEN — Redis server credential.
- DEVICE_PAIR_ENCRYPTION_KEY — exactly 32 cryptographically random bytes encoded as base64 (generate locally using `openssl rand -base64 32`). Keep stable; rotating invalidates sessions.

The API fails closed (503) if storage or the key is absent. Do not expose environment variables via browser build prefixes. No request bodies or upstream credentials are logged by these functions. Do not configure external log drains or instrumentation to capture pairing request bodies, headers or query strings. Use a separate preview database/namespace and real HTTPS deployment; the QR's canonical target is https://anidashgo.vercel.app/connect?code=<PAIRING_CODE>.

## Protocol
- POST /api/device-pair/create (same-origin browser only): 201, code, local PNG QR data URI, expiresAt. Browser receives a separate HttpOnly binding cookie. Code is 128-bit random hex, manual entry is case-sensitive lowercase. 
- GET /api/device-pair/session?code=...: 200 pending; only name, coarse browser/OS and expiry. Location is deliberately omitted. 400 malformed/unknown, 410 expired/denied/consumed.
- POST /api/device-pair/approve: accept the Android payload from the supplied contract (code, accounts, sync.schemaVersion=1, client.platform=android). Validate each provider's identity using its official API. Explicit denial is `{"code":"...","approved":false}`, without credentials. 
- GET /api/device-pair/status?code=...: original browser binding required. 202 pending, 200 connected with Secure HttpOnly SameSite=Strict login cookie, 410 expired/denied/consumed, 403 if binding is wrong. Redis Lua atomically creates login and deletes pairing credentials. A nonsecret hashed tombstone remains for 24h, then an old code is unknown. Pairing credentials expire after five minutes; opaque browser sessions expire in 30 days. No process-memory fallback.
- GET /api/device-pair/account returns profiles and allowlisted preferences, never tokens. POST /api/device-pair/anilist proxies official GraphQL using the paired session. Existing MAL data route accepts the cookie for paired calls. POST /api/device-pair/logout deletes the server session.

## Sync scope and limitations
Paired AniList lists and exact Android-compatible shx watch notes use the existing tracker integration. MAL supports anime list/progress with AniList media ID mapping; MAL does not provide exact timestamp handoff. The Android preference snapshot is allowlisted: audio, native source, source kind, supported Hindi fields, quality and subtitle options. Download preferences and device-only data are excluded. Browser HLS quality applies where a matching rendition exists; external iframe players do not expose browser quality/subtitle controls. Hindi preference requires explicit language fallback; no silent language substitution. Some Android sources may be unavailable on the browser. The Android contract does not define ongoing preference updates; the current implementation imports a snapshot at pairing. MAL access token expiry requires re-pairing unless Android OAuth client refresh details are later supplied. Existing direct browser OAuth is unchanged; its legacy token storage is separate from paired login. Do not consider the new paired flow production-verified until real Android approval/denial and tracker account testing are performed.

## Verification
The device pairing workflow exercises actual Redis Lua transitions with mock provider identities and tests concurrent consumption, denial, expiry, wrong browser, no credential exposure and rate limits. A separate job builds the React website. Test live on preview before merging.
