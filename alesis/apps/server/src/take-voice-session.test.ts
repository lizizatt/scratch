import { describe, expect, it, vi } from "vitest";
import { SilentAudioOutput } from "@alesis/audio";
import { SimulatedHostEngine } from "@alesis/engine";
import { parseLoopSession, type LoopSession, type SoundFontPreset } from "@alesis/protocol";
import { MidiLoopScheduler } from "./loop-playback.js";
import { exportLoopSession, importLoopSession, type LoopSessionHost } from "./loop-session.js";

const presets: SoundFontPreset[] = [
  { id: "0:0", bank: 0, program: 0, name: "Piano" },
  { id: "0:40", bank: 0, program: 40, name: "Violin" },
];
const piano = { soundFontId: "font", presetId: "0:0", bank: 0, program: 0, name: "Piano" };
const violin = { soundFontId: "font", presetId: "0:40", bank: 0, program: 40, name: "Violin" };

async function host() {
  const engine = new SimulatedHostEngine({ soundFonts: [{ id: "font", name: "Font" }, { id: "other", name: "Other" }], soundFontPresets: presets, selectedSoundFontPresetId: "0:0" });
  const loops = new MidiLoopScheduler(new SilentAudioOutput());
  const prepareAudio = vi.fn(async () => ({ commit: () => {}, dispose: async () => {} }));
  const target: LoopSessionHost = { engine, loops, percussionSoundFontId: null, inspectPresets: () => presets, prepareAudio };
  await engine.execute({ type: "select-synth", synthId: "soundfont" });
  await engine.execute({ type: "configure", settings: { bpm: 120, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false } });
  return { engine, loops, target, prepareAudio };
}

async function recordPass(h: Awaited<ReturnType<typeof host>>, note: number) {
  h.engine.advance(0.1);
  h.loops.record({ type: "note-on", channel: 0, note, velocity: 100 }, h.engine.snapshot());
  h.engine.advance(0.2);
  h.loops.record({ type: "note-off", channel: 0, note }, h.engine.snapshot());
  h.engine.advance(1.71);
  h.loops.update(h.engine.snapshot());
}

/** Piano loop promoted, then a violin loop left staged. */
async function twoVoices() {
  const h = await host();
  await h.engine.execute({ type: "play" });
  await recordPass(h, 60);
  await h.engine.execute({ type: "promote-staged" });
  await h.engine.execute({ type: "select-soundfont-preset", presetId: "0:40" });
  await recordPass(h, 64);
  await h.engine.execute({ type: "stop" });
  h.loops.update(h.engine.snapshot());
  return h;
}

describe("take voices in loop sessions", () => {
  it("saves each loop's voice and restores it on a fresh host regardless of the current voice", async () => {
    const source = await twoVoices();
    const session = parseLoopSession(exportLoopSession(source.target).sessionJson!);
    expect(session.promoted[0]?.take.voice).toEqual(piano);
    expect(session.staged?.take.voice).toEqual(violin);

    const fresh = await host();
    await fresh.engine.execute({ type: "select-soundfont-preset", presetId: "0:40" });
    await importLoopSession(JSON.stringify(session), fresh.target);

    expect(fresh.engine.snapshot().promoted[0]?.voice).toEqual(piano);
    expect(fresh.engine.snapshot().capture.staged?.voice).toEqual(violin);
  });

  it("loads sessions saved before voices existed, leaving those takes on the global voice", async () => {
    const source = await twoVoices();
    const session = parseLoopSession(exportLoopSession(source.target).sessionJson!);
    for (const entry of [session.staged, ...session.promoted]) delete entry!.take.voice;

    const fresh = await host();
    await importLoopSession(JSON.stringify(session), fresh.target);

    expect(fresh.engine.snapshot().promoted[0]).not.toHaveProperty("voice");
    expect(fresh.engine.snapshot().capture.staged).not.toHaveProperty("voice");
  });

  it("does not save a voice that belongs to a SoundFont other than the saved one", async () => {
    const source = await twoVoices();
    await source.engine.execute({ type: "select-soundfont", soundFontId: "other" });

    const session = parseLoopSession(exportLoopSession(source.target).sessionJson!);

    expect(session.synth.soundFont?.id).toBe("other");
    expect([session.staged, ...session.promoted].map((entry) => entry?.take.voice)).toEqual([undefined, undefined]);
  });

  it.each([
    ["a voice missing from the SoundFont", (session: LoopSession) => { session.staged!.take.voice = { ...violin, program: 41, presetId: "0:41" }; }, /Missing take voice/],
    ["a renamed voice", (session: LoopSession) => { session.promoted[0]!.take.voice = { ...piano, name: "Renamed" }; }, /Missing take voice/],
    ["a voice from another SoundFont", (session: LoopSession) => { session.promoted[0]!.take.voice = { ...piano, soundFontId: "other" }; }, /different SoundFont/],
  ])("rejects %s without changing any state or preparing audio", async (_name, mutate, message) => {
    const source = await twoVoices();
    const session = parseLoopSession(exportLoopSession(source.target).sessionJson!);
    mutate(session);
    const fresh = await host();
    const before = fresh.engine.snapshot();

    await expect(importLoopSession(JSON.stringify(session), fresh.target)).rejects.toThrow(message);

    expect(fresh.engine.snapshot()).toEqual(before);
    expect(fresh.prepareAudio).not.toHaveBeenCalled();
  });

  it("rejects a malformed voice in the session file", async () => {
    const source = await twoVoices();
    const session = parseLoopSession(exportLoopSession(source.target).sessionJson!);
    const text = JSON.stringify(session).replace('"program":40', '"program":400');

    await expect(importLoopSession(text, (await host()).target)).rejects.toThrow();
  });
});
