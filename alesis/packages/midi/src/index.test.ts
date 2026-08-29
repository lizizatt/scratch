import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeMidiMessage, discoverVortexDevice, MidiByteStreamDecoder, SoftwareVortex } from "./index.js";

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

  it("discovers the Vortex by USB ID rather than ALSA card number", () => {
    const root = mkdtempSync(join(tmpdir(), "alesis-midi-"));
    const asound = join(root, "asound");
    const devices = join(root, "snd");
    mkdirSync(join(asound, "card7"), { recursive: true });
    mkdirSync(devices);
    writeFileSync(join(asound, "card7", "usbid"), "13B2:005F\n");
    writeFileSync(join(asound, "card7", "midi0"), "Vortex Wireless 2\n\nType: Legacy\n");
    writeFileSync(join(devices, "midiC7D0"), "");

    expect(discoverVortexDevice(asound, devices)).toEqual({
      id: "alsa:midiC7D0",
      name: "Vortex Wireless 2",
      path: join(devices, "midiC7D0"),
      usbId: "13b2:005f",
    });
    rmSync(root, { recursive: true });
  });

  it("decodes split and running-status messages while ignoring realtime and SysEx", () => {
    const events: unknown[] = [];
    const decoder = new MidiByteStreamDecoder((event) => events.push(event));

    decoder.push([0x90, 60]);
    decoder.push([0xf8, 100, 62, 0, 0xf0, 1, 2]);
    decoder.push([0xf7, 0xe0, 0, 64]);

    expect(events).toEqual([
      { type: "note-on", channel: 0, note: 60, velocity: 100 },
      { type: "note-off", channel: 0, note: 62 },
      { type: "pitch-bend", channel: 0, value: 0 },
    ]);
  });
});
