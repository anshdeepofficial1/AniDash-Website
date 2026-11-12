# AniDash private deployment

The actual Seanime frontend is embedded in the Go server; no separate frontend deployment is needed. The app requires a persistent process and a writable data volume. It is not a Vercel static site or a stateless serverless function.

## Start a private instance

1. Check out the migration branch.
2. Set ANIDASH_SERVER_PASSWORD to a unique random secret (minimum 16 characters). Do not commit it.
3. Create a media folder containing media you own or are authorized to stream.
4. Run docker compose up --build -d.
5. Open http://127.0.0.1:43211, enter the instance password, and complete initial setup. Choose /media as the library directory. The read-only media mount is intentional.
6. Connect your own AniList account using the upstream account setup flow.

The compose port is bound to loopback. For remote private access, use an authenticated VPN or secure access proxy. Do not expose an unauthenticated shared server. The backend has a single shared account, shared settings, local-file controls and administrative capabilities; independent public user accounts are NOT implemented. A production multi-user website needs per-user authorization and data isolation, a restricted media catalog and review of administrative endpoints before any public release. The disabled-feature list is defense-in-depth, not a complete multi-tenant security boundary.

Only use authorized media. This branch does not migrate the previous third-party providers or browser-local watchlist/history; those remain available on the original main branch. No existing account secrets or database contents are copied.

The GitHub acceptance workflow compiles the frontend and Go executable and checks actual HTTP requests, deep routes, branding and password-protected API access. This does not establish successful playback or a complete production security audit.
