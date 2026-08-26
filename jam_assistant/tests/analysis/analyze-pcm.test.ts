import { analyzePcm } from "../../src/analysis/analysis-worker";
import { applyChorus, applySoftClip } from "../../src/fixtures/effects";
import {
  FIXTURE_DURATION_SECONDS,
  FIXTURE_SAMPLE_RATE,
  synthesizeChord,
  synthesizeTransition,
} from "../../src/fixtures/synthesis";
import {
  CHORD_QUALITIES,
  type ChordEstimate,
} from "../../src/analysis/types";

describe("analyzePcm", () => {
  it("stabilizes a generated held chord through framing and smoothing", () => {
    const progress: number[] = [];
    const estimates = analyzePcm(
      synthesizeChord({ rootPitchClass: 0, quality: "major" }),
      FIXTURE_SAMPLE_RATE,
      (fraction) => progress.push(fraction),
    );

    expect(estimates.some(isChord)).toBe(true);
    expect(chordKeys(estimates.filter(isChord))).toEqual(["0:major"]);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((left, right) => left - right));
  });

  it("follows a generated transition without retaining the old chord", () => {
    const estimates = analyzePcm(
      synthesizeTransition(
        { rootPitchClass: 0, quality: "major" },
        { rootPitchClass: 2, quality: "minor" },
      ),
      FIXTURE_SAMPLE_RATE,
    );
    const detected = estimates.filter(isChord);
    const secondChord = detected.find(
      (estimate) => estimate.rootPitchClass === 2,
    );

    expect(chordKeys(detected)).toEqual(["0:major", "2:minor"]);
    expect(secondChord?.timestampSeconds).toBeGreaterThanOrEqual(
      FIXTURE_DURATION_SECONDS - 0.1,
    );
    expect(secondChord?.timestampSeconds).toBeLessThan(
      FIXTURE_DURATION_SECONDS + 0.5,
    );
  });

  it("produces only no-chord estimates for generated silence", () => {
    const estimates = analyzePcm(
      new Float32Array(FIXTURE_SAMPLE_RATE * FIXTURE_DURATION_SECONDS),
      FIXTURE_SAMPLE_RATE,
    );

    expect(estimates).not.toHaveLength(0);
    expect(estimates.every((estimate) => estimate.state === "no-chord")).toBe(
      true,
    );
  });

  it("preserves most supported qualities under strong soft clipping", () => {
    expectEffectRobustness((samples) => applySoftClip(samples, 8));
  });

  it("preserves most supported qualities under moderate chorus", () => {
    expectEffectRobustness((samples) =>
      applyChorus(samples, FIXTURE_SAMPLE_RATE),
    );
  });

  it("does not turn silence into a chord after applying effects", () => {
    const silence = new Float32Array(
      FIXTURE_SAMPLE_RATE * FIXTURE_DURATION_SECONDS,
    );

    expect(
      analyzePcm(
        applySoftClip(applyChorus(silence, FIXTURE_SAMPLE_RATE), 8),
        FIXTURE_SAMPLE_RATE,
      ).every((estimate) => estimate.state === "no-chord"),
    ).toBe(true);
  });
});

function isChord(estimate: ChordEstimate): estimate is Extract<ChordEstimate, { state: "chord" }> {
  return estimate.state === "chord";
}

function expectEffectRobustness(
  transform: (samples: Float32Array) => Float32Array,
): void {
  const dominantKeys = CHORD_QUALITIES.map((quality) =>
    dominantChordKey(
      analyzePcm(
        transform(synthesizeChord({ rootPitchClass: 0, quality })),
        FIXTURE_SAMPLE_RATE,
      ),
    ),
  );
  const expectedKeys = new Set(
    CHORD_QUALITIES.map((quality) => `0:${quality}`),
  );
  const correctCount = dominantKeys.filter((key) => expectedKeys.has(key ?? ""));

  expect(correctCount.length).toBeGreaterThanOrEqual(6);
  expect(
    dominantKeys.every(
      (key) => key === "uncertain" || expectedKeys.has(key ?? ""),
    ),
  ).toBe(true);
}

function dominantChordKey(estimates: readonly ChordEstimate[]): string {
  const counts = new Map<string, number>();
  for (const estimate of estimates) {
    const key = estimate.state === "chord" ? `${estimate.rootPitchClass}:${estimate.quality}` : estimate.state;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "uncertain";
}

function chordKeys(estimates: readonly Extract<ChordEstimate, { state: "chord" }>[]): string[] {
  return estimates.reduce<string[]>((keys, estimate) => {
    const key = `${estimate.rootPitchClass}:${estimate.quality}`;
    if (keys.at(-1) !== key) {
      keys.push(key);
    }
    return keys;
  }, []);
}
