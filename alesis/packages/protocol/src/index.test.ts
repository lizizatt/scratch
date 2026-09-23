import { describe, expect, it } from "vitest";
import { commandEnvelopeSchema, engineSnapshotSchema, PROTOCOL_VERSION, serverMessageSchema } from "./index.js";

describe("control protocol", () => {
  it("accepts compact high-rate snapshot updates", () => {
    const message = serverMessageSchema.parse({
      type: "snapshot-update",
      update: {
        revision: 1,
        engine: { mode: "simulated", midiConnected: true, audioConnected: true, midiEventsReceived: 2, lastMidiEvent: "note-on" },
        transport: { state: "playing", cycle: 0, progress: 0.25 },
        capture: { currentWaveform: [], hasCurrentEvents: true, staged: null, previousStaged: null, stagedAudible: true, quantization: "off" },
        synth: { selectedId: "subtractive", instruments: [], soundFonts: [], selectedSoundFontId: null, soundFontPresets: [], selectedSoundFontPresetId: null, parameterValues: {} },
        pads: { mode: "drums", navigationTarget: "voices", navigationIndex: 0, navigationCount: 0, selectedDrumKitId: null, samplePageIndex: 0, samplePageCount: 0, samplePage: Array(8).fill(null), sampleLibraryStatus: "ready", drumKits: [] },
      },
      readiness: {
        soundFont: { ready: true },
        synth: { ready: true },
        audio: { ready: true },
        midi: { ready: true },
      },
    });

    expect(message.type).toBe("snapshot-update");
  });

  it("accepts a versioned command envelope", () => {
    const parsed = commandEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      commandId: "b3c83c76-2f54-45af-a1e0-cddff9b399f7",
      command: { type: "set-take-level", takeId: "take-1", level: 0.72 },
    });

    expect(parsed.command.type).toBe("set-take-level");
  });

  it("validates pad commands and rejects invalid pad indices", () => {
    const envelope = (command: unknown) => commandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      commandId: crypto.randomUUID(),
      command,
    }).success;

    expect(envelope({ type: "set-pad-mode", mode: "samples" })).toBe(true);
    expect(envelope({ type: "step-pad-navigation", direction: -1 })).toBe(true);
    expect(envelope({ type: "select-pad-program", program: 127 })).toBe(true);
    expect(envelope({ type: "select-pad-program", program: 128 })).toBe(true);
    expect(envelope({ type: "select-pad-program", program: 1.5 })).toBe(false);
    expect(envelope({ type: "select-pad-program", program: -1 })).toBe(false);
    expect(envelope({ type: "select-pad-program", program: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(envelope({ type: "trigger-sample-pad", pad: 7, velocity: 1 })).toBe(true);
    expect(envelope({ type: "trigger-sample-pad", pad: 8, velocity: 1 })).toBe(false);
    expect(envelope({ type: "trigger-sample-pad", pad: 0, velocity: 0 })).toBe(false);
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

  it("accepts safe export folder names and rejects path traversal", () => {
    expect(commandEnvelopeSchema.safeParse({ protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(), command: { type: "export-mp3", name: "Friday Jam 01" } }).success).toBe(true);
    expect(commandEnvelopeSchema.safeParse({ protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(), command: { type: "export-mp3", name: "../escape" } }).success).toBe(false);
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
        velocityCurve: "strong",
        metronomeEnabled: true,
        metronomeVolume: 0.65,
        countInEnabled: true,
      },
      transport: { state: "stopped", cycle: 0, progress: 0 },
      monitorOnly: false,
      synth: { selectedId: "subtractive", instruments: [], soundFonts: [], selectedSoundFontId: null, soundFontPresets: [], selectedSoundFontPresetId: null, parameterValues: {} },
      pads: { mode: "drums", navigationTarget: "voices", navigationIndex: 0, navigationCount: 0, selectedDrumKitId: null, samplePageIndex: 0, samplePageCount: 0, samplePage: Array(8).fill(null), sampleLibraryStatus: "ready", drumKits: [] },
      arpeggiator: { enabled: false, mode: "up", rate: "1/8", octaves: 1, gate: 0.5, latch: false, swing: 0 },
      drums: { enabled: false, pattern: "four-on-floor", volume: 0.7 },
      capture: { currentWaveform: Array.from({ length: 257 }, () => 0), hasCurrentEvents: false, staged: null, previousStaged: null, stagedAudible: true, quantization: "off" },
      promoted: [],
      canUndoDelete: false,
    };

    expect(() => engineSnapshotSchema.parse(snapshot)).toThrow();
  });
});
