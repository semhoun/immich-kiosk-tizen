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
    # Import an existing profile registry into the private signing volume.
    source=${2:-/certificates/profiles.xml}
    test -f "$source"
    if [ "$source" != /signing/profiles.xml ]; then cp "$source" /signing/profiles.xml; fi
    chmod 600 /signing/profiles.xml
    tizen cli-config -g "profiles.path=/signing/profiles.xml" >/dev/null
    printf '%s\n' 'Imported profile into private signing volume; no certificate created.'
    ;;
  profile-create|profile-repair)
    test "$#" -eq 2 || { printf '%s\n' 'Usage: profile-create|profile-repair PROFILE_NAME' >&2; exit 2; }
    test -t 0 || { printf '%s\n' 'An interactive terminal is required.' >&2; exit 2; }
    test -f /certificates/author.p12
    test -f /certificates/distributor.p12
    if [ "$1" = profile-create ] && { [ -e /signing/profiles.xml ] || {
      [ -e /signing/tizen-studio-data/profile/profiles.xml ] &&
      grep -Eq '<([[:alnum:]_.-]+:)?profile([[:space:]/>])' /signing/tizen-studio-data/profile/profiles.xml
    }; }; then
      printf '%s\n' 'A signing profile already exists. Use profile-repair PROFILE_NAME to repair it with the same certificates.' >&2
      exit 2
    fi
    if [ "$1" = profile-repair ] && [ ! -f /signing/profiles.xml ]; then
      printf '%s\n' 'No profile to repair. Use profile-create first.' >&2
      exit 2
    fi
    restore=0
    cleanup_profile() {
      stty echo 2>/dev/null || :
      unset author_password distributor_password stored_author stored_distributor
      if [ "$restore" = 1 ]; then
        for name in profiles.xml sdk-profiles.xml; do
          target=/signing/profiles.xml
          if [ "$name" = sdk-profiles.xml ]; then target=/signing/tizen-studio-data/profile/profiles.xml; fi
          if [ -f "$backup/$name" ]; then cp "$backup/$name" "$target"; else rm -f "$target"; fi
        done
        tizen cli-config -g "profiles.path=/signing/profiles.xml" >/dev/null 2>&1 || :
      fi
    }
    trap cleanup_profile 0
    trap 'exit 130' INT
    trap 'exit 143' TERM HUP
    stty -echo
    printf '%s' 'Author certificate password: '
    IFS= read -r author_password
    printf '\n%s' 'Distributor password (Enter = same as author): '
    IFS= read -r distributor_password
    distributor_password=${distributor_password:-$author_password}
    stty echo
    printf '\n'
    test -n "$author_password" || { printf '%s\n' 'An author certificate password is required.' >&2; exit 1; }
    # Validate without putting passwords in openssl arguments or writing keys.
    if ! printf '%s\n' "$author_password" | openssl pkcs12 -legacy -in /certificates/author.p12 -passin stdin -noout >/dev/null 2>&1; then
      printf '%s\n' 'Cannot open author.p12: check the password and file format.' >&2
      exit 1
    fi
    if ! printf '%s\n' "$distributor_password" | openssl pkcs12 -legacy -in /certificates/distributor.p12 -passin stdin -noout >/dev/null 2>&1; then
      printf '%s\n' 'Cannot open distributor.p12: check the password and file format.' >&2
      exit 1
    fi
    # Keep signing independent of the external import mount. On Linux, .pwd
    # references are Secret Service identifiers, not files beside the PKCS12.
    mkdir -p /signing/certificates
    chmod 700 /signing/certificates
    for name in author distributor; do
      if [ -e "/signing/certificates/$name.p12" ]; then
        cmp -s "/certificates/$name.p12" "/signing/certificates/$name.p12" || {
          printf '%s\n' 'Existing signing certificates differ; refusing to replace them.' >&2
          exit 2
        }
      else
        cp "/certificates/$name.p12" "/signing/certificates/$name.p12"
      fi
      chmod 600 "/signing/certificates/$name.p12"
    done
    backup=$(mktemp -d /signing/profile-backup.XXXXXX)
    if [ -f /signing/profiles.xml ]; then cp /signing/profiles.xml "$backup/profiles.xml"; fi
    if [ -f /signing/tizen-studio-data/profile/profiles.xml ]; then
      cp /signing/tizen-studio-data/profile/profiles.xml "$backup/sdk-profiles.xml"
    fi
    restore=1
    # The canonical registry is authoritative. Some SDK versions edit their
    # default registry regardless of profiles.path; point both to that same data.
    mkdir -p /signing/tizen-studio-data/profile
    if [ -f /signing/profiles.xml ]; then
      cp /signing/profiles.xml /signing/tizen-studio-data/profile/profiles.xml
    fi
    tizen cli-config -g "profiles.path=/signing/tizen-studio-data/profile/profiles.xml" >/dev/null
    # Samsung's CLI requires passwords as arguments. Suppress its output; use
    # only on a trusted host where process arguments cannot expose credentials.
    if ! tizen security-profiles add -n "$2" -a /signing/certificates/author.p12 -p "$author_password" \
        -d /signing/certificates/distributor.p12 -dp "$distributor_password" -A -f >/dev/null 2>&1; then
      printf '%s\n' 'Profile creation failed. Check the SDK installation and certificate compatibility.' >&2
      exit 1
    fi
    secret_tool=/opt/tizen-studio/tools/certificate-encryptor/secret-tool
    stored_author=$(timeout 15 "$secret_tool" lookup '--label="tizen-studio"' keyfile /signing/certificates/author.pwd tool certificate-manager 2>/dev/null) || stored_author=
    stored_distributor=$(timeout 15 "$secret_tool" lookup '--label="tizen-studio"' keyfile /signing/certificates/distributor.pwd tool certificate-manager 2>/dev/null) || stored_distributor=
    # The SDK can return success without saving anything. Check values in memory,
    # never log them, before accepting a profile that would fail at signing time.
    if [ "$stored_author" != "$author_password" ] || [ "$stored_distributor" != "$distributor_password" ]; then
      printf '%s\n' 'The encrypted keyring did not retain the passwords. The previous XML profiles were restored.' >&2
      exit 1
    fi
    cp /signing/tizen-studio-data/profile/profiles.xml /signing/profiles.xml
    chmod 600 /signing/profiles.xml
    tizen cli-config -g "profiles.path=/signing/profiles.xml" >/dev/null
    restore=0
    printf '%s\n' 'Signing profile created from existing certificates in the private volume.'
    ;;
  package)
    test "$#" -eq 2 || { printf '%s\n' 'Usage: package PROFILE_NAME' >&2; exit 2; }
    test -f /signing/profiles.xml
    test -f /workspace/dist/config.xml
    tizen cli-config -g "profiles.path=/signing/profiles.xml" >/dev/null
    mkdir -p /workspace/artifacts/signed
    tizen package -t wgt -s "$2" -o /workspace/artifacts/signed -- /workspace/dist
    # The TV install command does not reliably quote remote filenames.
    mv -f '/workspace/artifacts/signed/Immich Kiosk.wgt' /workspace/artifacts/signed/ImmichKiosk.wgt
    printf '%s\n' 'TV installation package: artifacts/signed/ImmichKiosk.wgt'
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
  *) printf '%s\n' 'Commands: doctor, profile-import [XML_PATH], profile-create PROFILE, profile-repair PROFILE, package PROFILE, connect TV_IP, devices, install TV_IP TARGET SIGNED_WIDGET' >&2; exit 2 ;;
esac
