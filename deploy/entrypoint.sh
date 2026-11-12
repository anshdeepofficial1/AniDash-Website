#!/bin/sh
set -eu
if [ -z "${ANIDASH_SERVER_PASSWORD:-}" ] || [ "${#ANIDASH_SERVER_PASSWORD}" -lt 16 ]; then
  echo "Set ANIDASH_SERVER_PASSWORD to a unique secret of at least 16 characters." >&2
  exit 1
fi
if [ -n "${PORT:-}" ]; then
  export SEANIME_SERVER_PORT="$PORT"
fi
mkdir -p "$SEANIME_DATA_DIR" /media
chown 10001:10001 "$SEANIME_DATA_DIR"
exec gosu anidash /app/anidash --disable-features=ManageExtensions,OpenInExplorer,TorrentStreaming,DebridStreaming,ManageDebrid,ManageAutoDownloader,ViewAutoDownloader,ManageNakama,PushRequests
