#!/bin/sh
set -eu
if [ -z "${ANIDASH_SERVER_PASSWORD:-}" ] || [ "${#ANIDASH_SERVER_PASSWORD}" -lt 16 ]; then
  echo "Set ANIDASH_SERVER_PASSWORD to a unique secret of at least 16 characters." >&2
  exit 1
fi
if [ -n "${PORT:-}" ]; then
  export SEANIME_SERVER_PORT="$PORT"
fi
exec /app/anidash --disable-features=ManageExtensions,OpenInExplorer,TorrentStreaming,DebridStreaming,ManageDebrid,ManageAutoDownloader,ViewAutoDownloader,ManageNakama,PushRequests
