#!/bin/sh
set -eu
umask 077
# Never enable shell tracing: profiles may contain encrypted password material.
case "${1:-doctor}" in
  doctor)
    tizen version
    sdb version
    printf '%s\n' 'CLI present. Samsung extensions, certificates and TV compatibility are NOT verified.'
    ;;
  profile-import)
    # User-provided profiles.xml must reference /certificates/... read-only files.
    test -f /certificates/profiles.xml
    cp /certificates/profiles.xml /signing/profiles.xml
    chmod 600 /signing/profiles.xml
    tizen cli-config -g "default.profiles.path=/signing/profiles.xml" >/dev/null
    printf '%s\n' 'Imported profile into private signing volume; no certificate created.'
    ;;
  package)
    test "$#" -eq 2 || { printf '%s\n' 'Usage: package PROFILE_NAME' >&2; exit 2; }
    test -f /signing/profiles.xml
    test -f /workspace/dist/config.xml
    tizen cli-config -g "default.profiles.path=/signing/profiles.xml" >/dev/null
    mkdir -p /workspace/artifacts/signed
    tizen package -t wgt -s "$2" -o /workspace/artifacts/signed -- /workspace/dist
    ;;
  connect)
    test "$#" -eq 2 || exit 2
    sdb connect "$2"
    ;;
  devices) sdb devices ;;
  install)
    test "$#" -eq 4 || { printf '%s\n' 'Usage: install TV_IP TARGET_NAME SIGNED_WIDGET_PATH' >&2; exit 2; }
    case "$4" in *UNSIGNED*) printf '%s\n' 'Refusing unsigned artifact.' >&2; exit 2;; esac
    test -f "$4"
    unzip -p "$4" author-signature.xml >/dev/null
    unzip -p "$4" signature1.xml >/dev/null
    # Connect in the same container: an SDB daemon does not survive --rm.
    sdb connect "$2"
    tizen install -t "$3" -n "$(basename "$4")" -- "$(dirname "$4")"
    ;;
  *) printf '%s\n' 'Commands: doctor, profile-import, package PROFILE, connect TV_IP, devices, install TV_IP TARGET SIGNED_WIDGET' >&2; exit 2 ;;
esac
