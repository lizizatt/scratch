import { afterEach, describe, expect, it } from "vitest";
import { SilentAudioOutput, type AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import { executeLoopCommand } from "./loop-commands.js";
import { MidiLoopScheduler } from "./loop-playback.js";

const presets = [
  { id: "0:0", bank: 0, program: 0, name: "Piano" },
  { id: "0:40", bank: 0, program: 40, name: "Violin" },
];
const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map((dispose) => dispose())); });

async function host(synthId = "soundfont") {
  const engine = new SimulatedHostEngine({
    soundFonts: [{ id: "font", name: "Font" }, { id: "other", name: "Other" }],
    soundFontPresets: presets,
    selectedSoundFontPresetId: "0:0",
  });
  disposers.push(() => engine.dispose());
  await engine.execute({ type: "select-synth", synthId });
  const calls: string[] = [];
  const output: AudioOutput = new SilentAudioOutput();
  output.dispatchMidi = (event) => { if (event.type === "note-on" && event.velocity > 0) calls.push(`note ${event.channel} ${event.note}`); };
  output.setChannelVoice = (channel, bank, program) => { calls.push(`voice ${channel} ${bank}:${program}`); };
  output.clearChannelVoice = (channel) => { calls.push(`clear ${channel}`); };
  const loops = new MidiLoopScheduler(output, { stagedWaveform: (id, waveform) => engine.setStagedWaveform(id, waveform) });
  const command = async (next: EngineCommand) => {
    const result = await executeLoopCommand(next, engine, loops, { transaction: (action) => action() });
    expect(result.accepted).toBe(true);
    loops.update(engine.snapshot());
  };
  await command({ type: "configure", settings: { bpm: 120, loopMeasures: 1, countInEnabled: false } });
  let time = 0;
  const until = (seconds: number) => {
    engine.advance(seconds - time);
    time = seconds;
    loops.update(engine.snapshot());
  };
  const play = (note: number, from: number, to: number, channel = 0) => {
    until(from);
    const on: MidiEvent = { type: "note-on", channel, note, velocity: 100 };
    loops.record(on, engine.snapshot());
    until(to);
    loops.record({ type: "note-off", channel, note }, engine.snapshot());
  };
  const channelOf = (voice: string) => Number(calls.find((call) => call.startsWith("voice ") && call.endsWith(` ${voice}`))!.split(" ")[1]);
  return { engine, loops, calls, command, until, play, channelOf };
}

