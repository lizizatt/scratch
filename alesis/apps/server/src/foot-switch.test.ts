import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FootSwitch } from "./foot-switch.js";

let directory: string;
let device: string;
const switches: FootSwitch[] = [];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "alesis-footswitch-"));
  device = join(directory, "event-kbd");
  await writeFile(device, "");
});
afterEach(async () => {
  for (const footSwitch of switches.splice(0)) footSwitch.close();
  await rm(directory, { recursive: true, force: true });
});

/** A reader that prints the given lines, then optionally exits or idles. */
const reader = (script: string) => () => ["node", ["-e", script]] as [string, string[]];

function watch(script: string, devicePath = device, retryMs = 20) {
  const changes: boolean[] = [];
  const logs: string[] = [];
  const footSwitch = new FootSwitch({ devicePath, onChange: (down) => changes.push(down), log: (message) => logs.push(message), retryMs, command: reader(script) });
  switches.push(footSwitch);
  footSwitch.start();
  return { footSwitch, changes, logs };
}

const idle = "setInterval(() => {}, 1000)";
const waitFor = async (condition: () => boolean) => { for (let i = 0; i < 300 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10)); expect(condition()).toBe(true); };

describe("foot switch", () => {
  it("reports presses and releases from the reader", async () => {
    const { changes } = watch(`console.log("down"); console.log("down"); console.log("up"); console.log("down"); ${idle}`);
    await waitFor(() => changes.length === 3);
    expect(changes).toEqual([true, false, true]);
  });

  it("releases a held pedal when its reader dies, then reconnects", async () => {
    const { changes, logs } = watch('console.log("down"); setTimeout(() => process.exit(1), 30)');
    await waitFor(() => changes.length >= 3);
    expect(changes.slice(0, 3)).toEqual([true, false, true]);
    expect(logs[0]).toMatch(/stopped/);
  });

  it("waits for an unplugged device instead of starting a reader", async () => {
    const missing = join(directory, "later");
    const { changes } = watch('console.log("down"); ' + idle, missing);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(changes).toEqual([]);
    await writeFile(missing, "");
    await waitFor(() => changes.length === 1);
    expect(changes).toEqual([true]);
  });

  it("releases and stops on close", async () => {
    const { footSwitch, changes } = watch(`console.log("down"); ${idle}`);
    await waitFor(() => changes.length === 1);
    footSwitch.close();
    expect(changes).toEqual([true, false]);
  });
});
