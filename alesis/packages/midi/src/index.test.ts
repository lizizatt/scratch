import { describe, expect, it, vi } from "vitest";
import { decodeMidiMessage, SoftwareVortex } from "./index.js";

describe("MIDI normalization", () => {
  it("decodes note, pressure, control, and 14-bit pitch bend messages", () => {
    expect(decodeMidiMessage([0x92, 60, 104])).toEqual({ type: "note-on", channel: 2, note: 60, velocity: 104 });
    expect(decodeMidiMessage([0x92, 60, 0])).toEqual({ type: "note-off", channel: 2, note: 60 });
    expect(decodeMidiMessage([0xb0, 64, 127])).toEqual({ type: "control-change", channel: 0, controller: 64, value: 127 });
    expect(decodeMidiMessage([0xd0, 73])).toEqual({ type: "channel-pressure", channel: 0, value: 73 });
    expect(decodeMidiMessage([0xe0, 0, 64])).toEqual({ type: "pitch-bend", channel: 0, value: 0 });
  });

  it("models expressive Vortex controls without hardware", () => {
    const vortex = new SoftwareVortex();
    const listener = vi.fn();
    vortex.subscribe(listener);

    vortex.keyDown(64, 111);
    vortex.pitchBend(-0.5);
    vortex.control("accelerometer", 96);
    vortex.pressure(70);
    vortex.keyUp(64);

    expect(listener.mock.calls.map(([event]) => event.type)).toEqual([
      "note-on", "pitch-bend", "control-change", "channel-pressure", "note-off",
    ]);
  });
});
