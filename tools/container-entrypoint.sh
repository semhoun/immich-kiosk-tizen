#!/bin/sh
set -eu
uid=${LOCAL_UID:-1000}
gid=${LOCAL_GID:-1000}
case "$uid:$gid" in *[!0-9:]*|0:*|*:0) printf '%s\n' 'Use non-root numeric LOCAL_UID and LOCAL_GID.' >&2; exit 1;; esac
# Only named volumes are initialized as root; commands write the bind mount as the user.
mkdir -p /cache/home /cache/npm /workspace/node_modules
exec 9>/workspace/node_modules/.initialization.lock
flock 9
if ! cmp -s /opt/dependencies/package-lock.json /workspace/node_modules/.image-package-lock.json; then
    cp -a /opt/dependencies/node_modules/. /workspace/node_modules/
    cp /opt/dependencies/package-lock.json /workspace/node_modules/.image-package-lock.json
fi
chown -R "$uid:$gid" /cache /workspace/node_modules
flock -u 9
exec 9>&-
exec gosu "$uid:$gid" "$@"
