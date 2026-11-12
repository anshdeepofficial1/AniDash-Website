# AniDash Web — Seanime replacement (migration preview)

This branch replaces the former static AniDash frontend with the actual Seanime React frontend and its corresponding Go backend, imported from 5rahim/seanime at commit 4bdff7b27b6c043dc87c0ccad3ead54596133a05.

AniDash's logo, web title, application manifest and selected visible labels have been changed. Upstream copyright, GPL-3.0 license and notices are retained. See UPSTREAM-README.md and DEVELOPMENT_AND_BUILD.md.

**Not a production deployment.** Seanime requires a persistent Go service and server configuration; Vercel static hosting alone is not sufficient. Existing AniDash account/library data and streaming integrations are not automatically migrated. Do not expose a shared single-user server to the public; deploy with appropriate authentication and use only authorized media. The previous website remains on main.

Build: `cd seanime-web && npm ci && npm run build`, then copy the resulting out directory to the repository-root web directory and build the Go server as documented upstream.
