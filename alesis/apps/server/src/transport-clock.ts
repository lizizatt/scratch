import type { EngineSnapshot } from "@alesis/protocol";

export interface MonotonicClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

export const monotonicClock: MonotonicClock = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

/** time is when the engine position was measured, not when its snapshot was published. */
export interface TransportBeatAnchor {
  time: number;
  beat: number;
  beatMs: number;
}

export function transportBeatAnchor(snapshot: EngineSnapshot, time: number): TransportBeatAnchor {
  return {
    time,
    beat: (snapshot.transport.cycle + snapshot.transport.progress)
      * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures,
    beatMs: 60_000 / snapshot.settings.bpm,
  };
}

/** Generated grids follow the latched source origin, never an in-flight marker edit. */
export function sourceOriginBeats(snapshot: EngineSnapshot): number {
  return snapshot.transport.origin * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
}

export function beatAt(anchor: TransportBeatAnchor, time: number): number {
  return anchor.beat + Math.max(0, time - anchor.time) / anchor.beatMs;
}

export function beatDeadline(anchor: TransportBeatAnchor, beat: number): number {
  return anchor.time + (beat - anchor.beat) * anchor.beatMs;
}

export const countInOpeningAllowanceMs = 50;

/** Only the count-in's original opening may arrive late, not a later cycle after a stall. */
export function countInOpeningBeat(snapshot: EngineSnapshot, anchor: TransportBeatAnchor, now: number, countInCycle: number | null): number | null {
  if (countInCycle === null || snapshot.transport.state !== "playing") return null;
  const opening = countInCycle * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const lateMs = (beatAt(anchor, now) - opening) * anchor.beatMs;
  return lateMs >= -1e-9 && lateMs <= countInOpeningAllowanceMs + 1e-9 ? opening : null;
}
