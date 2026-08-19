export const PITCH_CLASS_COUNT = 12;

export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export const CHORD_QUALITIES = [
  "major",
  "minor",
  "dominant7",
  "major7",
  "minor7",
  "diminished",
  "suspended4",
] as const;

export type ChordQuality = (typeof CHORD_QUALITIES)[number];

export type PcmChunk = {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly startSample: number;
};

export type ChromaFrame = {
  readonly timestampSeconds: number;
  readonly values: readonly number[];
  readonly energy: number;
};

type EstimateBase = {
  readonly timestampSeconds: number;
  readonly confidence: number;
  readonly chroma: readonly number[];
};

export type ChordEstimate = EstimateBase &
  (
    | {
        readonly state: "chord";
        readonly rootPitchClass: PitchClass;
        readonly quality: ChordQuality;
      }
    | { readonly state: "no-chord"; readonly reason: "silence" }
    | {
        readonly state: "uncertain";
        readonly candidateRootPitchClass?: PitchClass;
      }
  );

export interface ChromaExtractor {
  readonly id: string;
  initialize(): Promise<void>;
  extract(chunk: PcmChunk): ChromaFrame;
}

export function assertChroma(values: readonly number[]): void {
  if (values.length !== PITCH_CLASS_COUNT) {
    throw new RangeError(`Expected 12 chroma bins, received ${values.length}`);
  }
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("Chroma values must be finite and non-negative");
  }
}
