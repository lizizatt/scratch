import type { EngineSnapshot, Take } from "@alesis/protocol";
import type { RecordedMidiEvent } from "./loop-playback.js";
import { drumPatternAtStep } from "./drum-patterns.js";

export function audibleTakes(snapshot: EngineSnapshot): Take[] {
  if (snapshot.monitorOnly) return [];
  const takes = [
    ...(snapshot.capture.staged && snapshot.capture.stagedAudible ? [snapshot.capture.staged] : []),
    ...snapshot.promoted.filter((take) => !take.muted),
  ].filter((take) => take.level > 0);
  const unique = new Map<string, Take>();
  for (const take of takes) unique.set(take.id, take);
  return [...unique.values()];
}
export function makeDrumRecording(snapshot: EngineSnapshot): RecordedMidiEvent[] {
  if (!snapshot.drums.enabled || snapshot.drums.volume <= 0) return [];
  const totalSteps = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures * 4;
  const cycleSeconds = 60 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const events: RecordedMidiEvent[] = [];
  for (let step = 0; step < totalSteps; step += 1) {
    const position = step / totalSteps;
    for (const hit of drumPatternAtStep(snapshot, step)) {
      events.push({ position, event: { type: "note-on", channel: 9, note: hit.note, velocity: hit.velocity } });
      events.push({ position: position + 0.08 / cycleSeconds, event: { type: "note-off", channel: 9, note: hit.note } });
    }
  }
  return events.map(({ position, event }) => ({ position: Math.min(1, position), event }));
}
export function hasAudibleNote(recording: readonly RecordedMidiEvent[], level: number, channel?: number | "non-percussion"): boolean {
  return recording.some(({ event }) => event.type === "note-on"
    && event.velocity > 0
    && Math.round(event.velocity * level) > 0
    && (channel === undefined || channel === "non-percussion" && event.channel !== 9 || channel === 9 && event.channel === 9));
}
