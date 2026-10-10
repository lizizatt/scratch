import { describe, expect, it } from "vitest";
import { SilentAudioOutput, type AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import { parseMidi } from "midi-file";
import { executeLoopCommand } from "./loop-commands.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import type { RecordedMidiEvent } from "./loop-playback.js";
import { mergeOverdub, rotateRecording } from "./circular-recording.js";
import { recordingToMidi } from "./mp3-exporter.js";

async function capture(overdub: boolean, origin = 0) {
  const engine = new SimulatedHostEngine();
  const output: AudioOutput = new SilentAudioOutput();
  const replay: MidiEvent[] = [];
  output.dispatchMidi = (event) => { replay.push(structuredClone(event)); };
  const loops = new MidiLoopScheduler(output);
  const command = async (command: EngineCommand) => {
    const result = await executeLoopCommand(command, engine, loops, { transaction: (action) => action() });
    expect(result.accepted).toBe(true);
    loops.update(engine.snapshot());
  };
  await command({ type: "configure", settings: { bpm: 120, loopMeasures: 1, countInEnabled: false } });
  await command({ type: "set-overdub", enabled: overdub });
  await command({ type: "set-loop-start", position: origin });
  await command({ type: "play" });
  let time = 0;
  const until = (seconds: number) => {
    engine.advance(seconds - time);
    time = seconds;
    loops.update(engine.snapshot());
  };
  const input = (event: MidiEvent) => loops.record(event, engine.snapshot());
  const opening = async (origin: number) => {
    await command({ type: "stop" });
    await command({ type: "set-loop-start", position: origin });
    const snapshot = engine.snapshot();
    const staged = loops.captureSessionTakes(snapshot).staged!;
    let tick = 0;
    const midiOpening = parseMidi(recordingToMidi(staged.recording, staged.take, snapshot)).tracks[1]!.flatMap((event) => {
      tick += event.deltaTime;
      return event.type === "noteOn" && tick === 0 ? [event.noteNumber] : [];
    });
    replay.length = 0;
    await command({ type: "play" });
    const replayOpening = replay.flatMap((event) => event.type === "note-on" && event.velocity > 0 ? [event.note] : []);
    return { midiOpening, replayOpening };
  };
  return { engine, command, until, input, opening, replay };
}

describe("final loop-editing review: pedal order across overdub reconstruction", () => {
  it.each([0, 0.6])("preserves release-before-pedal order when capturing from origin %s", async (origin) => {
    const h = await capture(true, origin);
    try {
      h.until(0.2);
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
      h.until(0.4);
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 0 });
      h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
      h.until(1);
      h.input({ type: "control-change", channel: 0, controller: 64, value: 0 });
      h.until(2.01);
      expect(await h.opening(origin + 0.3)).toEqual({ midiOpening: [], replayOpening: [] });
    } finally {
      await h.engine.dispose();
    }
  });

  it.each([
    { name: "release then down", before: [], after: [127], held: false },
    { name: "down then release", before: [127], after: [], held: true },
    { name: "down, release, lift, repress", before: [127], after: [0, 127], held: false },
    { name: "down, lift, release, repress", before: [127, 0], after: [127], held: false },
    { name: "down, lift, repress, release", before: [127, 0, 127], after: [], held: true },
  ].flatMap((entry) => [0.2, 0.3].flatMap((origin) => [false, true].map((zeroRelease) => ({ ...entry, origin, zeroRelease })))))
    ("keeps same-pass controller chronology through repeated merges: $name marker=$origin zero=$zeroRelease", ({ before, after, held, origin, zeroRelease }) => {
      const pedal = (value: number): RecordedMidiEvent => ({ position: 0.2, event: { type: "control-change", channel: 0, controller: 64, value } });
      const source: RecordedMidiEvent[] = [
        { position: 0.1, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
        ...before.map(pedal),
        { position: 0.2, event: zeroRelease ? { type: "note-on", channel: 0, note: 60, velocity: 0 } : { type: "note-off", channel: 0, note: 60 } },
        ...after.map(pedal),
        { position: 0.5, event: { type: "control-change", channel: 0, controller: 64, value: 0 } },
      ];
      let merged = mergeOverdub([], source, 4);
      for (let pass = 0; pass < 3; pass++) {
        expect(merged.filter(({ position }) => position === 0.2)).toEqual(source.filter(({ position }) => position === 0.2));
        const opening = rotateRecording(merged, origin).filter(({ position, event }) => position === 0 && event.type === "note-on" && event.velocity > 0);
        expect(opening).toHaveLength(held ? 1 : 0);
        const rotated = rotateRecording(merged, 0.05);
        expect(rotated.filter(({ position }) => Math.abs(position - 0.15) < 1e-9).map(({ event }) => event))
          .toEqual(source.filter(({ position }) => position === 0.2).map(({ event }) => event));
        merged = mergeOverdub(merged, [{ position: 0.7, event: { type: "pitch-bend", channel: 1, value: pass + 1 } }], 4);
      }
    });

  it.each([false, true])("does not catch a release preceding pedal-down at the same timestamp (overdub %s)", async (overdub) => {
    const h = await capture(overdub);
    try {
      h.until(0.2);
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
      h.until(0.4);
      h.input({ type: "note-off", channel: 0, note: 60 });
      h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
      h.until(1);
      h.input({ type: "control-change", channel: 0, controller: 64, value: 0 });
      h.until(2.01);
      expect(await h.opening(0.3)).toEqual({ midiOpening: [], replayOpening: [] });
    } finally {
      await h.engine.dispose();
    }
  });

  it.each([0, 0.1, 0.3, 0.5, 0.6].flatMap((origin) => [false, true].map((zeroRelease) => ({ origin, zeroRelease }))))
    ("retains a pedal-caught continuation until its lift (origin $origin zero=$zeroRelease)", async ({ origin, zeroRelease }) => {
    const h = await capture(true);
    try {
      h.until(1.7);
      h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
      h.until(1.8);
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
      h.until(2);
      h.until(2.2);
      h.input(zeroRelease ? { type: "note-on", channel: 0, note: 60, velocity: 0 } : { type: "note-off", channel: 0, note: 60 });
      h.until(3);
      h.input({ type: "control-change", channel: 0, controller: 64, value: 0 });
      h.until(3.1);
      h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
      h.until(4);
      const expected = origin < 0.5 ? [60] : [];
      expect(await h.opening(origin)).toEqual({ midiOpening: expected, replayOpening: expected });
      if (origin > 0 && origin < 0.5) {
        expect(h.replay.filter((event) => "note" in event).map((event) => event.type === "note-on" && event.velocity > 0))
          .toEqual([true, false]);
        const sounding = new Set<number>();
        const held = new Set<number>();
        let pedalDown = false;
        h.until(4 + (0.5 - origin) * 2 + 0.01);
        for (const event of h.replay) {
          if (event.type === "control-change" && event.controller === 64) {
            pedalDown = event.value >= 64;
            if (!pedalDown) for (const note of sounding) if (!held.has(note)) sounding.delete(note);
          } else if (event.type === "note-on" && event.velocity > 0) {
            held.add(event.note);
            sounding.add(event.note);
          } else if ("note" in event) {
            held.delete(event.note);
            if (!pedalDown) sounding.delete(event.note);
          }
        }
        expect(sounding, "the later pedal lift must silence the reconstructed release").toEqual(new Set());
      }
    } finally {
      await h.engine.dispose();
    }
  });

  it.each([false, true].flatMap((zeroRelease) => [false, true].map((liftBeforeRelease) => ({ zeroRelease, liftBeforeRelease }))))
    ("retains seam release provenance through splits and JSON roundtrips: zero=$zeroRelease liftFirst=$liftBeforeRelease", ({ zeroRelease, liftBeforeRelease }) => {
      const pedal = (position: number, value: number): RecordedMidiEvent => ({ position, event: { type: "control-change", channel: 0, controller: 64, value } });
      const off: RecordedMidiEvent = { position: 0.1, event: zeroRelease ? { type: "note-on", channel: 0, note: 60, velocity: 0 } : { type: "note-off", channel: 0, note: 60 } };
      let merged = mergeOverdub([
        pedal(0.85, 127),
        { position: 0.9, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
        { position: 1, event: { type: "note-off", channel: 0, note: 60 } },
      ], [
        pedal(0, 127),
        { position: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 100 }, continuation: true },
        ...(liftBeforeRelease ? [pedal(0.1, 0), off, pedal(0.1, 127)] : [off]),
        pedal(0.5, 0), pedal(0.6, 127),
      ], 4);
      for (let pass = 0; pass < 3; pass++) {
        merged = JSON.parse(JSON.stringify(merged)) as RecordedMidiEvent[];
        for (const origin of [0.1, 0.3, 0.5, 0.7]) {
          const opening = rotateRecording(merged, origin).filter(({ position, event }) => position === 0 && event.type === "note-on" && event.velocity > 0);
          expect(opening, `pass ${pass}, origin ${origin}`).toHaveLength(!liftBeforeRelease && origin < 0.5 ? 1 : 0);
        }
        merged = mergeOverdub(merged, [pedal(0.75, 0)], 4);
      }
    });
});
