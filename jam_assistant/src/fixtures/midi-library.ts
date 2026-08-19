import { CHORD_INTERVALS } from "../analysis/chord-templates";
import type { ChordQuality, PitchClass } from "../analysis/types";
import { chordLabel } from "../music/timeline";

export type MidiChordEvent = {
  readonly rootPitchClass: PitchClass;
  readonly quality: ChordQuality;
  readonly startBeat: number;
  readonly durationBeats: number;
};

export type MidiFixtureDefinition = {
  readonly id: string;
  readonly title: string;
  readonly tempoBpm: number;
  readonly events: readonly MidiChordEvent[];
};

export const MIDI_TICKS_PER_BEAT = 480;
export const MIDI_ROOT_MIDI = 48;

export const MIDI_FIXTURES: readonly MidiFixtureDefinition[] = [
  {
    id: "quality-tour",
    title: "Supported chord quality tour",
    tempoBpm: 100,
    events: [
      { rootPitchClass: 0, quality: "major", startBeat: 0, durationBeats: 4 },
      { rootPitchClass: 0, quality: "minor", startBeat: 4, durationBeats: 4 },
      { rootPitchClass: 0, quality: "dominant7", startBeat: 8, durationBeats: 4 },
      { rootPitchClass: 0, quality: "major7", startBeat: 12, durationBeats: 4 },
      { rootPitchClass: 0, quality: "minor7", startBeat: 16, durationBeats: 4 },
      { rootPitchClass: 0, quality: "diminished", startBeat: 20, durationBeats: 4 },
      { rootPitchClass: 0, quality: "suspended4", startBeat: 24, durationBeats: 4 },
    ],
  },
  {
    id: "four-chord-cycle",
    title: "Four chord cycle",
    tempoBpm: 120,
    events: [
      { rootPitchClass: 9, quality: "minor", startBeat: 0, durationBeats: 4 },
      { rootPitchClass: 5, quality: "major", startBeat: 4, durationBeats: 4 },
      { rootPitchClass: 0, quality: "major", startBeat: 8, durationBeats: 4 },
      { rootPitchClass: 7, quality: "major", startBeat: 12, durationBeats: 4 },
    ],
  },
  {
    id: "seventh-resolution",
    title: "Dominant seventh resolution",
    tempoBpm: 90,
    events: [
      { rootPitchClass: 2, quality: "minor7", startBeat: 0, durationBeats: 4 },
      { rootPitchClass: 7, quality: "dominant7", startBeat: 4, durationBeats: 4 },
      { rootPitchClass: 0, quality: "major7", startBeat: 8, durationBeats: 8 },
    ],
  },
  {
    id: "irregular-durations",
    title: "Irregular chord durations",
    tempoBpm: 110,
    events: [
      { rootPitchClass: 0, quality: "major", startBeat: 0, durationBeats: 1.5 },
      { rootPitchClass: 5, quality: "suspended4", startBeat: 1.5, durationBeats: 2.5 },
      { rootPitchClass: 9, quality: "minor7", startBeat: 4, durationBeats: 3 },
      { rootPitchClass: 7, quality: "dominant7", startBeat: 7, durationBeats: 1 },
      { rootPitchClass: 0, quality: "major", startBeat: 8, durationBeats: 5 },
    ],
  },
];

export function midiNotesForChord(event: MidiChordEvent): readonly number[] {
  return CHORD_INTERVALS[event.quality].map(
    (interval) => MIDI_ROOT_MIDI + event.rootPitchClass + interval,
  );
}

export function fixtureDurationBeats(
  fixture: MidiFixtureDefinition,
): number {
  return Math.max(
    ...fixture.events.map((event) => event.startBeat + event.durationBeats),
  );
}

export function fixtureLabels(
  fixture: MidiFixtureDefinition,
): readonly string[] {
  return fixture.events.map((event) =>
    chordLabel(event.rootPitchClass, event.quality),
  );
}
