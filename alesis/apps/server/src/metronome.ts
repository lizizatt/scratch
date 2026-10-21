import type { AudioOutput } from "@alesis/audio";
import type { EngineSnapshot } from "@alesis/protocol";

type MetronomeSnapshot = Pick<EngineSnapshot, "settings" | "transport">;

// Beats of slack so a boundary that lands on an exact millisecond is not read as the previous beat.
const beatEpsilon = 1e-6;

function beatsInPhase(snapshot: MetronomeSnapshot): number {
  return snapshot.transport.state === "counting-in"
    ? snapshot.settings.beatsPerMeasure
    : snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
}

export class MetronomeScheduler {
  private lastBeatKey: string | null = null;

  constructor(private readonly output: AudioOutput) {}

  /** Clicks when the beat changes; safe to call from any cadence because each beat clicks once. */
  update(snapshot: MetronomeSnapshot): void {
    if (snapshot.transport.state === "stopped") {
      this.lastBeatKey = null;
      return;
    }

    const beatsInPhaseCount = beatsInPhase(snapshot);
    const beat = Math.min(beatsInPhaseCount - 1, Math.floor(snapshot.transport.progress * beatsInPhaseCount + beatEpsilon));
    const cycle = snapshot.transport.state === "playing" ? snapshot.transport.cycle : 0;
    const beatKey = `${snapshot.transport.state}:${cycle}:${beat}`;
    if (beatKey === this.lastBeatKey) return;
    this.lastBeatKey = beatKey;

    if (!snapshot.settings.metronomeEnabled || snapshot.settings.metronomeVolume <= 0) return;
    this.output.playMetronome(beat % snapshot.settings.beatsPerMeasure === 0, snapshot.settings.metronomeVolume);
  }

  /** Monotonic time of the next beat, given progress measured at `measuredAt`; Infinity when no click is due. */
  nextBeatTime(snapshot: MetronomeSnapshot, measuredAt: number): number {
    if (snapshot.transport.state === "stopped" || !snapshot.settings.metronomeEnabled || snapshot.settings.metronomeVolume <= 0) return Infinity;
    const position = snapshot.transport.progress * beatsInPhase(snapshot);
    return measuredAt + (Math.floor(position + beatEpsilon) + 1 - position) * 60_000 / snapshot.settings.bpm;
  }
}
