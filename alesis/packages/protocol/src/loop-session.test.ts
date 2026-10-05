import { describe, expect, it } from "vitest";
import { LOOP_SESSION_MAX_BYTES, LOOP_SESSION_MAX_EVENTS_PER_TAKE, loopSessionSchema, midiEventSchema, parseLoopSession } from "./index.js";

const take = { take: { id: "a", cycle: 0, level: 0.4, muted: true, waveform: [0, 1] }, recording: [] };
function session() {
  return {
    format: "alesis-loop-session", version: 1,
    settings: { bpm: 120, beatsPerMeasure: 4, loopMeasures: 1, velocityCurve: "linear", metronomeEnabled: false, metronomeVolume: 0.2, countInEnabled: false },
    synth: { selectedId: "subtractive", parameterValues: {}, soundFont: null },
    drums: { enabled: false, pattern: "backbeat", volume: 0.5 }, percussion: null,
    arpeggiator: { enabled: false, mode: "up", rate: "1/8", octaves: 1, gate: 0.5, latch: false, swing: 0 },
    monitorOnly: false, stagedAudible: true, quantization: "off", staged: null, previousStaged: null, promoted: [structuredClone(take)],
  };
}

describe("loop session format", () => {
  it("accepts version one and timing beyond the audio-sample duration limit", () => {
    const value = session();
    value.settings.loopMeasures = 128;
    expect(parseLoopSession(JSON.stringify(value))).toEqual(value);
  });
  it.each([
    { version: 2 }, { format: "mp3" }, { devicePath: "/secret" }, { staged: take },
    { promoted: Array.from({ length: 13 }, (_, i) => ({ ...take, take: { ...take.take, id: String(i) } })) },
    { promoted: [take, take] },
    { staged: { ...take, rawRecording: [] }, promoted: [take] },
  ])("rejects invalid version, shape, IDs or take counts: %j", (patch) => {
    expect(loopSessionSchema.safeParse({ ...session(), ...patch }).success).toBe(false);
  });
  it("rejects device identities rather than stripping them", () => {
    const value = session();
    expect(loopSessionSchema.safeParse({ ...value, settings: { ...value.settings, midiInputId: "remote-device" } }).success).toBe(false);
  });
  it.each([
    { type: "note-on", channel: 16, note: 60, velocity: 100 },
    { type: "note-on", channel: 0, note: 60.5, velocity: 100 },
    { type: "note-off", channel: 0, note: -1 },
    { type: "pitch-bend", channel: 0, value: 1.01 },
    { type: "control-change", channel: 0, controller: 128, value: 0 },
    { type: "channel-pressure", channel: 0, value: 128 },
    { type: "program-change", channel: 0, program: 1 },
    { type: "pitch-bend", channel: 0, value: Number.NaN },
  ])("rejects malformed MIDI %j", (event) => {
    expect(midiEventSchema.safeParse(event).success).toBe(false);
  });
  it("bounds bytes, events per array, total events, and event positions", () => {
    expect(() => parseLoopSession(" ".repeat(LOOP_SESSION_MAX_BYTES + 1))).toThrow("4 MiB");
    expect(() => parseLoopSession("é".repeat(LOOP_SESSION_MAX_BYTES / 2 + 1))).toThrow("4 MiB");
    expect(() => parseLoopSession("not JSON")).toThrow();
    const event = { position: 0, event: { type: "note-off", channel: 0, note: 60 } };
    const recording = Array.from({ length: LOOP_SESSION_MAX_EVENTS_PER_TAKE }, () => event);
    expect(loopSessionSchema.safeParse({ ...session(), promoted: [{ ...take, recording: [...recording, event] }] }).success).toBe(false);
    expect(loopSessionSchema.safeParse({ ...session(), promoted: Array.from({ length: 4 }, (_, index) => ({ ...take, take: { ...take.take, id: String(index) }, recording })) }).success).toBe(false);
    for (const positions of [[-0.1], [1.1], [0.8, 0.2]]) {
      expect(loopSessionSchema.safeParse({ ...session(), promoted: [{ ...take, recording: positions.map((position) => ({ ...event, position })) }] }).success).toBe(false);
    }
  });
});
