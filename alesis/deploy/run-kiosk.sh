#!/usr/bin/env bash
set -euo pipefail

origin="http://127.0.0.1:8787"
runtime_directory="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
wayland_display="${WAYLAND_DISPLAY:-wayland-0}"
deadline=$((SECONDS + 120))

while [[ ! -S "$runtime_directory/$wayland_display" ]]; do
  (( SECONDS < deadline )) || { printf 'Alesis kiosk: Wayland did not become ready\n' >&2; exit 1; }
  sleep 0.25
done

while true; do
  status="$(/usr/bin/curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "$origin/health" || true)"
  [[ "$status" == "200" || "$status" == "503" ]] && break
  (( SECONDS < deadline )) || { printf 'Alesis kiosk: server did not become ready\n' >&2; exit 1; }
  sleep 0.25
done

exec /usr/bin/chromium \
  --ozone-platform=wayland \
  --kiosk \
  --app="$origin" \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --disable-translate \
  --password-store=basic \
  --disk-cache-size=67108864 \
  --media-cache-size=67108864
