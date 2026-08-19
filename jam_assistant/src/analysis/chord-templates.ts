import type { ChordQuality, PitchClass } from "./types";

export const CHORD_INTERVALS: Readonly<Record<ChordQuality, readonly number[]>> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  diminished: [0, 3, 6],
  suspended4: [0, 5, 7],
};

const ROOT_WEIGHT = 1.25;

export function chordTemplate(
  rootPitchClass: PitchClass,
  quality: ChordQuality,
): readonly number[] {
  const values = new Array<number>(12).fill(0);
  for (const interval of CHORD_INTERVALS[quality]) {
    values[(rootPitchClass + interval) % 12] = interval === 0 ? ROOT_WEIGHT : 1;
  }
  return values;
}
