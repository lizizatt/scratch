import { detectChord } from "../../src/analysis/detector";
import { ChordSmoother } from "../../src/analysis/smoother";
import {
  CHORD_QUALITIES,
  type ChordEstimate,
  type ChordQuality,
  type ChromaFrame,
  type PitchClass,
} from "../../src/analysis/types";

const EXPECTED_INTERVALS: Readonly<Record<ChordQuality, readonly number[]>> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  diminished: [0, 3, 6],
  suspended4: [0, 5, 7],
};

describe("detectChord", () => {
  it("recognizes every canonical root and quality template", () => {
    for (let root = 0; root < 12; root += 1) {
      for (const quality of CHORD_QUALITIES) {
        const estimate = detectChord(
          frame(expectedTemplate(root as PitchClass, quality)),
        );
        expect(estimate).toMatchObject({
          state: "chord",
          rootPitchClass: root,
          quality,
        });
      }
    }
  });

  it("returns no-chord for silence", () => {
    expect(detectChord(frame(new Array(12).fill(0), 0))).toMatchObject({
      state: "no-chord",
      reason: "silence",
    });
  });

  it("returns uncertain for diffuse pitch-class energy", () => {
    expect(detectChord(frame(new Array(12).fill(1)))).toMatchObject({
      state: "uncertain",
    });
  });

  it("does not mistake a strong third harmonic for a major seventh", () => {
    const decodedCmajor = [
      0.648, 0.313, 0.385, 0.209, 0.628, 0.251, 0.27, 1, 0.24, 0.067, 0.105,
      0.458,
    ];
    expect(detectChord(frame(decodedCmajor))).toMatchObject({
      state: "chord",
      rootPitchClass: 0,
      quality: "major",
    });
  });

  it("respects the silence, similarity, and margin options", () => {
    const major = expectedTemplate(0, "major");

    expect(
      detectChord(frame(major, 0.5), { silenceEnergy: 0.5 }),
    ).toMatchObject({ state: "no-chord" });
    expect(
      detectChord(frame(major, 0.5001), { silenceEnergy: 0.5 }),
    ).toMatchObject({ state: "chord", rootPitchClass: 0, quality: "major" });
    expect(
      detectChord(frame(major), { minimumSimilarity: 1.01 }),
    ).toMatchObject({ state: "uncertain", candidateRootPitchClass: 0 });
    expect(
      detectChord(frame(major), { minimumMargin: 2 }),
    ).toMatchObject({ state: "uncertain", candidateRootPitchClass: 0 });
  });

  it("reports high confidence for a clean match and bounded confidence for ambiguity", () => {
    const clean = detectChord(frame(expectedTemplate(0, "major")));
    const ambiguous = detectChord(frame(new Array(12).fill(1)));

    expect(clean.confidence).toBeGreaterThan(0.99);
    expect(ambiguous.confidence).toBeGreaterThanOrEqual(0);
    expect(ambiguous.confidence).toBeLessThanOrEqual(1);
  });

  it("rejects malformed chroma through the detector boundary", () => {
    expect(() => detectChord(frame(new Array(11).fill(0)))).toThrow(RangeError);
    expect(() => detectChord(frame([0, ...new Array(10).fill(0), -1]))).toThrow(
      RangeError,
    );
  });
});

describe("ChordSmoother", () => {
  it("requires repeated estimates before switching chords", () => {
    const smoother = new ChordSmoother(2);
    const cMajor = chordEstimate(0, "major", 0);
    const dMinor = chordEstimate(2, "minor", 0.1);

    expect(smoother.update(cMajor).state).toBe("uncertain");
    expect(smoother.update(cMajor)).toMatchObject({ state: "chord", rootPitchClass: 0 });
    expect(smoother.update(dMinor)).toMatchObject({ state: "chord", rootPitchClass: 0 });
    expect(smoother.update(dMinor)).toMatchObject({ state: "chord", rootPitchClass: 2 });
  });

  it("does not retain a stale pending candidate after uncertainty", () => {
    const smoother = new ChordSmoother(2);
    const cMajor = chordEstimate(0, "major", 0);
    const dMinor = chordEstimate(2, "minor", 0.1);
    const uncertain: ChordEstimate = {
      state: "uncertain",
      timestampSeconds: 0.2,
      confidence: 0.1,
      chroma: new Array(12).fill(1),
    };

    expect(smoother.update(cMajor).state).toBe("uncertain");
    expect(smoother.update(dMinor).state).toBe("uncertain");
    expect(smoother.update(uncertain)).toBe(uncertain);
    expect(smoother.update(dMinor).state).toBe("uncertain");
    expect(smoother.update(dMinor)).toMatchObject({
      state: "chord",
      rootPitchClass: 2,
      quality: "minor",
    });
  });

  it("accepts the first chord immediately when one frame is required", () => {
    const smoother = new ChordSmoother(1);

    expect(smoother.update(chordEstimate(0, "major", 0))).toMatchObject({
      state: "chord",
      rootPitchClass: 0,
      quality: "major",
    });
  });

  it("requires a positive integer frame count", () => {
    expect(() => new ChordSmoother(0)).toThrow(RangeError);
    expect(() => new ChordSmoother(-1)).toThrow(RangeError);
    expect(() => new ChordSmoother(1.5)).toThrow(RangeError);
  });

  it("clears an accepted chord immediately on silence", () => {
    const smoother = new ChordSmoother(1);
    smoother.update(chordEstimate(0, "major", 0));
    expect(smoother.update(detectChord(frame(new Array(12).fill(0), 0)))).toMatchObject({
      state: "no-chord",
    });
  });
});

function frame(values: readonly number[], energy = 1): ChromaFrame {
  return { timestampSeconds: 0, values, energy };
}

function chordEstimate(
  rootPitchClass: PitchClass,
  quality: "major" | "minor",
  timestampSeconds: number,
): ChordEstimate {
  return {
    state: "chord",
    rootPitchClass,
    quality,
    timestampSeconds,
    confidence: 1,
    chroma: expectedTemplate(rootPitchClass, quality),
  };
}

function expectedTemplate(
  rootPitchClass: PitchClass,
  quality: ChordQuality,
): readonly number[] {
  const values = new Array<number>(12).fill(0);
  for (const interval of EXPECTED_INTERVALS[quality]) {
    values[(rootPitchClass + interval) % 12] = interval === 0 ? 1.25 : 1;
  }
  return values;
}
