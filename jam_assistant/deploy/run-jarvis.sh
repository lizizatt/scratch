#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
default_root="$(cd -- "$script_directory/.." && pwd -P)"

root="${JARVIS_JAM_ASSISTANT_ROOT:-$default_root}"
host="${JARVIS_JAM_ASSISTANT_HOST:-127.0.0.1}"
port="${JARVIS_JAM_ASSISTANT_PORT:-4173}"
tailscale_port="${JARVIS_JAM_ASSISTANT_TAILSCALE_PORT:-${JARVIS_JAM_ASSISTANT_TAILSCALE_HTTPS_PORT:-${JARVIS_JAM_ASSISTANT_HTTPS_PORT:-4173}}}"
tailscale_executable="${JARVIS_JAM_ASSISTANT_TAILSCALE_EXECUTABLE:-${JARVIS_TAILSCALE_EXECUTABLE:-tailscale}}"
readiness_timeout="${JARVIS_JAM_ASSISTANT_READINESS_TIMEOUT_SECONDS:-${JARVIS_JAM_ASSISTANT_READY_TIMEOUT_SECONDS:-30}}"

fail() {
  printf 'Jam Assistant deployment: %s\n' "$1" >&2
  exit 64
}

validate_port() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^[0-9]+$ ]] || fail "$name must be an integer"
  (( 10#$value >= 1 && 10#$value <= 65535 )) || fail "$name must be between 1 and 65535"
}

if [[ "$host" != "localhost" && "$host" != "::1" && ! "$host" =~ ^127(\.[0-9]{1,3}){3}$ ]]; then
  fail "JARVIS_JAM_ASSISTANT_HOST must be a loopback host"
fi
validate_port "JARVIS_JAM_ASSISTANT_PORT" "$port"
validate_port "JARVIS_JAM_ASSISTANT_TAILSCALE_PORT" "$tailscale_port"
[[ "$readiness_timeout" =~ ^[0-9]+$ ]] && (( 10#$readiness_timeout >= 1 )) \
  || fail "JARVIS_JAM_ASSISTANT_READINESS_TIMEOUT_SECONDS must be a positive integer"
[[ -d "$root" ]] || fail "JARVIS_JAM_ASSISTANT_ROOT is not a directory: $root"
root="$(cd -- "$root" && pwd -P)"
[[ -f "$root/package.json" ]] || fail "JARVIS_JAM_ASSISTANT_ROOT does not contain package.json: $root"

command -v npm >/dev/null 2>&1 || fail "npm is not available"
command -v curl >/dev/null 2>&1 || fail "curl is not available"
command -v mktemp >/dev/null 2>&1 || fail "mktemp is not available"
command -v setsid >/dev/null 2>&1 || fail "setsid is not available"
command -v "$tailscale_executable" >/dev/null 2>&1 || fail "Tailscale executable is not available: $tailscale_executable"

url_host="$host"
[[ "$host" == "::1" ]] && url_host="[::1]"
origin="http://$url_host:$port"
app_pid=""
app_pgid=""
app_pid_file=""
serve_active=false
shutdown_signal="TERM"

clear_serve_mapping() {
  "$tailscale_executable" serve --https="$tailscale_port" off >/dev/null 2>&1 || true
}

app_running() {
  [[ -n "$app_pgid" ]] && kill -0 -- "-$app_pgid" 2>/dev/null
}

signal_app() {
  local signal="$1"
  if app_running; then
    kill -"$signal" -- "-$app_pgid" 2>/dev/null || true
  fi
}

start_app() {
  app_pid_file="$(mktemp "${TMPDIR:-/tmp}/jarvis-jam-assistant-runner.XXXXXX")"
  setsid --wait bash -c \
    'printf "%s\n" "$$" > "$1"; shift; exec "$@"' \
    jarvis-jam-assistant "$app_pid_file" npm run dev -- --host "$host" --port "$port" --strictPort &
  app_pid=$!

  local deadline=$((SECONDS + 5))
  until [[ -s "$app_pid_file" ]]; do
    if ! kill -0 "$app_pid" 2>/dev/null; then
      fail "Vite exited before its process group was registered"
    fi
    (( SECONDS < deadline )) || fail "timed out registering the Vite process group"
    sleep 0.05
  done
  IFS= read -r app_pgid < "$app_pid_file"
  rm -f -- "$app_pid_file"
  app_pid_file=""
  [[ "$app_pgid" =~ ^[0-9]+$ ]] || fail "Vite reported an invalid process group"
}

stop_app() {
  if [[ -z "$app_pgid" && -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill -TERM "$app_pid" 2>/dev/null || true
  fi
  signal_app "$shutdown_signal"
  local deadline=$((SECONDS + 10))
  while app_running && (( SECONDS < deadline )); do
    sleep 0.1
  done
  if app_running; then
    signal_app KILL
  fi
  if [[ -n "$app_pid" ]]; then
    wait "$app_pid" 2>/dev/null || true
  fi
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  stop_app
  [[ -z "$app_pid_file" ]] || rm -f -- "$app_pid_file"
  if [[ "$serve_active" == true ]]; then
    clear_serve_mapping
  fi
  exit "$exit_code"
}

terminate() {
  shutdown_signal="$1"
  local exit_code="$2"
  exit "$exit_code"
}

wait_until_ready() {
  local deadline=$((SECONDS + readiness_timeout))
  until curl --fail --silent --output /dev/null --max-time 2 "$origin/"; do
    if ! app_running; then
      printf 'Jam Assistant deployment: Vite exited before becoming ready\n' >&2
      return 1
    fi
    if (( SECONDS >= deadline )); then
      printf 'Jam Assistant deployment: timed out waiting for %s/\n' "$origin" >&2
      return 1
    fi
    sleep 0.25
  done
}

trap cleanup EXIT
trap 'terminate TERM 143' TERM
trap 'terminate INT 130' INT

clear_serve_mapping
cd -- "$root"
start_app

wait_until_ready
serve_active=true
"$tailscale_executable" serve --bg --https="$tailscale_port" "$origin"
printf 'Jam Assistant deployment ready at %s (Tailscale HTTPS %s)\n' "$origin" "$tailscale_port"

wait "$app_pid"