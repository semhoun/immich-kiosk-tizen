#!/bin/sh
set -eu
umask 077
export HOME=/signing
export XDG_DATA_HOME=/signing/.local/share
export XDG_RUNTIME_DIR=/signing/.runtime
mkdir -p "$XDG_DATA_HOME/keyrings" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_DATA_HOME/keyrings" "$XDG_RUNTIME_DIR"

if [ ! -f /signing/.keyring-password ]; then
  if [ -e "$XDG_DATA_HOME/keyrings/login.keyring" ]; then
    printf '%s\n' 'Existing keyring has no managed unlock key. Restore its private backup; refusing to replace it.' >&2
    exit 1
  fi
  temporary=$(mktemp /signing/.keyring-password.XXXXXX)
  openssl rand -hex 32 > "$temporary"
  mv "$temporary" /signing/.keyring-password
fi
test -s /signing/.keyring-password || { printf '%s\n' 'The keyring unlock key is empty; restore its private backup.' >&2; exit 1; }
chmod 600 /signing/.keyring-password

if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  exec dbus-run-session -- "$0" "$@"
fi
# The SDK uses Secret Service, even when XML password references end in .pwd.
# Unlock data goes through stdin, never through arguments or logs.
gnome-keyring-daemon --unlock --components=secrets < /signing/.keyring-password >/dev/null 2>&1
gnome-keyring-daemon --start --components=secrets >/dev/null 2>&1
exec "$@"
