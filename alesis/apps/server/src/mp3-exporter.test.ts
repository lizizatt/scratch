import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import toneMidi from "@tonejs/midi";
import { parseMidi } from "midi-file";
import { describe, expect, it } from "vitest";
import { NeonPressureSynth, type NeonPressureParameters } from "@alesis/audio";
import { SimulatedHostEngine } from "@alesis/engine";
import type { Take } from "@alesis/protocol";
import type { RecordedMidiEvent } from "./loop-playback.js";
import { exportMp3Session, recordingToMidi, recordingToSoundFontMidi, renderNeonWav } from "./mp3-exporter.js";

const { Midi } = toneMidi;

const soundFontPath = process.env.ALESIS_TEST_SOUNDFONT ?? "";
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

function renderNeonWavSynchronously(recording: RecordedMidiEvent[], take: Take, snapshot: ReturnType<typeof exportSnapshot>): Buffer {
  const sampleRate = 48_000;
  const frameCount = Math.round(60 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures * sampleRate);
  const synth = new NeonPressureSynth(sampleRate, snapshot.synth.parameterValues as unknown as Partial<NeonPressureParameters>);
  const output = new Float32Array(frameCount * 2);
  let frame = 0;
  for (const { position, event } of [...recording].sort((left, right) => left.position - right.position)) {
    if (event.channel === 9) continue;
    const eventFrame = Math.max(frame, Math.min(frameCount, Math.round(position * frameCount)));
    output.set(synth.render(eventFrame - frame), frame * 2);
    frame = eventFrame;
    synth.dispatchMidi(event.type === "note-on" ? { ...event, velocity: Math.round(event.velocity * take.level) } : event);
  }
  output.set(synth.render(frameCount - frame), frame * 2);

  const wav = Buffer.alloc(44 + output.length * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + output.length * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(output.length * 2, 40);
  for (let index = 0; index < output.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, output[index]!));
    wav.writeInt16LE(Math.round(sample < 0 ? sample * 32_768 : sample * 32_767), 44 + index * 2);
  }
  return wav;
}

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

  it("suppresses only mapped channel-10 note releases in SoundFont render MIDI", () => {
    const snapshot = exportSnapshot();
    const recording: RecordedMidiEvent[] = Array.from({ length: 8 }, (_, pad) => [
      { position: 0, event: { type: "note-on" as const, channel: 9, note: 36 + pad, velocity: 100 } },
      { position: 0.1, event: { type: "note-off" as const, channel: 9, note: 36 + pad } },
    ]).flat();
    recording.push(
      { position: 0.2, event: { type: "note-on", channel: 9, note: 44, velocity: 100 } },
      { position: 0.3, event: { type: "note-off", channel: 9, note: 44 } },
      { position: 0.4, event: { type: "note-on", channel: 0, note: 36, velocity: 100 } },
      { position: 0.5, event: { type: "note-off", channel: 0, note: 36 } },
      { position: 0.6, event: { type: "note-on", channel: 0, note: 38, velocity: 0 } },
    );

    const rendered = parseMidi(recordingToSoundFontMidi(recording, snapshot.promoted[0]!, snapshot));
    const general = parseMidi(recordingToMidi(recording, snapshot.promoted[0]!, snapshot));
    const noteReleases = (midi: ReturnType<typeof parseMidi>) => midi.tracks.flat().filter((event) => event.type === "noteOff");

    expect(noteReleases(rendered)).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 9, noteNumber: 44 }),
      expect.objectContaining({ channel: 0, noteNumber: 36 }),
      expect.objectContaining({ channel: 0, noteNumber: 38 }),
    ]));
    expect(noteReleases(rendered).some((event) => event.type === "noteOff" && event.channel === 9 && event.noteNumber >= 36 && event.noteNumber <= 43)).toBe(false);
    expect(noteReleases(general)).toHaveLength(11);
  });

  it("orders a 14-bit SoundFont bank before program and note events", () => {
    const snapshot = exportSnapshot();
    snapshot.synth.soundFontPresets = [{ id: "1200:56", bank: 1200, program: 56, name: "Trumpet" }];
    snapshot.synth.selectedSoundFontPresetId = "1200:56";

    const midi = parseMidi(recordingToMidi(melodicRecording, snapshot.promoted[0]!, snapshot));
    const events = midi.tracks.find((track) => track.some((event) => event.type === "noteOn"))!;
    const relevant = events.filter((event) => event.type === "controller" && (event.controllerType === 0 || event.controllerType === 32) || event.type === "programChange" || event.type === "noteOn");

    expect(relevant.slice(0, 4)).toMatchObject([
      { type: "controller", controllerType: 0, value: 9 },
      { type: "controller", controllerType: 32, value: 48 },
      { type: "programChange", programNumber: 56 },
      { type: "noteOn", noteNumber: 60 },
    ]);
  });

  it("initializes channel 9 with the selected drum kit program without a bank or melodic preset", () => {
    const snapshot = exportSnapshot();
    snapshot.pads.drumKits = [
      { id: "kit-3", bank: 128, program: 3, name: "Kit Three" },
      { id: "kit-7", bank: 128, program: 7, name: "Kit Seven" },
    ];
    snapshot.pads.selectedDrumKitId = "kit-7";
    snapshot.synth.soundFontPresets = [{ id: "5:56", bank: 5, program: 56, name: "Trumpet" }];
    snapshot.synth.selectedSoundFontPresetId = "5:56";

    const midi = parseMidi(recordingToMidi([
      ...melodicRecording,
      { position: 0.25, event: { type: "note-on", channel: 9, note: 36, velocity: 110 } },
    ], snapshot.promoted[0]!, snapshot));
    const drumEvents = midi.tracks.find((track) => track.some((event) => "channel" in event && event.channel === 9))!;
    const drumProgramIndex = drumEvents.findIndex((event) => event.type === "programChange");
    const drumNoteIndex = drumEvents.findIndex((event) => event.type === "noteOn");
    const melodicEvents = midi.tracks.find((track) => track.some((event) => event.type === "noteOn" && event.channel === 0))!;

    expect(drumEvents[drumProgramIndex]).toMatchObject({ type: "programChange", channel: 9, programNumber: 7 });
    expect(drumProgramIndex).toBeGreaterThanOrEqual(0);
    expect(drumProgramIndex).toBeLessThan(drumNoteIndex);
    expect(drumEvents.some((event) => event.type === "controller" && (event.controllerType === 0 || event.controllerType === 32))).toBe(false);
    expect(melodicEvents.find((event) => event.type === "programChange")).toMatchObject({ channel: 0, programNumber: 56 });
  });

  it("falls back to drum program zero when the selected kit is unavailable", () => {
    const snapshot = exportSnapshot();
    snapshot.pads.drumKits = [{ id: "kit-3", bank: 128, program: 3, name: "Kit Three" }];
    snapshot.pads.selectedDrumKitId = "missing-kit";

    const midi = parseMidi(recordingToMidi([
      { position: 0.25, event: { type: "note-on", channel: 9, note: 36, velocity: 110 } },
    ], snapshot.promoted[0]!, snapshot));
    const drumEvents = midi.tracks.find((track) => track.some((event) => "channel" in event && event.channel === 9))!;

    expect(drumEvents.find((event) => event.type === "programChange")).toMatchObject({ channel: 9, programNumber: 0 });
  });

  it("keeps a same-tick note release after its note-on", () => {
    const snapshot = exportSnapshot();
    const midi = parseMidi(recordingToMidi([
      { position: 0.25, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
      { position: 0.25, event: { type: "note-off", channel: 0, note: 60 } },
    ], snapshot.promoted[0]!, snapshot));
    const notes = midi.tracks.flat().filter((event) => event.type === "noteOn" || event.type === "noteOff");

    expect(notes).toMatchObject([
      { type: "noteOn", deltaTime: 480 },
      { type: "noteOff", deltaTime: 1 },
    ]);
  });

  it("yields during long Neon rendering without changing PCM or MIDI sample offsets", async () => {
    const snapshot = exportSnapshot();
    snapshot.synth.selectedId = "subtractive";
    snapshot.synth.parameterValues = { attack: 0.01, release: 0.2, cutoff: 6_300, resonance: 0.2 };
    snapshot.settings.loopMeasures = 6;
    const take = { ...snapshot.promoted[0]!, level: 0.73 };
    const recording: RecordedMidiEvent[] = [
      { position: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 110 } },
      { position: 480 / (12 * 48_000), event: { type: "pitch-bend", channel: 0, value: 0.4 } },
      { position: 0.25, event: { type: "note-off", channel: 0, note: 60 } },
    ];
    let completed = false;
    let callbackRanBeforeCompletion = false;
    const callback = yieldToEventLoop().then(() => { callbackRanBeforeCompletion = !completed; });
    const rendering = renderNeonWav(recording, take, snapshot).then((wav) => {
      completed = true;
      return wav;
    });

    const [actual] = await Promise.all([rendering, callback]);

    expect(callbackRanBeforeCompletion).toBe(true);
    expect(actual).toEqual(renderNeonWavSynchronously(recording, take, snapshot));
  }, 60_000);

  it("renders a melodic Neon session to MP3 without a SoundFont fixture", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "alesis-neon-export-test-"));
    try {
      const snapshot = exportSnapshot();
      snapshot.synth.selectedId = "subtractive";
      snapshot.synth.parameterValues = { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2, cutoff: 6_300, resonance: 0.2 };
      snapshot.promoted = [snapshot.promoted[0]!];

      const result = await exportMp3Session({
        name: "Portable Neon Test",
        snapshot,
        recordings: new Map([["take-1", melodicRecording]]),
        soundFontPath: "unused.sf2",
        outputRoot,
      });

      expect((await stat(result.tracks[0]!)).size).toBeGreaterThan(1_000);
      expect((await stat(result.mix)).size).toBeGreaterThan(1_000);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }, 30_000);

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
