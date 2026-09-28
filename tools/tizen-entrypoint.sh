#!/bin/sh
set -eu
uid=${LOCAL_UID:-1000}
gid=${LOCAL_GID:-1000}
case "$uid:$gid" in *[!0-9:]*|0:*|*:0) printf '%s\n' 'Use non-root numeric LOCAL_UID and LOCAL_GID.' >&2; exit 1;; esac
mkdir -p /signing
chmod 700 /signing
chown -R "$uid:$gid" /signing
case "${1:-doctor}" in
  profile-create|profile-repair|package)
    exec gosu "$uid:$gid" /usr/local/bin/with-keyring /usr/local/bin/tizen-tool "$@"
    ;;
  *) exec gosu "$uid:$gid" /usr/local/bin/tizen-tool "$@" ;;
esac
