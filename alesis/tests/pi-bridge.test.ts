import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const bridgePath = fileURLToPath(new URL("../deploy/pi-bridge.sh", import.meta.url));
const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })));
  temporaryDirectories.clear();
});

describe("Pi bridge", () => {
  it("uses fixed read-only commands for the first hardware probe", async () => {
    const fixture = await createFixture();

    const result = await runBridge(["probe", "player@alesis.local"], fixture);

    expect(result.code).toBe(0);
    const log = await readFile(fixture.logPath, "utf8");
    expect(log).toContain("ssh -o BatchMode=yes -o ConnectTimeout=5 player@alesis.local hostname");
    expect(log).toContain("ssh -o BatchMode=yes -o ConnectTimeout=5 player@alesis.local vcgencmd get_throttled");
    expect(log).toContain("ssh -o BatchMode=yes -o ConnectTimeout=5 player@alesis.local aplay -l");
    expect(log).not.toContain("sudo");
  });

  it("copies the verified Miku SoundFont to the canonical filename", async () => {
    const fixture = await createFixture();
    const mikuPath = join(fixture.homeDirectory, "Downloads", "Vocaloid_Lah_Soundfont__Version_1.0_.sf2");
    await writeFile(mikuPath, "miku-fixture");

    const result = await runBridge(["miku-asset", "player@alesis.local"], fixture, {
      ALESIS_MIKU_SOUNDFONT_PATH: mikuPath,
      LOCAL_SHA256: "92c7cf7b32bb67720f4f1ba1954e6fb01aba0925362e18f68a3ed123657121df",
      REMOTE_SHA256: "92c7cf7b32bb67720f4f1ba1954e6fb01aba0925362e18f68a3ed123657121df",
    });

    expect(result.code).toBe(0);
    const log = await readFile(fixture.logPath, "utf8");
    expect(log).toContain(`sha256sum ${mikuPath}`);
    expect(log).toContain("rsync --archive --human-readable --progress");
    expect(log).toContain("player@alesis.local:Downloads/Vocaloid_Lah_Soundfont__Version_1.0_.sf2");
    expect(log).toContain("ssh -o BatchMode=yes -o ConnectTimeout=5 player@alesis.local sha256sum Downloads/Vocaloid_Lah_Soundfont__Version_1.0_.sf2");
  });

  it("rejects miku-asset when the local checksum is wrong and skips transfer", async () => {
    const fixture = await createFixture();
    const mikuPath = join(fixture.homeDirectory, "Downloads", "Vocaloid_Lah_Soundfont__Version_1.0_.sf2");
    await writeFile(mikuPath, "miku-fixture");

    const result = await runBridge(["miku-asset", "player@alesis.local"], fixture, {
      ALESIS_MIKU_SOUNDFONT_PATH: mikuPath,
      LOCAL_SHA256: "0000000000000000000000000000000000000000000000000000000000000000",
      REMOTE_SHA256: "92c7cf7b32bb67720f4f1ba1954e6fb01aba0925362e18f68a3ed123657121df",
    });

    expect(result.code).toBe(64);
    expect(result.stderr).toContain("checksum does not match the verified asset");
    const log = await readFile(fixture.logPath, "utf8");
    expect(log).not.toContain("rsync --archive --human-readable --progress");
  });
});

async function createFixture(): Promise<{ binDirectory: string; logPath: string; homeDirectory: string }> {
  const root = await mkdtemp(join(tmpdir(), "alesis-pi-bridge-test-"));
  temporaryDirectories.add(root);
  const binDirectory = join(root, "bin");
  const logPath = join(root, "events.log");
  const homeDirectory = join(root, "home");
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([
    mkdir(binDirectory, { recursive: true }),
    mkdir(join(homeDirectory, "Downloads"), { recursive: true }),
  ]));
  await writeExecutable(join(binDirectory, "ssh"), `#!/usr/bin/env bash
set -euo pipefail
printf 'ssh %s\n' "$*" >> "$TEST_LOG"
if [[ "$*" == *"sha256sum"* ]]; then
  printf '%s  %s\n' "\${REMOTE_SHA256:-missing}" "\${*: -1}"
fi
`);
  await writeExecutable(join(binDirectory, "rsync"), `#!/usr/bin/env bash
set -euo pipefail
printf 'rsync %s\n' "$*" >> "$TEST_LOG"
`);
  await writeExecutable(join(binDirectory, "sha256sum"), `#!/usr/bin/env bash
set -euo pipefail
printf 'sha256sum %s\n' "$*" >> "$TEST_LOG"
printf '%s  %s\n' "\${LOCAL_SHA256:-missing}" "$1"
`);
  return { binDirectory, logPath, homeDirectory };
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

function runBridge(
  args: string[],
  fixture: { binDirectory: string; logPath: string; homeDirectory: string },
  extraEnvironment: Record<string, string> = {},
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bridgePath, args, {
      env: {
        ...process.env,
        PATH: `${fixture.binDirectory}:${process.env.PATH ?? ""}`,
        TEST_LOG: fixture.logPath,
        HOME: fixture.homeDirectory,
        ...extraEnvironment,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => resolve({ code: null, stderr: error.message }));
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}
