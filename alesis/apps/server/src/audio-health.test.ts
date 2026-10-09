import { describe, expect, it, vi } from "vitest";
import { SilentAudioOutput } from "@alesis/audio";
import { createAudioHealthObserver } from "./audio-health.js";

describe("renderer health ownership", () => {
  it("forwards current renderer failures and recovery", () => {
    const initial = new SilentAudioOutput();
    const current = initial;
    const report = vi.fn();
    const observer = createAudioHealthObserver(() => current === initial, report);

    observer(false, "FluidSynth exited");
    observer(true);

    expect(report.mock.calls).toEqual([[false, "FluidSynth exited"], [true, undefined]]);
  });

  it("ignores an initial renderer's recovery rejection after a session swaps the output", async () => {
    const initial = new SilentAudioOutput();
    const candidate = new SilentAudioOutput();
    // Session replacements use the same device ID; ownership is object identity.
    expect(initial.id).toBe(candidate.id);
    let current = initial;
    let ready = false;
    const report = vi.fn((healthy: boolean) => { ready = healthy; });
    const initialObserver = createAudioHealthObserver(() => current === initial, report);
    const candidateObserver = createAudioHealthObserver(() => current === candidate, report);
    let rejectRecovery!: (error: Error) => void;
    const recovery = new Promise<void>((_resolve, reject) => { rejectRecovery = reject; })
      .catch((error: Error) => initialObserver(false, `Audio recovery failed: ${error.message}`));

    initialObserver(false, "FluidSynth exited");
    expect(report).toHaveBeenCalledTimes(1);
    expect(ready).toBe(false);

    current = candidate;
    candidateObserver(true);
    report.mockClear();
    rejectRecovery(new Error("retired renderer failed to restart"));
    await recovery;

    expect(ready).toBe(true);
    expect(report).not.toHaveBeenCalled();
    initialObserver(true);
    expect(report).not.toHaveBeenCalled();
    candidateObserver(false, "Current renderer exited");
    expect(ready).toBe(false);
    expect(report).toHaveBeenCalledExactlyOnceWith(false, "Current renderer exited");
  });

  it("ignores a candidate's health before it becomes current", () => {
    const current = new SilentAudioOutput();
    const candidate = new SilentAudioOutput();
    const report = vi.fn();
    const observer = createAudioHealthObserver(() => current === candidate, report);

    observer(true);
    observer(false, "Preparation failed");

    expect(report).not.toHaveBeenCalled();
  });
});
