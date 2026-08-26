import {
  buildFretboard,
  clampFretStart,
  chordPitchClasses,
  FRET_POSITION_RATIOS,
  fretWidthRatios,
  INSTRUMENT_DEFINITIONS,
  MAX_FRET_COUNT,
  scalePitchClasses,
  stepFretStart,
} from "../../src/music/fretboard";

describe("fretboard model", () => {
  it("maps standard tuning to 78 stable fret positions", () => {
    const notes = buildFretboard(0, "major");
    expect(notes).toHaveLength(6 * 13);
    expect(notes[0]).toMatchObject({ fret: 0, noteName: "E2", pitchClass: 4 });
    expect(notes[12]).toMatchObject({ fret: 12, noteName: "E3", pitchClass: 4 });
    expect(notes[65]).toMatchObject({ stringIndex: 5, fret: 0, noteName: "E4" });
  });

  it("gets chord tones from Tonal for each supported quality", () => {
    expect(chordPitchClasses(0, "major")).toEqual([0, 4, 7]);
    expect(chordPitchClasses(0, "major7")).toEqual([0, 4, 7, 11]);
    expect(chordPitchClasses(0, "suspended4")).toEqual([0, 5, 7]);
  });

  it("only exposes scale tones when the selected scale contains the chord", () => {
    expect(scalePitchClasses(0, "major", [0, 4, 7])).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scalePitchClasses(0, "major", [0, 1, 7])).toEqual([]);
    expect(buildFretboard(0, "major", "major").some((note) => note.role === "scale-tone")).toBe(true);
  });

  it("supports every instrument tuning and requested octave range", () => {
    const piano = buildFretboard(0, "major", undefined, INSTRUMENT_DEFINITIONS.piano.maxFretCount, INSTRUMENT_DEFINITIONS.piano.tuningMidi);
    expect(piano).toHaveLength(37);
    expect(piano[0]).toMatchObject({ stringIndex: 0, fret: 0, noteName: "C3" });
    expect(piano[36]).toMatchObject({ stringIndex: 0, fret: 36, noteName: "C6" });

    const bass = buildFretboard(0, "major", undefined, INSTRUMENT_DEFINITIONS.bass.maxFretCount, INSTRUMENT_DEFINITIONS.bass.tuningMidi);
    expect(bass).toHaveLength(4 * 25);
    expect(bass[0]).toMatchObject({ stringIndex: 0, fret: 0, noteName: "E1" });
    expect(bass[87]).toMatchObject({ stringIndex: 3, fret: 12, noteName: "G3" });

    const ukulele = buildFretboard(0, "major", undefined, INSTRUMENT_DEFINITIONS.ukulele.maxFretCount, INSTRUMENT_DEFINITIONS.ukulele.tuningMidi);
    expect(ukulele).toHaveLength(4 * 25);
    expect(ukulele[0]).toMatchObject({ stringIndex: 0, fret: 0, noteName: "G4" });
    expect(ukulele[87]).toMatchObject({ stringIndex: 3, fret: 12, noteName: "A5" });

    const cello = buildFretboard(0, "major", undefined, INSTRUMENT_DEFINITIONS.cello.maxFretCount, INSTRUMENT_DEFINITIONS.cello.tuningMidi);
    expect(cello).toHaveLength(4 * 25);
    expect(cello[0]).toMatchObject({ stringIndex: 0, fret: 0, noteName: "C2" });
    expect(cello[75]).toMatchObject({ stringIndex: 3, fret: 0, noteName: "A3" });
    expect(cello[87]).toMatchObject({ stringIndex: 3, fret: 12, noteName: "A4" });
  });

  it("gives every fretted instrument the shared full-range display profile", () => {
    for (const mode of ["guitar", "bass", "ukulele", "cello"] as const) {
      const instrument = INSTRUMENT_DEFINITIONS[mode];
      expect(instrument.minPosition).toBe(0);
      expect(instrument.maxFretCount).toBe(MAX_FRET_COUNT);
      expect(instrument.visibleFretCounts).toEqual([6, 8, 12, 16, MAX_FRET_COUNT + 1]);
    }
  });

  it("gives piano one, two, and three octave views with a two-octave default", () => {
    const piano = INSTRUMENT_DEFINITIONS.piano;
    expect(piano.minPosition).toBe(0);
    expect(piano.maxFretCount).toBe(36);
    expect(piano.visibleFretCounts).toEqual([13, 25, 37]);
    expect(piano.defaultZoomIndex).toBe(1);
  });

  it("builds and navigates bounded fretboard segments", () => {
    expect(buildFretboard(0, "major", undefined, 24)).toHaveLength(6 * 25);
    expect(stepFretStart(1, 12, 1)).toBe(2);
    expect(stepFretStart(13, 12, -1)).toBe(12);
    expect(stepFretStart(13, 12, 1)).toBe(13);
    expect(clampFretStart(20, 8)).toBe(17);
    expect(clampFretStart(4, 13, 12, 0)).toBe(0);
    expect(stepFretStart(0, 13, 1, 12, 0)).toBe(0);
  });

  it("spaces frets by equal-tempered scale-length positions", () => {
    expect(FRET_POSITION_RATIOS[12]).toBeCloseTo(0.5);
    expect(FRET_POSITION_RATIOS[24]).toBeCloseTo(0.75);
    const widths = fretWidthRatios(1, 24);
    expect(widths).toHaveLength(24);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(1);
    expect(widths.every((width, index) => index === 0 || width < (widths[index - 1] ?? 0))).toBe(true);
    expect((widths[0] ?? 0) / (widths[23] ?? 1)).toBeCloseTo(2.3, 1);
  });
});
