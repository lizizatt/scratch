import { homedir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import { cycleRenderEvents, cycleRenderSchedule } from "./cycle-render-schedule.js";
import { makeDrumRecording } from "./loop-layers.js";
import { renderLoopArtifact } from "./loop-render.js";
import type { RecordedMidiEvent } from "./loop-playback.js";

it.each([false, true])("stably orders unsorted input without prioritizing pedals: pedalFirst=%s", (pedalFirst) => {
  const release: RecordedMidiEvent = { position: 0.5, event: { type: "note-off", channel: 0, note: 60 } };
  const pedal: RecordedMidiEvent = { position: 0.5, event: { type: "control-change", channel: 0, controller: 64, value: 127 } };
  const equalTime = pedalFirst ? [pedal, release] : [release, pedal];
  const recording: RecordedMidiEvent[] = [
    { position: 0.875, event: { type: "control-change", channel: 0, controller: 64, value: 0 } },
    { position: 0.75, event: { type: "pitch-bend", channel: 0, value: 0.25 } },
    { position: 0.125, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
    ...equalTime,
  ];
  const original = structuredClone(recording);
  for (const origin of [0, 0.25]) {
    const plan = cycleRenderSchedule(recording, origin, 1, 1);
    const events = [...cycleRenderEvents(plan)];
    expect(events.map(({ frame }) => frame)).toEqual(events.map(({ frame }) => frame).sort((a, b) => a - b));
    expect(plan.events.filter(({ position }) => position === 0.5 - origin).map(({ event }) => event))
      .toEqual(equalTime.map(({ event }) => ({ ...event, channel: 1 })));
    if (origin === 0) {
      // The later pedal lift must win before rollover state is derived.
      expect(plan.events.filter(({ position }) => position === 1).map(({ event }) => event))
        .toEqual([{ type: "pitch-bend", channel: 1, value: 0 }]);
    }
  }
  expect(recording).toEqual(original);
});

async function breakbeatSnapshot(bpm: number) {
  const engine = new SimulatedHostEngine();
  const snapshot = engine.snapshot();
  await engine.dispose();
  Object.assign(snapshot.settings, { bpm, beatsPerMeasure: 4, loopMeasures: 1 });
  Object.assign(snapshot.drums, { enabled: true, pattern: "breakbeat", volume: 1 });
  snapshot.capture.loopStart = 0;
  snapshot.synth.selectedId = "soundfont";
  snapshot.synth.parameterValues = { gain: 0.72, "reverb-send": 0, "chorus-send": 0 };
  snapshot.pads.drumKits = [{ id: "kit", name: "Standard", bank: 128, program: 0 }];
  snapshot.pads.selectedDrumKitId = "kit";
  return snapshot;
}

it("keeps generated fast breakbeat events chronological when an 80 ms gate crosses the next step", async () => {
  const snapshot = await breakbeatSnapshot(240);
  const events = [...cycleRenderEvents(cycleRenderSchedule(makeDrumRecording(snapshot), 0, 1, 1))];
  const regressions = events.flatMap((event, index) => index > 0 && event.frame < events[index - 1]!.frame
    ? [{ previous: events[index - 1], next: event }] : []);
  expect(regressions).toEqual([]);
});

it.each([
  { bpm: 240, startBeat: undefined },
  { bpm: 240, startBeat: 0 },
  { bpm: 120, startBeat: 0 },
  { bpm: 240, startBeat: 1 },
])("renders breakbeat at $bpm BPM, startBeat=$startBeat", async ({ bpm, startBeat }) => {
  const snapshot = await breakbeatSnapshot(bpm);
  const artifact = await renderLoopArtifact({
    snapshot,
    recordings: new Map(),
    percussionSoundFontPath: process.env.ALESIS_TEST_SOUNDFONT ?? join(homedir(), "Downloads/STH.sf2"),
  }, { target: "sample", startBeat }, new AbortController().signal);
  try {
    expect(artifact.pcm.length).toBeGreaterThan(0);
    expect(artifact.durationSeconds).toBe(240 / bpm);
  } finally {
    await artifact.release();
  }
}, 30_000);
