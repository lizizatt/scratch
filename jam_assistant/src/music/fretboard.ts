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

const CHORD_SYMBOLS: Readonly<Record<ChordQuality, string>> = {
  major: "",
  minor: "m",
  dominant7: "7",
  major7: "maj7",
  minor7: "m7",
  diminished: "dim",
  suspended4: "sus4",
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
): readonly FretNote[] {
  const chordNotes = chordPitchClasses(rootPitchClass, quality);
  const scaleNotes = scalePitchClasses(rootPitchClass, scaleName, chordNotes);
  const notes: FretNote[] = [];
  for (let stringIndex = 0; stringIndex < STANDARD_TUNING_MIDI.length; stringIndex += 1) {
    for (let fret = 0; fret <= FRET_COUNT; fret += 1) {
      const openMidi = STANDARD_TUNING_MIDI[stringIndex];
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
