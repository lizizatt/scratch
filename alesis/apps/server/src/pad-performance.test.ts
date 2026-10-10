import { describe, expect, it, vi } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import { PadPerformance, padControlCommand } from "./pad-performance.js";

function fixture() {
  const engine = new SimulatedHostEngine();
  const samples = { trigger: vi.fn(() => true), release: vi.fn(() => true), panic: vi.fn() };
  const drum = vi.fn();
  const control = vi.fn((action, valid) => valid() ? engine.execute(padControlCommand(action, engine.snapshot())) : Promise.resolve(null));
  const pads = new PadPerformance({ snapshot: () => engine.snapshot(), samples, drum, control });
  return { engine, samples, drum, control, pads };
}

describe("shared pad performance", () => {
  it("does not let a late failed completion release a newer press from the same source", async () => {
    const { engine, samples, drum } = fixture();
    await engine.execute({ type: "configure-pad", mode: "drums", page: 0, pad: 0, action: { kind: "control", target: "metronome", operation: "toggle" } });
    let finish!: (result: Awaited<ReturnType<typeof engine.execute>>) => void;
    const control = vi.fn(async (action) => {
      const result = await engine.execute(padControlCommand(action, engine.snapshot()));
      if (control.mock.calls.length === 1) return new Promise<typeof result>((resolve) => { finish = resolve; });
      return result;
    });
    const pads = new PadPerformance({ snapshot: () => engine.snapshot(), samples, drum, control });
    pads.press("hardware", 1, 100);
    const first = pads.press("hardware", 0, 100);
    await Promise.resolve();
    pads.release("hardware", 0);
    await pads.press("hardware", 0, 100);
    finish({ accepted: false, revision: 0, appliedCycle: 0 });
    await first;
    await pads.press("hardware", 0, 100);
    expect(control).toHaveBeenCalledTimes(2);
    expect(engine.snapshot().settings.metronomeEnabled).toBe(true);
    pads.reset();
  });

  it.each(["rejected", "thrown"] as const)("keeps a control latched until release after a %s acknowledgement", async (failure) => {
    const { engine, samples, drum } = fixture();
    await engine.execute({ type: "configure-pad", mode: "drums", page: 0, pad: 0, action: { kind: "control", target: "metronome", operation: "toggle" } });
    const control = vi.fn(async (action) => {
      const result = await engine.execute(padControlCommand(action, engine.snapshot()));
      if (failure === "thrown") throw new Error("Storage failed after applying");
      return { ...result, accepted: false, error: "Storage failed after applying" };
    });
    const pads = new PadPerformance({ snapshot: () => engine.snapshot(), samples, drum, control });
    await Promise.resolve(pads.press("hardware", 0, 100)).catch(() => {});
    expect(engine.snapshot().settings.metronomeEnabled).toBe(false);
    await Promise.resolve(pads.press("hardware", 0, 100)).catch(() => {});
    expect(control).toHaveBeenCalledTimes(1);
    expect(engine.snapshot().settings.metronomeEnabled).toBe(false);
    pads.release("hardware", 0);
    await Promise.resolve(pads.press("hardware", 0, 100)).catch(() => {});
    expect(control).toHaveBeenCalledTimes(2);
    expect(engine.snapshot().settings.metronomeEnabled).toBe(true);
  });

  it.each(["transport", "drums", "metronome", "arpeggiator"] as const)("resolves %s toggle and explicit on/off against current state", async (target) => {
    const { engine } = fixture();
    const action = { kind: "control" as const, target, operation: "off" as const };
    const active = () => {
      const snapshot = engine.snapshot();
      return target === "transport" ? snapshot.transport.state !== "stopped" : target === "metronome" ? snapshot.settings.metronomeEnabled : target === "drums" ? snapshot.drums.enabled : snapshot.arpeggiator.enabled;
    };
    await engine.execute(padControlCommand(action, engine.snapshot()));
    expect(active()).toBe(false);
    for (const operation of ["on", "on", "toggle", "off", "toggle"] as const) {
      const before = active();
      await engine.execute(padControlCommand({ ...action, operation }, engine.snapshot()));
      expect(active()).toBe(operation === "toggle" ? !before : operation === "on");
    }
    if (target === "drums") expect(engine.snapshot().transport.state).toBe("stopped");
  });

  it("retains drum defaults and prevents an old release from stopping a remapped sample", async () => {
    const { engine, pads, samples, drum } = fixture();
    pads.press("hardware", 7, 92);
    expect(drum).toHaveBeenLastCalledWith({ type: "note-on", channel: 9, note: 43, velocity: 92 }, true);
    pads.reset();
    expect(drum).toHaveBeenLastCalledWith({ type: "note-off", channel: 9, note: 43 }, false);
    await engine.execute({ type: "set-pad-mode", mode: "samples" });
    pads.press("browser", 7, 100);
    pads.release("hardware", 7);
    expect(samples.release).not.toHaveBeenCalled();
    pads.release("browser", 7);
    expect(samples.release).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("toggles controls once per press, never on release or disconnect", async () => {
    const { engine, pads, control, drum } = fixture();
    await engine.execute({ type: "configure-pad", mode: "drums", page: 0, pad: 0, action: { kind: "control", target: "metronome", operation: "toggle" } });
    await pads.press("hardware", 0, 100);
    await pads.press("hardware", 0, 100);
    expect(engine.snapshot().settings.metronomeEnabled).toBe(false);
    pads.release("hardware", 0);
    pads.release("hardware", 0);
    expect(control).toHaveBeenCalledTimes(1);
    await pads.press("browser", 0, 100);
    pads.reset();
    expect(engine.snapshot().settings.metronomeEnabled).toBe(true);
    expect(control).toHaveBeenCalledTimes(2);
    expect(drum).not.toHaveBeenCalled();
  });

  it("starts sample audio synchronously and retains another owner's hold", async () => {
    const { engine, pads, samples } = fixture();
    await engine.execute({ type: "set-pad-mode", mode: "samples" });
    pads.press("hardware", 0, 77);
    expect(samples.trigger).toHaveBeenCalledWith(0, 77);
    pads.press("browser", 0, 100);
    pads.release("unrelated", 0);
    pads.release("hardware", 0);
    expect(samples.release).not.toHaveBeenCalled();
    pads.release("browser", 0);
    expect(samples.release).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("invalidates pending controls on remap but not ordinary quick release", async () => {
    const { engine, samples, drum } = fixture();
    const queued: Array<() => Promise<unknown>> = [];
    const pads = new PadPerformance({ snapshot: () => engine.snapshot(), samples, drum, control(action, valid) {
      queued.push(() => valid() ? engine.execute(padControlCommand(action, engine.snapshot())) : Promise.resolve(null));
      return Promise.resolve(null);
    } });
    await engine.execute({ type: "configure-pad", mode: "drums", page: 0, pad: 0, action: { kind: "control", target: "arpeggiator", operation: "on" } });
    pads.press("hardware", 0, 100);
    pads.release("hardware", 0);
    await queued.shift()!();
    expect(engine.snapshot().arpeggiator.enabled).toBe(true);
    await engine.execute({ type: "configure-arpeggiator", settings: { enabled: false } });
    pads.press("hardware", 0, 100);
    pads.reset();
    await queued.shift()!();
    expect(engine.snapshot().arpeggiator.enabled).toBe(false);
  });
});