describe("per-take voices on isolated playback channels", () => {
  it("keeps each loop's recorded voice after the performance voice changes", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.play(60, 0.2, 0.4);
    h.until(2.01);
    await h.command({ type: "select-soundfont-preset", presetId: "0:40" });
    await h.command({ type: "promote-staged" });
    h.play(64, 2.5, 2.7);
    h.until(4.01);
    h.until(4.6);
    h.until(6.01);

    const piano = h.channelOf("0:0");
    const violin = h.channelOf("0:40");
    expect(piano).not.toBe(violin);
    // The later empty pass is a new staged take recorded in the current voice.
    const emptyPass = h.calls.filter((call) => call.startsWith("voice ")).at(-1)!;
    expect(h.calls.filter((call) => call.startsWith("voice "))).toEqual([`voice ${piano} 0:0`, `voice ${violin} 0:40`, emptyPass]);
    expect(emptyPass).toMatch(/ 0:40$/);
    // At the third rollover the second staged take expires into the silent previous slot.
    expect(h.calls.filter((call) => call.startsWith("clear "))).toEqual([`clear ${violin}`]);
    expect(h.calls.indexOf(`voice ${piano} 0:0`)).toBeLessThan(h.calls.indexOf(`note ${piano} 60`));
    expect(h.calls.indexOf(`voice ${violin} 0:40`)).toBeLessThan(h.calls.indexOf(`note ${violin} 64`));
  });

  it("auditions on the take's pinned channel without repeating its voice, or on the global voice for another SoundFont", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.play(60, 0.2, 0.4);
    h.until(2.01);
    await h.command({ type: "select-soundfont-preset", presetId: "0:40" });
    await h.command({ type: "promote-staged" });
    await h.command({ type: "stop" });
    const take = h.engine.snapshot().promoted[0]!;
    const channel = h.channelOf("0:0");
    const audition = { takeId: take.id, note: 64, channel: 0, velocity: 90, durationMs: 50 };

    h.calls.length = 0;
    h.loops.auditionNote(h.engine.runtimeSnapshot(), audition);
    expect(h.calls).toEqual([`note ${channel} 64`]);

    await h.command({ type: "select-soundfont", soundFontId: "other" });
    h.calls.length = 0;
    h.loops.auditionNote(h.engine.runtimeSnapshot(), { ...audition, note: 65 });
    expect(h.calls).toEqual([`note ${channel} 65`]);
  });

  it("applies the voice before a rolled-over take's first notes", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.play(60, 0.001, 0.4);
    h.until(2.0005);
    const channel = h.channelOf("0:0");
    h.until(2.01);

    expect(h.calls.indexOf(`voice ${channel} 0:0`)).toBeGreaterThanOrEqual(0);
    expect(h.calls.indexOf(`voice ${channel} 0:0`)).toBeLessThan(h.calls.indexOf(`note ${channel} 60`));
  });

  it("falls back to the global voice for a take from another SoundFont, then restores it", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.until(2.01);
    const channel = h.channelOf("0:0");

    await h.command({ type: "select-soundfont", soundFontId: "other" });
    expect(h.calls.at(-1)).toBe(`clear ${channel}`);
    await h.command({ type: "select-soundfont", soundFontId: "font" });
    expect(h.calls.at(-1)).toBe(`voice ${channel} 0:0`);
  });

  it("releases the pinned voice while a take is silent and restores it when audible", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.until(2.01);
    const channel = h.channelOf("0:0");

    await h.command({ type: "set-staged-audible", audible: false });
    expect(h.calls.at(-1)).toBe(`clear ${channel}`);
    await h.command({ type: "set-staged-audible", audible: true });
    expect(h.calls.at(-1)).toBe(`voice ${channel} 0:0`);
    await h.command({ type: "set-monitor-only", enabled: true });
    expect(h.calls.at(-1)).toBe(`clear ${channel}`);
  });

  it("reasserts pinned voices after the renderer resets and clears them with the audio", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.until(2.01);
    const channel = h.channelOf("0:0");
    h.calls.length = 0;

    h.loops.reapplyInputControllers();
    expect(h.calls).toEqual([`voice ${channel} 0:0`]);
    h.loops.clearRecordings();
    expect(h.calls.slice(1)).toEqual([`clear ${channel}`]);
    h.calls.length = 0;
    h.loops.clearRecordings();
    expect(h.calls).toEqual([]);
  });

  it("does not repeat an unchanged voice on every update", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.until(2.01);
    h.until(2.5);
    h.until(3);

    expect(h.calls.filter((call) => call.startsWith("voice "))).toHaveLength(1);
  });

  it("re-voices the overdub staged take in place without touching other channels", async () => {
    const h = await host();
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    h.play(60, 0.2, 0.4);
    h.until(2.01);
    await h.command({ type: "promote-staged" });
    h.until(2.5);
    h.play(64, 2.6, 2.8);
    h.until(4.01);
    const voices = h.calls.filter((call) => call.startsWith("voice ")).map((call) => Number(call.split(" ")[1]));
    const promoted = voices[0]!;
    const staged = voices.at(-1)!;
    expect(staged).not.toBe(promoted);
    h.calls.length = 0;

    await h.command({ type: "select-soundfont-preset", presetId: "0:40" });
    expect(h.calls).toEqual([`voice ${staged} 0:40`]);
    expect(h.engine.snapshot().promoted[0]?.voice?.presetId).toBe("0:0");
  });

  it("keeps loops off the channel the performer plays on, so live notes follow the selected voice", async () => {
    const h = await host();
    // The Vortex keybed sends notes on channel 1, which is also the first loop channel.
    await h.command({ type: "play" });
    h.play(60, 0.2, 0.4, 1);
    h.until(2.01);
    await h.command({ type: "promote-staged" });
    await h.command({ type: "select-soundfont-preset", presetId: "0:40" });
    h.play(64, 2.5, 2.7, 1);
    h.until(4.01);

    const touched = h.calls.filter((call) => call.startsWith("voice ") || call.startsWith("clear ")).map((call) => Number(call.split(" ")[1]));
    expect(touched.length).toBeGreaterThan(0);
    expect(touched).not.toContain(1);
    expect(h.calls.filter((call) => call.startsWith("note ")).map((call) => Number(call.split(" ")[1]))).not.toContain(1);
  });

  it("moves a loop off a channel once live input starts using it", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.play(60, 0.2, 0.4);
    h.until(2.01);
    const first = h.channelOf("0:0");
    h.calls.length = 0;

    h.play(62, 2.2, 2.3, first);
    h.until(2.6);

    expect(h.calls).toContain(`clear ${first}`);
    const moved = h.calls.find((call) => call.startsWith("voice ") && call.endsWith(" 0:0"));
    expect(moved).toBeDefined();
    expect(Number(moved!.split(" ")[1])).not.toBe(first);
  });

  it("never lets two audible takes share a channel, so each keeps its own voice at full capacity", async () => {
    const h = await host();
    await h.command({ type: "play" });
    for (let pass = 0; pass < 12; pass++) {
      await h.command({ type: "select-soundfont-preset", presetId: pass % 2 === 0 ? "0:0" : "0:40" });
      h.play(60 + pass, pass * 2 + 0.2, pass * 2 + 0.4);
      h.until((pass + 1) * 2 + 0.01);
      await h.command({ type: "promote-staged" });
    }
    // Two unpromoted passes leave 12 promoted + a displaced previous take + a new staged take.
    h.until(26.5);
    h.until(28.01);

    const pinned = new Map<number, string>();
    for (const call of h.calls) {
      const [kind, channel, voice] = call.split(" ");
      if (kind === "voice") pinned.set(Number(channel), voice!);
      if (kind === "clear") pinned.delete(Number(channel));
    }
    const snapshot = h.engine.snapshot();
    const audible = [snapshot.capture.staged!, ...snapshot.promoted].map(({ voice }) => `${voice!.bank}:${voice!.program}`);

    expect(audible).toHaveLength(13);
    expect(pinned.size).toBe(13);
    expect([...pinned.values()].sort()).toEqual([...audible].sort());
  });

  it("uses no pinned voice for the Neon synth", async () => {
    const h = await host("subtractive");
    await h.command({ type: "play" });
    h.play(60, 0.2, 0.4);
    h.until(2.01);
    h.until(4.01);

    expect(h.calls.filter((call) => call.startsWith("voice ") || call.startsWith("clear "))).toEqual([]);
    expect(h.engine.snapshot().capture.staged).not.toHaveProperty("voice");
  });
});
