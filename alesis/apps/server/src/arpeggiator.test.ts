import { describe, expect, it } from "vitest";
import { MidiArpeggiator, type ArpeggiatorConfig } from "./arpeggiator.js";

const defaults: ArpeggiatorConfig = {
  enabled: true,
  mode: "up",
  rate: "1/8",
  octaves: 1,
  gate: 0.5,
  latch: false,
  swing: 0,
};

describe("MidiArpeggiator", () => {
  it("orders held notes and emits gated steps on the host clock", () => {
    const arp = new MidiArpeggiator(defaults);
    arp.handle({ type: "note-on", channel: 0, note: 67, velocity: 100 });
    arp.handle({ type: "note-on", channel: 0, note: 60, velocity: 90 });

    expect(arp.advance(0, 120)).toEqual([{ type: "note-on", channel: 0, note: 60, velocity: 90 }]);
    expect(arp.advance(0.125, 120)).toEqual([{ type: "note-off", channel: 0, note: 60 }]);
    expect(arp.advance(0.125, 120)).toEqual([{ type: "note-on", channel: 0, note: 67, velocity: 100 }]);
  });

  it("uses Tonal note transposition for octave expansion", () => {
    const arp = new MidiArpeggiator({ ...defaults, octaves: 2 });
    arp.handle({ type: "note-on", channel: 0, note: 60, velocity: 100 });

    expect(arp.advance(0, 120)[0]).toMatchObject({ note: 60 });
    expect(arp.advance(0.25, 120).find(({ type }) => type === "note-on")).toMatchObject({ note: 72 });
  });

  it("supports down, up-down, played, and deterministic random modes", () => {
    const notes = [64, 60, 67];
    const first = (mode: ArpeggiatorConfig["mode"], random = () => 0) => {
      const arp = new MidiArpeggiator({ ...defaults, mode }, random);
      notes.forEach((note) => arp.handle({ type: "note-on", channel: 0, note, velocity: 100 }));
      return arp.advance(0, 120)[0];
    };

    expect(first("down")).toMatchObject({ note: 67 });
    expect(first("up-down")).toMatchObject({ note: 60 });
    expect(first("played")).toMatchObject({ note: 64 });
    expect(first("random", () => 0.5)).toMatchObject({ note: 64 });
  });

  it("latches released notes until latch is disabled", () => {
    const arp = new MidiArpeggiator({ ...defaults, latch: true });
    arp.handle({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    arp.handle({ type: "note-off", channel: 0, note: 60 });
    expect(arp.advance(0, 120)).toHaveLength(1);

    expect(arp.configure({ latch: false })).toContainEqual({ type: "note-off", channel: 0, note: 60 });
    expect(arp.advance(0.25, 120)).toEqual([]);
  });

  it("passes all input through unchanged when disabled", () => {
    const arp = new MidiArpeggiator({ ...defaults, enabled: false });
    const event = { type: "note-on", channel: 2, note: 60, velocity: 100 } as const;
    expect(arp.handle(event)).toEqual([event]);
  });

  it("releases the active note and clears stale held notes when disabled", () => {
    const arp = new MidiArpeggiator(defaults);
    arp.handle({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    arp.advance(0, 120);

    expect(arp.configure({ enabled: false })).toEqual([{ type: "note-off", channel: 0, note: 60 }]);
    arp.configure({ enabled: true });
    expect(arp.advance(0, 120)).toEqual([]);
  });

  it("resets and releases the sequence when mode changes", () => {
    const arp = new MidiArpeggiator(defaults);
    arp.handle({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    arp.handle({ type: "note-on", channel: 0, note: 67, velocity: 100 });
    arp.advance(0, 120);

    expect(arp.configure({ mode: "down" })).toEqual([{ type: "note-off", channel: 0, note: 60 }]);
    expect(arp.advance(0, 120)[0]).toMatchObject({ type: "note-on", note: 67 });
  });

  it("applies swing timing and clamps multi-octave notes to MIDI range", () => {
    const arp = new MidiArpeggiator({ ...defaults, swing: 0.5, octaves: 4, gate: 0.1 });
    arp.handle({ type: "note-on", channel: 0, note: 120, velocity: 100 });
    expect(arp.advance(0, 120)[0]).toMatchObject({ note: 120 });
    expect(arp.advance(0.0375, 120)).toContainEqual({ type: "note-off", channel: 0, note: 120 });
    const next = arp.advance(0.3375, 120).find(({ type }) => type === "note-on");
    expect(next).toMatchObject({ note: 127 });
  });

  it("rejects out-of-range MIDI notes", () => {
    const arp = new MidiArpeggiator(defaults);
    expect(arp.handle({ type: "note-on", channel: 0, note: 128, velocity: 100 })).toEqual([]);
    expect(arp.advance(0, 120)).toEqual([]);
  });
});