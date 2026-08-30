import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import toneMidi from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import type { RecordedMidiEvent } from "./loop-playback.js";
import { exportMp3Session, recordingToMidi } from "./mp3-exporter.js";

const { Midi } = toneMidi;

const soundFontPath = "/home/liz.izatt/Downloads/HS Synthetic Electronic.sf2";
const percussionPath = "/usr/share/sounds/sf2/FluidR3_GM.sf2";

function exportSnapshot() {
  const engine = new SimulatedHostEngine({
    soundFonts: [{ id: "hs", name: "HS Synthetic Electronic" }],
    selectedSoundFontId: "hs",
    soundFontPresets: [{ id: "0:0", bank: 0, program: 0, name: "Solar Winds" }],
    selectedSoundFontPresetId: "0:0",
  });
  void engine.execute({ type: "select-synth", synthId: "soundfont" });
  const snapshot = engine.snapshot();
  snapshot.settings.bpm = 120;
  snapshot.settings.beatsPerMeasure = 4;
  snapshot.settings.loopMeasures = 1;
  snapshot.promoted = [
    { id: "take-1", cycle: 0, level: 0.8, muted: false, waveform: [] },
    { id: "take-2", cycle: 1, level: 0.6, muted: true, waveform: [] },
  ];
  return snapshot;
}

const melodicRecording: RecordedMidiEvent[] = [
  { position: 0, event: { type: "control-change", channel: 0, controller: 64, value: 127 } },
  { position: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
  { position: 0.25, event: { type: "pitch-bend", channel: 0, value: 0.5 } },
  { position: 0.5, event: { type: "note-off", channel: 0, note: 60 } },
  { position: 0.5, event: { type: "control-change", channel: 0, controller: 64, value: 0 } },
];

describe("MP3 exporter", () => {
  it("rejects incomplete and existing export destinations", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "alesis-recordings-errors-"));
    try {
      const snapshot = exportSnapshot();
      await expect(exportMp3Session({ name: "../Escape", snapshot, recordings: new Map([["take-1", melodicRecording], ["take-2", melodicRecording]]), soundFontPath, outputRoot })).rejects.toThrow();
      await expect(exportMp3Session({ name: "Missing", snapshot, recordings: new Map(), soundFontPath, outputRoot })).rejects.toThrow("Missing recording");
      await mkdir(join(outputRoot, "Existing"));
      await expect(exportMp3Session({ name: "Existing", snapshot, recordings: new Map([["take-1", melodicRecording], ["take-2", melodicRecording]]), soundFontPath, outputRoot })).rejects.toThrow(/exist/i);
      snapshot.promoted = [];
      await expect(exportMp3Session({ name: "Empty", snapshot, recordings: new Map(), soundFontPath, outputRoot })).rejects.toThrow("No promoted tracks");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("preserves notes, control changes, pitch bend, and percussion in Standard MIDI", () => {
    const snapshot = exportSnapshot();
    const bytes = recordingToMidi([
      ...melodicRecording,
      { position: 0.25, event: { type: "note-on", channel: 9, note: 36, velocity: 110 } },
      { position: 0.3, event: { type: "note-off", channel: 9, note: 36 } },
    ], snapshot.promoted[0]!, snapshot);
    const midi = new Midi(bytes);

    expect(midi.tracks.find(({ channel }) => channel === 0)?.notes[0]).toMatchObject({ midi: 60 });
    expect(midi.tracks.find(({ channel }) => channel === 0)?.controlChanges[64]?.[0]?.value).toBe(1);
    expect(midi.tracks.find(({ channel }) => channel === 0)?.pitchBends.some(({ value }) => Math.abs(value - 0.5) < 0.005)).toBe(true);
    expect(midi.tracks.find(({ channel }) => channel === 9)?.notes[0]).toMatchObject({ midi: 36 });
  });

  it.skipIf(!existsSync(soundFontPath) || !existsSync(percussionPath))("writes every promoted track and a merged MP3", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "alesis-recordings-test-"));
    try {
      const snapshot = exportSnapshot();
      const result = await exportMp3Session({
        name: "Test Session",
        snapshot,
        recordings: new Map([
          ["take-1", melodicRecording],
          ["take-2", [
            { position: 0, event: { type: "note-on", channel: 9, note: 36, velocity: 110 } },
            { position: 0.1, event: { type: "note-off", channel: 9, note: 36 } },
          ]],
        ]),
        soundFontPath,
        percussionSoundFontPath: percussionPath,
        outputRoot,
      });

      expect(result.tracks.map((path) => path.split("/").at(-1))).toEqual(["track-01.mp3", "track-02.mp3"]);
      expect(result.mix.endsWith("/Test Session/mix.mp3")).toBe(true);
      for (const path of [...result.tracks, result.mix]) {
        expect((await stat(path)).size).toBeGreaterThan(1_000);
        expect((await readFile(path)).subarray(0, 3).toString()).toMatch(/ID3|\xff/);
      }
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(!existsSync(percussionPath))("renders Neon Pressure and percussion to MP3", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "alesis-neon-export-test-"));
    try {
      const snapshot = exportSnapshot();
      snapshot.synth.selectedId = "subtractive";
      snapshot.synth.parameterValues = { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2, cutoff: 0.7, resonance: 0.2 };
      snapshot.promoted = [snapshot.promoted[0]!];
      const result = await exportMp3Session({
        name: "Neon Test",
        snapshot,
        recordings: new Map([["take-1", [...melodicRecording,
          { position: 0.25, event: { type: "note-on", channel: 9, note: 36, velocity: 110 } },
          { position: 0.3, event: { type: "note-off", channel: 9, note: 36 } },
        ]]]),
        soundFontPath: percussionPath,
        percussionSoundFontPath: percussionPath,
        outputRoot,
      });
      expect((await stat(result.tracks[0]!)).size).toBeGreaterThan(1_000);
      expect((await stat(result.mix)).size).toBeGreaterThan(1_000);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
