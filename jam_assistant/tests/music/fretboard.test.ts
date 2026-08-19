import {
  buildFretboard,
  chordPitchClasses,
  scalePitchClasses,
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
});
