#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd -- "$script_directory/.." && pwd -P)"
remote_root="${ALESIS_PI_ROOT:-alesis}"
soundfont="${ALESIS_SOUNDFONT_PATH:-$HOME/Downloads/STH.sf2}"
soundfont_sha256="d56e5e9e5020c17f6d512dc59005456cec3647946640a75c23038cf6be983d2f"
ssh_options=(-o BatchMode=yes -o ConnectTimeout=5)

usage() {
  cat <<'EOF'
Usage: deploy/pi-bridge.sh <probe|sync|asset> <user@host>

  probe  Verify SSH and print read-only Pi, power, USB, and ALSA diagnostics.
  sync   Copy the repository to ~/alesis without installing or starting it.
  asset  Copy the verified STH.sf2 to ~/Downloads and verify its checksum.

The Pi must already have key-only SSH enabled. No operation uses sudo or starts
audio. Override the code destination with ALESIS_PI_ROOT and the local SoundFont
with ALESIS_SOUNDFONT_PATH.
EOF
}

fail() {
  printf 'Pi bridge: %s\n' "$1" >&2
  exit 64
}

[[ $# -eq 2 ]] || { usage >&2; exit 64; }
action="$1"
target="$2"
[[ "$target" =~ ^[a-z_][a-z0-9_-]*@[A-Za-z0-9.-]+$ ]] || fail "target must be user@host"
[[ "$remote_root" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "ALESIS_PI_ROOT contains unsupported characters"
command -v ssh >/dev/null 2>&1 || fail "ssh is not available"

remote() {
  ssh "${ssh_options[@]}" "$target" "$@"
}

probe_command() {
  local label="$1"
  shift
  printf '\n== %s ==\n' "$label"
  remote "$@" || printf 'Unavailable (command failed or is not installed)\n'
}

probe() {
  remote true
  probe_command Hostname hostname
  probe_command Architecture uname -m
  probe_command OS cat /etc/os-release
  probe_command Temperature vcgencmd measure_temp
  probe_command Throttling vcgencmd get_throttled
  probe_command Storage df -h /
  probe_command USB lsusb
  probe_command "ALSA playback" aplay -l
  probe_command "ALSA sequencer" aconnect -l
}

sync_repository() {
  command -v rsync >/dev/null 2>&1 || fail "rsync is not available"
  remote mkdir -p "$remote_root"
  rsync --archive --delete --human-readable --itemize-changes \
    --exclude=.git/ \
    --exclude=node_modules/ \
    --exclude=artifacts/ \
    --exclude=test-results/ \
    "$root/" "$target:$remote_root/"
  printf 'Repository synced to %s:%s\n' "$target" "$remote_root"
}

sync_soundfont() {
  command -v rsync >/dev/null 2>&1 || fail "rsync is not available"
  command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is not available"
  [[ -f "$soundfont" ]] || fail "SoundFont not found: $soundfont"
  local_sha256="$(sha256sum "$soundfont")"
  local_sha256="${local_sha256%% *}"
  [[ "$local_sha256" == "$soundfont_sha256" ]] || fail "SoundFont checksum does not match the verified asset"
  remote mkdir -p Downloads
  rsync --archive --human-readable --progress "$soundfont" "$target:Downloads/STH.sf2"
  remote_sha256="$(remote sha256sum Downloads/STH.sf2)"
  remote_sha256="${remote_sha256%% *}"
  [[ "$remote_sha256" == "$soundfont_sha256" ]] || fail "remote SoundFont checksum mismatch"
  printf 'Verified STH.sf2 at %s:Downloads/STH.sf2\n' "$target"
}

case "$action" in
  probe) probe ;;
  sync) sync_repository ;;
  asset) sync_soundfont ;;
  *) usage >&2; exit 64 ;;
esac
