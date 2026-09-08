#!/usr/bin/env bash
set -euo pipefail

[[ ${EUID:-$(id -u)} -eq 0 ]] || { printf 'Run with sudo: deploy/setup-pi.sh\n' >&2; exit 64; }

runtime_user="${ALESIS_USER:-alesis}"
runtime_home="$(getent passwd "$runtime_user" | cut -d: -f6)"
root="${ALESIS_ROOT:-$runtime_home/alesis}"
soundfont="$runtime_home/Downloads/STH.sf2"
soundfont_sha256="d56e5e9e5020c17f6d512dc59005456cec3647946640a75c23038cf6be983d2f"

[[ -n "$runtime_home" && -d "$runtime_home" ]] || { printf 'Unknown runtime user: %s\n' "$runtime_user" >&2; exit 64; }
[[ -f "$root/package.json" ]] || { printf 'Alesis checkout not found: %s\n' "$root" >&2; exit 64; }
[[ -f "$soundfont" ]] || { printf 'Required SoundFont not found: %s\n' "$soundfont" >&2; exit 64; }
printf '%s  %s\n' "$soundfont_sha256" "$soundfont" | sha256sum --check --status \
  || { printf 'STH.sf2 checksum mismatch\n' >&2; exit 65; }

apt-get update
apt-get install -y --no-install-recommends alsa-utils chromium curl fluidsynth libasound2-dev nodejs npm rsync

if amixer -q -c Device set Speaker 151 unmute; then
  alsactl store Device
fi

install -o root -g root -m 0644 "$root/deploy/asoundrc" /etc/asound.conf
install -d -o "$runtime_user" -g "$runtime_user" -m 0755 "$runtime_home/.config/labwc"
install -o "$runtime_user" -g "$runtime_user" -m 0755 "$root/deploy/labwc-autostart" "$runtime_home/.config/labwc/autostart"
install -d -o "$runtime_user" -g "$runtime_user" -m 0755 "$runtime_home/.config/systemd/user"
ln -sfn /dev/null "$runtime_home/.config/systemd/user/fluidsynth.service"
chown -h "$runtime_user:$runtime_user" "$runtime_home/.config/systemd/user/fluidsynth.service"

install -o root -g root -m 0644 "$root/deploy/sshd-alesis.conf" /etc/ssh/sshd_config.d/60-alesis.conf
sshd -t
systemctl reload ssh

install -o root -g root -m 0644 "$root/deploy/systemd/alesis-server.service" /etc/systemd/system/alesis-server.service
install -o root -g root -m 0644 "$root/deploy/systemd/alesis-kiosk.service" /etc/systemd/system/alesis-kiosk.service
systemctl daemon-reload
systemctl enable alesis-server.service alesis-kiosk.service

runuser -u "$runtime_user" -- npm ci --prefix "$root"
runuser -u "$runtime_user" -- npm run build --prefix "$root"

printf 'Alesis Pi setup complete. Reboot to start the server and kiosk.\n'
