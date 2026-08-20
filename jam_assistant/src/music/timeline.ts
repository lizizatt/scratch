import type { ChordEstimate, ChordQuality, PitchClass } from "../analysis/types";
import { ROOT_NAMES } from "./fretboard";

const QUALITY_SUFFIXES: Readonly<Record<ChordQuality, string>> = {
  major: "",
  minor: "m",
  dominant7: "7",
  major7: "maj7",
  minor7: "m7",
  diminished: "dim",
  suspended4: "sus4",
};

export function retainLastChord(
  current: ChordEstimate | undefined,
  next: ChordEstimate | undefined,
): ChordEstimate | undefined {
  return next?.state === "chord" ? next : current;
}

export type DetectedChordMarker = {
  readonly timestampSeconds: number;
  readonly rootPitchClass: PitchClass;
  readonly quality: ChordQuality;
  readonly label: string;
};

export function chordLabel(
  rootPitchClass: PitchClass,
  quality: ChordQuality,
): string {
  return `${ROOT_NAMES[rootPitchClass]}${QUALITY_SUFFIXES[quality]}`;
}

export function detectedChordMarkers(
  estimates: readonly ChordEstimate[],
): readonly DetectedChordMarker[] {
  const markers: DetectedChordMarker[] = [];
  let previousKey: string | undefined;
  for (const estimate of estimates) {
    if (estimate.state === "no-chord") {
      previousKey = undefined;
      continue;
    }
    if (estimate.state !== "chord") {
      continue;
    }
    const key = `${estimate.rootPitchClass}:${estimate.quality}`;
    if (key === previousKey) {
      continue;
    }
    previousKey = key;
    markers.push({
      timestampSeconds: estimate.timestampSeconds,
      rootPitchClass: estimate.rootPitchClass,
      quality: estimate.quality,
      label: chordLabel(estimate.rootPitchClass, estimate.quality),
    });
  }
  return markers;
}
