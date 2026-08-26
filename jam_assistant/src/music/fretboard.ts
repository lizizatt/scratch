import { Chord, Note, Scale } from "tonal";
import type { ChordQuality, PitchClass } from "../analysis/types";

export const ROOT_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const STANDARD_TUNING_MIDI = [40, 45, 50, 55, 59, 64] as const;
export const FRET_COUNT = 12;
export const MAX_FRET_COUNT = 24;
export const FRET_POSITION_RATIOS = Array.from(
  { length: MAX_FRET_COUNT + 1 },
  (_, fret) => 1 - 2 ** (-fret / 12),
);
const PHYSICAL_FRET_SPACING_WEIGHT = 0.65;

const CHORD_SYMBOLS: Readonly<Record<ChordQuality, string>> = {
  major: "",
  minor: "m",
  dominant7: "7",
  major7: "maj7",
  minor7: "m7",
  diminished: "dim",
  suspended4: "sus4",
};

export type InstrumentMode = "guitar" | "piano" | "bass" | "ukulele" | "cello";

export type InstrumentDefinition = {
  readonly mode: InstrumentMode;
  readonly label: string;
  readonly stringNames: readonly string[];
  readonly tuningMidi: readonly number[];
  readonly minPosition: number;
  readonly maxFretCount: number;
  readonly visibleFretCounts: readonly number[];
  readonly defaultZoomIndex: number;
};

const FRETTED_DISPLAY_DEFAULTS = {
  minPosition: 0,
  maxFretCount: MAX_FRET_COUNT,
  visibleFretCounts: [6, 8, 12, 16, MAX_FRET_COUNT + 1],
  defaultZoomIndex: 4,
} as const satisfies Pick<InstrumentDefinition, "minPosition" | "maxFretCount" | "visibleFretCounts" | "defaultZoomIndex">;

function frettedInstrument(
  definition: Pick<InstrumentDefinition, "mode" | "label" | "stringNames" | "tuningMidi">,
): InstrumentDefinition {
  return { ...definition, ...FRETTED_DISPLAY_DEFAULTS };
}

export const INSTRUMENT_DEFINITIONS: Readonly<Record<InstrumentMode, InstrumentDefinition>> = {
  guitar: frettedInstrument({
    mode: "guitar",
    label: "Guitar",
    stringNames: ["E", "A", "D", "G", "B", "E"],
    tuningMidi: STANDARD_TUNING_MIDI,
  }),
  piano: {
    mode: "piano",
    label: "Piano",
    stringNames: ["Keys"],
    tuningMidi: [48],
    minPosition: 0,
    maxFretCount: 36,
    visibleFretCounts: [13, 25, 37],
    defaultZoomIndex: 1,
  },
  bass: frettedInstrument({
    mode: "bass",
    label: "Bass guitar",
    stringNames: ["E", "A", "D", "G"],
    tuningMidi: [28, 33, 38, 43],
  }),
  ukulele: frettedInstrument({
    mode: "ukulele",
    label: "Ukulele",
    stringNames: ["G", "C", "E", "A"],
    tuningMidi: [67, 60, 64, 69],
  }),
  cello: frettedInstrument({
    mode: "cello",
    label: "Cello",
    stringNames: ["C", "G", "D", "A"],
    tuningMidi: [36, 43, 50, 57],
  }),
};

export type FretRole = "root" | "chord-tone" | "scale-tone" | "none";

export type FretNote = {
  readonly stringIndex: number;
  readonly fret: number;
  readonly pitchClass: PitchClass;
  readonly noteName: string;
  readonly role: FretRole;
};

export function chordPitchClasses(
  rootPitchClass: PitchClass,
  quality: ChordQuality,
): readonly PitchClass[] {
  const chord = Chord.get(
    `${ROOT_NAMES[rootPitchClass]}${CHORD_SYMBOLS[quality]}`,
  );
  return chord.notes.map((note) => Note.chroma(note) as PitchClass);
}

export function scalePitchClasses(
  rootPitchClass: PitchClass,
  scaleName: string | undefined,
  chordNotes: readonly PitchClass[],
): readonly PitchClass[] {
  if (scaleName === undefined) {
    return [];
  }
  const scale = Scale.get(`${ROOT_NAMES[rootPitchClass]} ${scaleName}`);
  const pitchClasses = scale.notes.map((note) => Note.chroma(note) as PitchClass);
  return chordNotes.every((pitchClass) => pitchClasses.includes(pitchClass))
    ? pitchClasses
    : [];
}

export function buildFretboard(
  rootPitchClass: PitchClass,
  quality: ChordQuality,
  scaleName?: string,
  fretCount = FRET_COUNT,
  tuningMidi: readonly number[] = STANDARD_TUNING_MIDI,
): readonly FretNote[] {
  const chordNotes = chordPitchClasses(rootPitchClass, quality);
  const scaleNotes = scalePitchClasses(rootPitchClass, scaleName, chordNotes);
  const notes: FretNote[] = [];
  for (let stringIndex = 0; stringIndex < tuningMidi.length; stringIndex += 1) {
    for (let fret = 0; fret <= fretCount; fret += 1) {
      const openMidi = tuningMidi[stringIndex];
      if (openMidi === undefined) {
        throw new Error(`Missing tuning for string ${stringIndex}`);
      }
      const midi = openMidi + fret;
      const pitchClass = (midi % 12) as PitchClass;
      const role: FretRole =
        pitchClass === rootPitchClass
          ? "root"
          : chordNotes.includes(pitchClass)
            ? "chord-tone"
            : scaleNotes.includes(pitchClass)
              ? "scale-tone"
              : "none";
      notes.push({
        stringIndex,
        fret,
        pitchClass,
        noteName: Note.fromMidi(midi),
        role,
      });
    }
  }
  return notes;
}

export function clampFretStart(
  startFret: number,
  visibleFretCount: number,
  totalFretCount = MAX_FRET_COUNT,
  minStartFret = 1,
): number {
  return Math.max(minStartFret, Math.min(startFret, totalFretCount - visibleFretCount + 1));
}

export function stepFretStart(
  startFret: number,
  visibleFretCount: number,
  direction: -1 | 1,
  totalFretCount = MAX_FRET_COUNT,
  minStartFret = 1,
): number {
  return clampFretStart(
    startFret + direction,
    visibleFretCount,
    totalFretCount,
    minStartFret,
  );
}

export function fretWidthRatios(
  startFret: number,
  visibleFretCount: number,
): readonly number[] {
  if (startFret === 0) {
    return Array.from({ length: visibleFretCount }, () => 1 / visibleFretCount);
  }
  const endFret = startFret + visibleFretCount - 1;
  const segmentStart = FRET_POSITION_RATIOS[startFret - 1];
  const segmentEnd = FRET_POSITION_RATIOS[endFret];
  if (segmentStart === undefined || segmentEnd === undefined) {
    throw new RangeError(`Invalid fret range ${startFret}-${endFret}`);
  }
  const segmentLength = segmentEnd - segmentStart;
  const uniformWidth = 1 / visibleFretCount;
  return Array.from({ length: visibleFretCount }, (_, index) => {
    const fret = startFret + index;
    const left = FRET_POSITION_RATIOS[fret - 1];
    const right = FRET_POSITION_RATIOS[fret];
    if (left === undefined || right === undefined) {
      throw new RangeError(`Missing fret position ${fret}`);
    }
    const physicalWidth = (right - left) / segmentLength;
    return (
      physicalWidth * PHYSICAL_FRET_SPACING_WEIGHT +
      uniformWidth * (1 - PHYSICAL_FRET_SPACING_WEIGHT)
    );
  });
}
