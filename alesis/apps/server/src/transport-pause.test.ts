import { afterEach, describe, expect, it } from "vitest";
import { SilentAudioOutput, type AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import { executeLoopCommand } from "./loop-commands.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import { MetronomeScheduler } from "./metronome.js";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map((dispose) => dispose())); });

/** 120 BPM, one 4/4 measure: a 2 s loop. */
async function host() {
  const engine = new SimulatedHostEngine();
  disposers.push(() => engine.dispose());
  const played: MidiEvent[] = [];
  const output: AudioOutput = new SilentAudioOutput();
  output.dispatchMidi = (event) => { played.push(event); };
  const loops = new MidiLoopScheduler(output, { stagedWaveform: (id, waveform) => engine.setStagedWaveform(id, waveform) });
  const command = async (next: EngineCommand) => {
    const result = await executeLoopCommand(next, engine, loops, { transaction: (action) => action() });
    loops.update(engine.snapshot());
    return result;
  };
  await command({ type: "configure", settings: { bpm: 120, loopMeasures: 1, countInEnabled: false } });
  let time = 0;
  const until = (seconds: number) => { engine.advance(seconds - time); time = seconds; loops.update(engine.snapshot()); };
  const run = (seconds: number) => until(time + seconds);
  const key = (type: "on" | "off", note: number) => loops.record(
    type === "on" ? { type: "note-on", channel: 1, note, velocity: 100 } : { type: "note-off", channel: 1, note }, engine.snapshot());
  return { engine, loops, played, command, until, run, key };
}

describe("pause", () => {
  it("holds the position, silences the loop, and resumes without replaying the pass so far", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.until(0.2); h.key("on", 60); h.until(0.4); h.key("off", 60);
    h.until(2.01);
    await h.command({ type: "promote-staged" });
    h.until(2.3);
    expect(h.played.some((event) => event.type === "note-on" && event.note === 60)).toBe(true);
    const progress = h.engine.snapshot().transport.progress;

    h.played.length = 0;
    expect((await h.command({ type: "pause" })).accepted).toBe(true);
    expect(h.engine.snapshot().transport.state).toBe("paused");
    expect(h.played).toEqual([expect.objectContaining({ type: "note-off", note: 60 })]);

    h.run(5);
    expect(h.engine.snapshot().transport).toMatchObject({ state: "paused", cycle: 1, progress });

    h.played.length = 0;
    expect((await h.command({ type: "play" })).accepted).toBe(true);
    h.run(0.05);
    expect(h.played.filter((event) => event.type === "note-on")).toEqual([]);
    for (let step = 0; step < 20; step += 1) h.run(0.1);
    expect(h.played.filter((event) => event.type === "note-on" && event.note === 60)).toHaveLength(1);
  });

  it("only pauses while playing and stops from a pause", async () => {
    const h = await host();
    expect((await h.command({ type: "pause" })).accepted).toBe(false);
    await h.command({ type: "play" });
    h.run(0.5);
    await h.command({ type: "pause" });
    expect((await h.command({ type: "pause" })).accepted).toBe(false);
    await h.command({ type: "stop" });
    expect(h.engine.snapshot().transport).toMatchObject({ state: "stopped", progress: 0 });
  });

  it("does not record while paused, but closes a note released during the pause", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.until(0.2); h.key("on", 60);
    h.until(0.3);
    await h.command({ type: "pause" });
    h.key("off", 60);
    h.key("on", 62); h.key("off", 62);
    h.run(3);
    await h.command({ type: "play" });
    h.run(1.8);
    h.run(0.5);

    const staged = h.engine.snapshot().capture.staged!;
    const events = h.loops.exportRecordings([staged.id]).get(staged.id)!;
    expect(events.filter(({ event }) => event.type === "note-on").map(({ event }) => "note" in event ? event.note : 0)).toEqual([60]);
    const release = events.find(({ event }) => event.type === "note-off")!;
    expect(release.position).toBeCloseTo(0.15, 2);
  });

  it("commits a partial overdub when stopping from a pause", async () => {
    const h = await host();
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    h.until(0.5); h.key("on", 60); h.until(0.7); h.key("off", 60);
    await h.command({ type: "pause" });
    await h.command({ type: "stop" });
    const staged = h.engine.snapshot().capture.staged!;
    expect(h.loops.exportRecordings([staged.id]).get(staged.id)!.some(({ event }) => event.type === "note-on" && event.note === 60)).toBe(true);
  });
});

describe("metronome and pause", () => {
  it("neither clicks for the pause nor clicks again for the beat it resumes in", () => {
    const clicks: boolean[] = [];
    const metronome = new MetronomeScheduler({ playMetronome: (accent: boolean) => { clicks.push(accent); } } as never);
    const snapshot = (state: "playing" | "paused", progress: number) => ({
      settings: { bpm: 120, beatsPerMeasure: 4, loopMeasures: 1, metronomeEnabled: true, metronomeVolume: 0.5 },
      transport: { state, cycle: 3, progress, origin: 0 },
    }) as never;
    metronome.update(snapshot("playing", 0.3));
    expect(clicks).toHaveLength(1);
    metronome.update(snapshot("paused", 0.3));
    metronome.update(snapshot("playing", 0.3));
    metronome.update(snapshot("playing", 0.4));
    expect(clicks).toHaveLength(1);
    metronome.update(snapshot("playing", 0.51));
    expect(clicks).toHaveLength(2);
    expect(metronome.nextBeatTime(snapshot("paused", 0.3), 0)).toBe(Infinity);
  });
});
