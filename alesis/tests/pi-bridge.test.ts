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
});

async function createFixture(): Promise<{ binDirectory: string; logPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "alesis-pi-bridge-test-"));
  temporaryDirectories.add(root);
  const binDirectory = join(root, "bin");
  const logPath = join(root, "events.log");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(binDirectory));
  await writeExecutable(join(binDirectory, "ssh"), `#!/usr/bin/env bash
set -euo pipefail
printf 'ssh %s\n' "$*" >> "$TEST_LOG"
`);
  return { binDirectory, logPath };
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

function runBridge(args: string[], fixture: { binDirectory: string; logPath: string }): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bridgePath, args, {
      env: { ...process.env, PATH: `${fixture.binDirectory}:${process.env.PATH ?? ""}`, TEST_LOG: fixture.logPath },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => resolve({ code: null, stderr: error.message }));
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}
