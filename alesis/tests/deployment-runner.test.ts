import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const runnerPath = fileURLToPath(new URL("../deploy/run-jarvis.sh", import.meta.url));
const temporaryDirectories = new Set<string>();
let runner: ChildProcess | undefined;

afterEach(async () => {
  if (runner?.exitCode === null && runner.signalCode === null) {
    runner.kill("SIGKILL");
    await waitForExit(runner);
  }
  await Promise.all([...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })));
  temporaryDirectories.clear();
  runner = undefined;
});

describe("Jarvis deployment runner", () => {
  it("serves the production host and cleans up on SIGTERM", async () => {
    const fixture = await createFixture();
    runner = spawn(runnerPath, [], {
      env: {
        ...process.env,
        PATH: `${fixture.binDirectory}:${process.env.PATH ?? ""}`,
        TEST_LOG: fixture.logPath,
        JARVIS_ALESIS_ROOT: fixture.root,
        JARVIS_ALESIS_HOST: "127.0.0.2",
        JARVIS_ALESIS_PORT: "18787",
        JARVIS_ALESIS_TAILSCALE_PORT: "18788",
        JARVIS_ALESIS_READINESS_TIMEOUT_SECONDS: "2",
        JARVIS_TAILSCALE_EXECUTABLE: fixture.tailscalePath,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    await waitForLog(fixture.logPath, "tailscale serve --bg --https=18788 http://127.0.0.2:18787");
    runner.kill("SIGTERM");
    expect(await waitForExit(runner)).toEqual({ code: 143, signal: null });

    const log = await readFile(fixture.logPath, "utf8");
    expect(log).toContain(`npm start host=127.0.0.2 port=18787 cwd=${fixture.root}`);
    expect(log).toContain("curl http://127.0.0.2:18787/health");
    expect(log).toContain("app SIGTERM");
    expect(log.split("\n").filter((line) => line === "tailscale serve --https=18788 off")).toHaveLength(2);
  });
});

async function createFixture(): Promise<{
  root: string;
  binDirectory: string;
  logPath: string;
  tailscalePath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "alesis-deployment-test-"));
  temporaryDirectories.add(root);
  const binDirectory = join(root, "bin");
  const logPath = join(root, "events.log");
  const tailscalePath = join(binDirectory, "tailscale-test");
  await mkdir(binDirectory);
  await writeFile(join(root, "package.json"), "{}\n");
  await writeExecutable(join(binDirectory, "npm"), `#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s host=%s port=%s cwd=%s\\n' "$*" "\${HOST:-}" "\${PORT:-}" "$PWD" >> "$TEST_LOG"
trap 'printf "app SIGTERM\\n" >> "$TEST_LOG"; exit 0' TERM
trap 'printf "app SIGINT\\n" >> "$TEST_LOG"; exit 0' INT
while true; do sleep 0.1; done
`);
  await writeExecutable(join(binDirectory, "curl"), `#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\\n' "\${!#}" >> "$TEST_LOG"
`);
  await writeExecutable(tailscalePath, `#!/usr/bin/env bash
set -euo pipefail
printf 'tailscale %s\\n' "$*" >> "$TEST_LOG"
`);
  return { root, binDirectory, logPath, tailscalePath };
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

async function waitForLog(path: string, expected: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, "utf8")).includes(expected)) return;
    } catch {
      // The runner may not have created the log yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for deployment log entry: ${expected}`);
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
}
