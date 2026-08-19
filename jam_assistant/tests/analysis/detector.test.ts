import { chordTemplate } from "../../src/analysis/chord-templates";
import { detectChord } from "../../src/analysis/detector";
import { ChordSmoother } from "../../src/analysis/smoother";
import {
  CHORD_QUALITIES,
  type ChordEstimate,
  type ChromaFrame,
  type PitchClass,
} from "../../src/analysis/types";

describe("detectChord", () => {
  it("recognizes every canonical root and quality template", () => {
    for (let root = 0; root < 12; root += 1) {
      for (const quality of CHORD_QUALITIES) {
        const estimate = detectChord(
          frame(chordTemplate(root as PitchClass, quality)),
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
    chroma: chordTemplate(rootPitchClass, quality),
  };
}
