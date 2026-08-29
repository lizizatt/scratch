import type { AudioOutput } from "@alesis/audio";
import type { EngineSnapshot } from "@alesis/protocol";

export class MetronomeScheduler {
  private lastBeatKey: string | null = null;

  constructor(private readonly output: AudioOutput) {}

  update(snapshot: EngineSnapshot): void {
    if (snapshot.transport.state === "stopped") {
      this.lastBeatKey = null;
      return;
    }

    const beatsInPhase = snapshot.transport.state === "counting-in"
      ? snapshot.settings.beatsPerMeasure
      : snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
    const beat = Math.min(beatsInPhase - 1, Math.floor(snapshot.transport.progress * beatsInPhase));
    const cycle = snapshot.transport.state === "playing" ? snapshot.transport.cycle : 0;
    const beatKey = `${snapshot.transport.state}:${cycle}:${beat}`;
    if (beatKey === this.lastBeatKey) return;
    this.lastBeatKey = beatKey;

    if (!snapshot.settings.metronomeEnabled || snapshot.settings.metronomeVolume <= 0) return;
    this.output.playMetronome(beat % snapshot.settings.beatsPerMeasure === 0, snapshot.settings.metronomeVolume);
  }
}
