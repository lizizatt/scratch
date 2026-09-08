import { describe, expect, it, vi } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import { DeviceHotplugCoordinator } from "./hotplug.js";

describe("DeviceHotplugCoordinator", () => {
  it("keeps transport running on MIDI loss but stops it on audio loss and never resumes", async () => {
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { countInEnabled: false } });
    await engine.execute({ type: "play" });
    const actions = {
      panic: vi.fn(),
      stopTransport: vi.fn(() => engine.execute({ type: "stop" }).then(() => undefined)),
      disconnectAudio: vi.fn(async () => {}),
      reconnectAudio: vi.fn(async () => true),
      disconnectMidi: vi.fn(async () => {}),
      reconnectMidi: vi.fn(async () => true),
      setReady: vi.fn(),
    };
    const coordinator = new DeviceHotplugCoordinator({ audio: true, midi: true }, actions);

    await coordinator.reconcile({ audio: true, midi: false });
    expect(actions.panic).toHaveBeenCalledTimes(1);
    expect(actions.disconnectMidi).toHaveBeenCalledOnce();
    expect(engine.snapshot().transport.state).toBe("playing");

    await coordinator.reconcile({ audio: true, midi: true });
    expect(actions.reconnectMidi).toHaveBeenCalledOnce();
    expect(engine.snapshot().transport.state).toBe("playing");

    await coordinator.reconcile({ audio: false, midi: true });
    expect(actions.stopTransport).toHaveBeenCalledOnce();
    expect(actions.disconnectAudio).toHaveBeenCalledOnce();
    expect(engine.snapshot().transport.state).toBe("stopped");

    await coordinator.reconcile({ audio: true, midi: true });
    expect(actions.reconnectAudio).toHaveBeenCalledOnce();
    expect(engine.snapshot().transport.state).toBe("stopped");
    expect(actions.setReady.mock.calls).toEqual([
      ["midi", false],
      ["midi", true],
      ["audio", false],
      ["audio", true],
    ]);
    expect(actions.panic).toHaveBeenCalledTimes(4);
  });
});
