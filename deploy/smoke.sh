#!/usr/bin/env bash
set -euo pipefail
base="${1:-http://127.0.0.1:43211}"
: "${ANIDASH_SERVER_PASSWORD:?Required}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for attempt in $(seq 1 90); do
  if curl -fsS --max-time 3 "$base/api/v1/status" > "$tmp/status.json"; then break; fi
  sleep 2
done
jq -e '.. | objects | select(has("serverHasPassword")) | .serverHasPassword == true' "$tmp/status.json"
curl -fsS "$base/" > "$tmp/index.html"
grep -q '<title>AniDash</title>' "$tmp/index.html"
curl -fsS "$base/discover" | grep -q '<title>AniDash</title>'
curl -fsS "$base/manifest.json" | jq -e '.name == "AniDash"'
curl -fsS "$base/icons/favicon.ico" > "$tmp/favicon.ico"
test -s "$tmp/favicon.ico"
code=$(curl -sS -o "$tmp/denied.json" -w '%{http_code}' "$base/api/v1/settings")
test "$code" = 401
hash=$(printf %s "$ANIDASH_SERVER_PASSWORD" | sha256sum | cut -d' ' -f1)
curl -fsS -H "X-Seanime-Token: $hash" "$base/api/v1/status" > "$tmp/auth.json"
jq -e '.. | objects | select(has("serverHasPassword")) | .serverHasPassword == true and (.dataDir | type == "string" and length > 0)' "$tmp/auth.json"
echo "PASS: real Go server, embedded AniDash frontend, deep links, manifest, favicon and password-protected API"
