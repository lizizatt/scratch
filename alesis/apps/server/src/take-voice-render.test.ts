import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseMidi } from "midi-file";
import { describe, expect, it } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import type { EngineSnapshot, Take } from "@alesis/protocol";
import type { RecordedMidiEvent } from "./loop-playback.js";
import { recordingToMidi, renderTakeWav } from "./mp3-exporter.js";

const soundFontPath = process.env.ALESIS_TEST_SOUNDFONT ?? join(homedir(), "Downloads/STH.sf2");
const trumpet = { soundFontId: "font", presetId: "1200:56", bank: 1200, program: 56, name: "Trumpet" };
const recording: RecordedMidiEvent[] = [
  { position: 0.1, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
  { position: 0.4, event: { type: "note-off", channel: 0, note: 60 } },
];

function snapshotWith(globalPreset: string, synthId = "soundfont"): EngineSnapshot {
  const engine = new SimulatedHostEngine({
    soundFonts: [{ id: "font", name: "Font" }],
    soundFontPresets: [
      { id: "0:0", bank: 0, program: 0, name: "Piano" },
      { id: "0:40", bank: 0, program: 40, name: "Violin" },
      { id: "1200:56", bank: 1200, program: 56, name: "Trumpet" },
    ],
    selectedSoundFontPresetId: globalPreset,
  });
  void engine.execute({ type: "select-synth", synthId });
  const snapshot = engine.snapshot();
  snapshot.settings = { ...snapshot.settings, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 };
  return snapshot;
}

const take = (voice?: Take["voice"]): Take => ({ id: "take", cycle: 0, level: 1, muted: false, waveform: [], ...(voice ? { voice } : {}) });

type SetupEvent = { program?: number; controller?: number; value?: number };

function setup(midi: Uint8Array): SetupEvent[] {
  const events = parseMidi(midi).tracks.find((track) => track.some((event) => event.type === "noteOn"))!;
  return events.flatMap<SetupEvent>((event) => event.type === "programChange" ? [{ program: event.programNumber }]
    : event.type === "controller" && (event.controllerType === 0 || event.controllerType === 32) ? [{ controller: event.controllerType, value: event.value }] : []);
}

describe("take voices in exports", () => {
  it("writes a take's recorded bank and program instead of the global voice", () => {
    const snapshot = snapshotWith("0:0");

    expect(setup(recordingToMidi(recording, take(trumpet), snapshot))).toEqual([
      { controller: 0, value: 9 }, { controller: 32, value: 48 }, { program: 56 },
    ]);
    expect(setup(recordingToMidi(recording, take(), snapshot))).toEqual([
      { controller: 0, value: 0 }, { controller: 32, value: 0 }, { program: 0 },
    ]);
  });

  it("uses the global voice for a take from another SoundFont or under the Neon synth", () => {
    const otherFont = { ...trumpet, soundFontId: "elsewhere" };

    expect(setup(recordingToMidi(recording, take(otherFont), snapshotWith("0:40")))).toContainEqual({ program: 40 });
    expect(setup(recordingToMidi(recording, take(trumpet), snapshotWith("0:40", "subtractive")))).toContainEqual({ program: 40 });
  });

  it.skipIf(!existsSync(soundFontPath))("renders a pinned take exactly as the same voice selected globally, and differently from the global voice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alesis-take-voice-"));
    const violin = { soundFontId: "font", presetId: "0:40", bank: 0, program: 40, name: "Violin" };
    try {
      for (const cyclePolicy of [undefined, "include-wrapped-tails" as const]) {
        const render = async (name: string, voice: Take["voice"] | undefined, globalPreset: string) => readFile(await renderTakeWav({
          recording, take: take(voice), snapshot: snapshotWith(globalPreset), temporaryDirectory: directory,
          baseName: `${name}-${cyclePolicy ?? "plain"}`, soundFontPath, ...(cyclePolicy ? { cyclePolicy } : {}),
        }));
        const pinned = await render("pinned", violin, "0:0");
        const reference = await render("reference", undefined, "0:40");
        const unpinned = await render("unpinned", undefined, "0:0");

        expect(pinned.length).toBeGreaterThan(44);
        expect(pinned.equals(reference), `${cyclePolicy ?? "plain"} pinned vs reference`).toBe(true);
        expect(pinned.equals(unpinned), `${cyclePolicy ?? "plain"} pinned vs global`).toBe(false);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
