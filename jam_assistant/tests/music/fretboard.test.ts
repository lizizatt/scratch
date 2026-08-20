import {
  buildFretboard,
  clampFretStart,
  chordPitchClasses,
  FRET_POSITION_RATIOS,
  fretWidthRatios,
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

  it("builds and navigates bounded fretboard segments", () => {
    expect(buildFretboard(0, "major", undefined, 24)).toHaveLength(6 * 25);
    expect(stepFretStart(1, 12, 1)).toBe(2);
    expect(stepFretStart(13, 12, -1)).toBe(12);
    expect(stepFretStart(13, 12, 1)).toBe(13);
    expect(clampFretStart(20, 8)).toBe(17);
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
