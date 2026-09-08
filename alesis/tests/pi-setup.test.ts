import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const deployPath = (name: string): string => fileURLToPath(new URL(`../deploy/${name}`, import.meta.url));

describe("Pi deployment", () => {
  it("installs and enables silent services without starting them during setup", async () => {
    const setup = await readFile(deployPath("setup-pi.sh"), "utf8");

    expect(setup).toContain("systemctl enable alesis-server.service alesis-kiosk.service");
    expect(setup).not.toContain("systemctl enable --now");
    expect(setup).toContain("pipewire-pulse.socket wireplumber.service");
    expect(setup).toContain('ln -sfn /dev/null "$runtime_home/.config/systemd/user/$unit"');
    expect(setup).toContain('install -o root -g root -m 0644 "$root/deploy/asoundrc" /etc/asound.conf');
    expect(setup).toContain("amixer -q -c Device set Speaker 151 unmute");
  });

  it("runs the server as the default user with bounded crash restart", async () => {
    const unit = await readFile(deployPath("systemd/alesis-server.service"), "utf8");

    expect(unit).toContain("User=alesis");
    expect(unit).toContain("ExecStart=/usr/bin/npm start");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("StartLimitBurst=5");
    expect(unit).toContain("Environment=HOST=127.0.0.1");
    expect(unit).toContain("ExecStartPre=/usr/bin/amixer -q -c Device set Speaker 151 unmute");
  });

  it("starts Chromium after the server and restarts the kiosk on failure", async () => {
    const unit = await readFile(deployPath("systemd/alesis-kiosk.service"), "utf8");
    const runner = await readFile(deployPath("run-kiosk.sh"), "utf8");

    expect(unit).toContain("After=graphical.target alesis-server.service");
    expect(unit).toContain("ExecStart=/home/alesis/alesis/deploy/run-kiosk.sh");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus");
    expect(runner).toContain('"$origin/health"');
    expect(runner).toContain("--kiosk");
  });
});
