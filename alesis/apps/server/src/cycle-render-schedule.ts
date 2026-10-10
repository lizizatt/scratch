import type { MidiEvent } from "@alesis/engine";
import type { RecordedMidiEvent } from "./loop-playback.js";
import { remapMidiEvent } from "./loop-playback.js";
import { rotateRecording } from "./circular-recording.js";
import { isMappedDrumPadRelease } from "./sample-pads.js";

export const CYCLE_SAMPLE_RATE = 48_000;
export interface CycleRenderSchedule {
  frames: number;
  warmupCycles: number;
  events: RecordedMidiEvent[];
}

/** At least two preceding cycles, targeting four seconds, capped at sixteen cycles.
 * This is bounded effect settling, not a convergence guarantee for arbitrary presets.
 */
export function cycleWarmupCount(seconds: number): number {
  return Math.min(16, Math.max(2, Math.ceil(4 / seconds)));
}

/** One isolated take follows MidiLoopScheduler's channel and rollover policy.
 * Position 1 is a rollover, not a second attack: release held notes, reset bend,
 * lift sustain, then deliver the next cycle's opening in source order. In
 * particular, do not priority-sort equal-time MIDI controllers ahead of releases.
 */
export function cycleRenderSchedule(recording: RecordedMidiEvent[], origin: number, level: number, seconds: number): CycleRenderSchedule {
  const events: RecordedMidiEvent[] = [];
  const held = new Map<string, Extract<MidiEvent, { type: "note-on" }>>();
  const bends = new Map<number, number>();
  const sustains = new Map<number, number>();
  const emit = (position: number, event: MidiEvent) => {
    if (!isMappedDrumPadRelease(event)) events.push({ position, event });
  };
  // Generated gates can cross later attacks; stable ties preserve physical pedal/release order.
  const ordered = [...recording].sort((a, b) => a.position - b.position);
  for (const { position, event } of rotateRecording(ordered, origin)) {
    if (position >= 1) continue;
    const mapped = remapMidiEvent(event, 1, level);
    emit(position, mapped);
    if (mapped.type === "note-on" && mapped.velocity > 0) held.set(`${event.channel}:${mapped.note}`, mapped);
    else if (mapped.type === "note-off" || mapped.type === "note-on" && mapped.velocity === 0) held.delete(`${event.channel}:${mapped.note}`);
    else if (mapped.type === "pitch-bend") {
      if (mapped.value === 0) bends.delete(event.channel);
      else bends.set(event.channel, mapped.channel);
    } else if (mapped.type === "control-change" && mapped.controller === 64) {
      if (mapped.value < 64) sustains.delete(event.channel);
      else sustains.set(event.channel, mapped.channel);
    }
  }
  for (const note of held.values()) emit(1, { type: "note-off", channel: note.channel, note: note.note });
  for (const channel of new Set(bends.values())) emit(1, { type: "pitch-bend", channel, value: 0 });
  for (const channel of new Set(sustains.values())) emit(1, { type: "control-change", channel, controller: 64, value: 0 });
  return { frames: Math.round(seconds * CYCLE_SAMPLE_RATE), warmupCycles: cycleWarmupCount(seconds), events };
}

/** Lazy repetition keeps warm-up PCM and repeated event arrays out of memory. */
export function* cycleRenderEvents(schedule: CycleRenderSchedule): Generator<{ frame: number; event: MidiEvent }> {
  for (let pass = 0; pass <= schedule.warmupCycles; pass++) {
    for (const { position, event } of schedule.events) {
      yield { frame: (pass * schedule.frames) + Math.round(position * schedule.frames), event };
    }
  }
}
