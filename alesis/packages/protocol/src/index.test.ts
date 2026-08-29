import { describe, expect, it } from "vitest";
import { commandEnvelopeSchema, engineSnapshotSchema, PROTOCOL_VERSION } from "./index.js";

describe("control protocol", () => {
  it("accepts a versioned command envelope", () => {
    const parsed = commandEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      commandId: "b3c83c76-2f54-45af-a1e0-cddff9b399f7",
      command: { type: "set-take-level", takeId: "take-1", level: 0.72 },
    });

    expect(parsed.command.type).toBe("set-take-level");
  });

  it("rejects unsafe or incompatible network values", () => {
    expect(() => commandEnvelopeSchema.parse({
      protocolVersion: 2,
      commandId: "not-a-uuid",
      command: { type: "set-take-level", takeId: "take-1", level: 4 },
    })).toThrow();
  });

  it("carries explicit confirmation for a destructive tempo change", () => {
    const parsed = commandEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      commandId: "e80e6a3c-62af-43f1-8a26-ab184eb95794",
      command: { type: "configure", settings: { bpm: 96 }, clearAudio: true },
    });

    expect(parsed.command).toMatchObject({ clearAudio: true });
  });

  it("bounds waveform summaries", () => {
    const snapshot = {
      protocolVersion: PROTOCOL_VERSION,
      revision: 0,
      engine: { mode: "simulated", midiConnected: true, audioConnected: true, midiEventsReceived: 0, lastMidiEvent: null },
      settings: {
        bpm: 120,
        beatsPerMeasure: 4,
        loopMeasures: 4,
        midiInputId: "software-vortex",
        audioOutputId: "simulated-output",
        metronomeEnabled: true,
        metronomeVolume: 0.65,
        countInEnabled: true,
      },
      transport: { state: "stopped", cycle: 0, progress: 0 },
      monitorOnly: false,
      synth: { selectedId: "subtractive", available: [], soundFonts: [], selectedSoundFontId: null, parameters: [] },
      capture: { currentWaveform: Array.from({ length: 257 }, () => 0), staged: null, stagedAudible: true },
      promoted: [],
      canUndoDelete: false,
    };

    expect(() => engineSnapshotSchema.parse(snapshot)).toThrow();
  });
});
