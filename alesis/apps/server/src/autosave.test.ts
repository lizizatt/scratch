import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver, defaultAutosavePath, readAutosave } from "./autosave.js";

let directory: string;
let path: string;
beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  directory = await mkdtemp(join(tmpdir(), "alesis-autosave-"));
  path = join(directory, "nested", "autosave.json");
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

function autosaver(overrides: Partial<ConstructorParameters<typeof Autosaver>[0]> & { session?: { value: string | null } } = {}) {
  const session = overrides.session ?? { value: "one" };
  const errors: string[] = [];
  const saver = new Autosaver({ path, capture: () => session.value, busy: () => false, playing: () => false, onError: (message) => errors.push(message), ...overrides });
  return { saver, session, errors };
}

describe("autosave", () => {
  it("defaults under the user data directory and honors an override", () => {
    expect(defaultAutosavePath({ XDG_DATA_HOME: "/data" })).toBe("/data/alesis/autosave-loop-session-v1.json");
    expect(defaultAutosavePath({ ALESIS_AUTOSAVE_PATH: "/x/y.json" })).toBe("/x/y.json");
  });

  it("reads nothing when there is no file", async () => {
    expect(await readAutosave(path)).toBeNull();
  });

  it("collapses a burst of requests into one write after the delay", async () => {
    const { saver, session } = autosaver({ delayMs: 1_000 });
    saver.request();
    saver.request();
    await vi.advanceTimersByTimeAsync(999);
    expect(await readAutosave(path)).toBeNull();
    session.value = "two";
    await vi.advanceTimersByTimeAsync(1);
    await saver.flush();
    expect(await readAutosave(path)).toBe("two");
    await saver.dispose();
  });

  it("leaves a whole file behind: no temporary files and the previous content until replaced", async () => {
    const { saver, session } = autosaver();
    await saver.flush();
    session.value = "second";
    await saver.flush();
    expect(await readdir(join(directory, "nested"))).toEqual(["autosave.json"]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await saver.dispose();
  });

  it("skips writes when nothing changed", async () => {
    const { saver } = autosaver();
    await saver.flush();
    await writeFile(path, "touched elsewhere");
    await saver.flush();
    expect(await readFile(path, "utf8")).toBe("touched elsewhere");
    await saver.dispose();
  });

  it("removes the file once there are no completed takes", async () => {
    const { saver, session } = autosaver();
    await saver.flush();
    session.value = null;
    await saver.flush();
    expect(await readAutosave(path)).toBeNull();
    await saver.dispose();
  });

  it("waits while a session replacement is under way and then saves", async () => {
    const state = { busy: true };
    const { saver } = autosaver({ busy: () => state.busy, delayMs: 500 });
    await saver.flush();
    expect(await readAutosave(path)).toBeNull();
    state.busy = false;
    await vi.advanceTimersByTimeAsync(500);
    await saver.flush();
    expect(await readAutosave(path)).toBe("one");
    await saver.dispose();
  });

  it("renews on the heartbeat only while playing", async () => {
    const state = { playing: false };
    const { saver, session } = autosaver({ playing: () => state.playing, heartbeatMs: 10_000, delayMs: 100 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await readAutosave(path)).toBeNull();
    state.playing = true;
    session.value = "mid-play";
    await vi.advanceTimersByTimeAsync(10_200);
    await saver.flush();
    expect(await readAutosave(path)).toBe("mid-play");
    await saver.dispose();
  });

  it("reports a failed save and keeps trying later", async () => {
    const { saver, session, errors } = autosaver();
    session.value = "ok";
    const capture = vi.fn().mockImplementationOnce(() => { throw new Error("export failed"); }).mockImplementation(() => session.value);
    const retry = new Autosaver({ path, capture, busy: () => false, playing: () => false, onError: (message) => errors.push(message) });
    await retry.flush();
    expect(errors).toEqual(["Unable to autosave loops: export failed"]);
    await retry.flush();
    expect(await readAutosave(path)).toBe("ok");
    await retry.dispose();
    await saver.dispose();
  });
});
