import { CHORD_INTERVALS, chordTemplate } from "./chord-templates";
import {
  assertChroma,
  CHORD_QUALITIES,
  type ChordEstimate,
  type ChordQuality,
  type ChromaFrame,
  type PitchClass,
} from "./types";

export type DetectorOptions = {
  readonly silenceEnergy: number;
  readonly minimumSimilarity: number;
  readonly minimumMargin: number;
};

const DEFAULT_OPTIONS: DetectorOptions = {
  silenceEnergy: 1e-5,
  minimumSimilarity: 0.72,
  minimumMargin: 0.025,
};
const EXTENSION_COMPLEXITY_PENALTY = 0.05;

type Candidate = {
  readonly rootPitchClass: PitchClass;
  readonly quality: ChordQuality;
  readonly similarity: number;
};

export function detectChord(
  frame: ChromaFrame,
  options: Partial<DetectorOptions> = {},
): ChordEstimate {
  assertChroma(frame.values);
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  if (frame.energy <= resolvedOptions.silenceEnergy) {
    return {
      state: "no-chord",
      reason: "silence",
      timestampSeconds: frame.timestampSeconds,
      confidence: 1,
      chroma: frame.values,
    };
  }

  const candidates = allCandidates(frame.values).sort(
    (left, right) => right.similarity - left.similarity,
  );
  const best = candidates[0];
  if (best === undefined) {
    throw new Error("Chord vocabulary must contain candidates");
  }
  const runnerUp = candidates.find(
    (candidate) => !isNestedVariant(best, candidate),
  );
  if (runnerUp === undefined) {
    throw new Error("Chord vocabulary must contain at least two candidates");
  }

  const margin = best.similarity - runnerUp.similarity;
  const confidence = clamp01(
    Math.min(
      best.similarity,
      margin / Math.max(resolvedOptions.minimumMargin * 4, Number.EPSILON),
    ),
  );
  if (
    best.similarity < resolvedOptions.minimumSimilarity ||
    margin < resolvedOptions.minimumMargin
  ) {
    return {
      state: "uncertain",
      candidateRootPitchClass: best.rootPitchClass,
      timestampSeconds: frame.timestampSeconds,
      confidence,
      chroma: frame.values,
    };
  }

  return {
    state: "chord",
    rootPitchClass: best.rootPitchClass,
    quality: best.quality,
    timestampSeconds: frame.timestampSeconds,
    confidence,
    chroma: frame.values,
  };
}

function isNestedVariant(left: Candidate, right: Candidate): boolean {
  if (left === right || left.rootPitchClass !== right.rootPitchClass) {
    return left === right;
  }
  const leftIntervals = CHORD_INTERVALS[left.quality];
  const rightIntervals = CHORD_INTERVALS[right.quality];
  return (
    leftIntervals.every((interval) => rightIntervals.includes(interval)) ||
    rightIntervals.every((interval) => leftIntervals.includes(interval))
  );
}

function allCandidates(chroma: readonly number[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (let root = 0; root < 12; root += 1) {
    for (const quality of CHORD_QUALITIES) {
      candidates.push({
        rootPitchClass: root as PitchClass,
        quality,
        similarity:
          cosineSimilarity(
            chroma,
            chordTemplate(root as PitchClass, quality),
          ) -
          Math.max(0, CHORD_INTERVALS[quality].length - 3) *
            EXTENSION_COMPLEXITY_PENALTY,
      });
    }
  }
  return candidates;
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
