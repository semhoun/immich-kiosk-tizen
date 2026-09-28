#!/bin/bash
set -euo pipefail
umask 077

fail() { printf '%s\n' "$1" >&2; exit 1; }

if [[ ${1:-} != --session ]]; then
    uid=${LOCAL_UID:-1000}
    gid=${LOCAL_GID:-1000}
    [[ $uid =~ ^[1-9][0-9]*$ && $gid =~ ^[1-9][0-9]*$ ]] || fail 'Use non-root numeric LOCAL_UID and LOCAL_GID.'
    if [[ $(id -u) == 0 ]]; then
        # Only the private named volume is changed, never the SDK or host files.
        mkdir -p /signing
        chmod 700 /signing
        chown -R "$uid:$gid" /signing
        exec gosu "$uid:$gid" /usr/local/bin/with-keyring /usr/local/bin/certificate-ui --session
    fi
    exec /usr/local/bin/with-keyring /usr/local/bin/certificate-ui --session
fi

[[ $(id -u) != 0 ]] || fail 'The GUI must run as a non-root user.'
export HOME=/signing DISPLAY=:0 XAUTHORITY=/signing/.Xauthority
export XDG_CONFIG_HOME=/signing/.config XDG_CACHE_HOME=/signing/.cache
export XDG_DATA_HOME=/signing/.local/share XDG_RUNTIME_DIR=/signing/.runtime
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_RUNTIME_DIR" /signing/.vnc /signing/.fluxbox
chmod 700 /signing "$XDG_RUNTIME_DIR" /signing/.vnc

manager=${CERTIFICATE_MANAGER_COMMAND:-/opt/tizen-studio/tools/certificate-manager/certificate-manager}
[[ -x $manager ]] || fail 'Official Certificate Manager is missing. Install Certificate-Manager and cert-add-on in the SDK image.'

password_file=/signing/.vnc/password.txt
if [[ ! -e $password_file ]]; then
    # Six random bytes encode to exactly eight base64 characters, without padding.
    openssl rand -base64 6 > "$password_file"
fi
chmod 600 "$password_file"
password=$(< "$password_file")
[[ $password =~ ^[A-Za-z0-9+/]{8}$ ]] || fail 'Invalid VNC password file: expected exactly eight base64 characters.'
# Use stdin, not command arguments or environment, to avoid exposing the password.
printf '%s\n%s\ny\n' "$password" "$password" | x11vnc -storepasswd /signing/.vnc/passwd >/dev/null 2>&1
unset password
chmod 600 /signing/.vnc/passwd

touch "$XAUTHORITY"
chmod 600 "$XAUTHORITY"
xauth -f "$XAUTHORITY" add :0 MIT-MAGIC-COOKIE-1 "$(openssl rand -hex 16)"

# Eclipse user state belongs to the private volume, not the SDK installation.
configuration=/signing/.config/certificate-manager
if [[ ! -d $configuration ]]; then
    if [[ -d $(dirname "$manager")/configuration ]]; then
        cp -R "$(dirname "$manager")/configuration" "$configuration"
    else
        mkdir -p "$configuration"
    fi
fi

pids=()
cleanup() {
    trap - EXIT TERM INT
    if (( ${#pids[@]} )); then
        kill -TERM "${pids[@]}" 2>/dev/null || true
        # Bound shutdown even when a GUI process ignores TERM.
        (sleep 5; kill -KILL "${pids[@]}" 2>/dev/null || true) &
        killer=$!
        wait "${pids[@]}" 2>/dev/null || true
        kill "$killer" 2>/dev/null || true
        wait "$killer" 2>/dev/null || true
    fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

Xvfb :0 -screen 0 1440x900x24 -nolisten tcp -auth "$XAUTHORITY" >/dev/null 2>&1 &
pids+=("$!")
ready=false
for ((attempt=0; attempt<100; attempt++)); do
    if xdpyinfo >/dev/null 2>&1; then ready=true; break; fi
    kill -0 "${pids[0]}" 2>/dev/null || fail 'Private X display failed to start.'
    sleep 0.1
done
[[ $ready == true ]] || fail 'Private X display did not become ready.'

printf '%s\n' 'session.screen0.rootCommand: fbsetroot -solid #111827' > /signing/.fluxbox/certificate-init
fluxbox -rc /signing/.fluxbox/certificate-init >/dev/null 2>&1 &
pids+=("$!")
x11vnc -display :0 -auth "$XAUTHORITY" -no6 -listen 127.0.0.1 -rfbport 5900 -rfbportv6 -1 \
    -rfbauth /signing/.vnc/passwd -forever -shared -noxdamage -quiet >/dev/null &
pids+=("$!")
websockify --web=/usr/share/novnc 0.0.0.0:6080 127.0.0.1:5900 >/dev/null 2>&1 &
pids+=("$!")
"$manager" -data /signing/certificate-workspace -configuration "$configuration" >/dev/null 2>&1 &
pids+=("$!")

printf '%s\n' 'Certificate GUI started. Open http://127.0.0.1:6080/vnc.html.' \
    'Retrieve the VNC password yourself: docker compose exec certificate-ui cat /signing/.vnc/password.txt' \
    'Log in to Samsung only inside the official Certificate Manager. Closing it stops this session.'
status=0
wait -n "${pids[@]}" || status=$?
exit "$status"
