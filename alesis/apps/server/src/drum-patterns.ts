import type { EngineSnapshot } from "@alesis/protocol";

export interface DrumHit {
  note: number;
  velocity: number;
}

interface PatternHit {
  step: number;
  note: number;
  strength: number;
}

const patterns: Record<EngineSnapshot["drums"]["pattern"], PatternHit[]> = {
  "four-on-floor": [
    ...[0, 4, 8, 12].map((step) => ({ step, note: 36, strength: 1 })),
    ...[4, 12].map((step) => ({ step, note: 38, strength: 0.9 })),
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({ step, note: 42, strength: 0.75 })),
  ],
  backbeat: [
    ...[0, 7, 8, 14].map((step) => ({ step, note: 36, strength: step === 0 ? 1 : 0.8 })),
    ...[4, 12].map((step) => ({ step, note: 38, strength: 1 })),
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({ step, note: 42, strength: 0.65 })),
  ],
  breakbeat: [
    ...[0, 3, 7, 10, 14].map((step) => ({ step, note: 36, strength: 0.9 })),
    ...[4, 11].map((step) => ({ step, note: 38, strength: 1 })),
    ...[1, 5, 9, 13].map((step) => ({ step, note: 46, strength: 0.7 })),
  ],
};

export class DrumPatternScheduler {
  private lastStepKey: string | null = null;

  update(snapshot: EngineSnapshot): DrumHit[] {
    if (!snapshot.drums.enabled || snapshot.transport.state !== "playing") {
      this.lastStepKey = null;
      return [];
    }
    const totalSteps = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures * 4;
    const step = Math.min(totalSteps - 1, Math.floor(snapshot.transport.progress * totalSteps));
    const key = `${snapshot.transport.cycle}:${step}`;
    if (key === this.lastStepKey) return [];
    this.lastStepKey = key;
    if (snapshot.drums.volume <= 0) return [];
    const measureSteps = snapshot.settings.beatsPerMeasure * 4;
    const measureStep = step % measureSteps;
    const patternStep = Math.floor(measureStep * 16 / measureSteps);
    return patterns[snapshot.drums.pattern]
      .filter((hit) => hit.step === patternStep)
      .map(({ note, strength }) => ({ note, velocity: Math.max(1, Math.min(127, Math.round(127 * snapshot.drums.volume * strength))) }));
  }
}
