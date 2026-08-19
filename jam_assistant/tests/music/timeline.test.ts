import { chordTemplate } from "../../src/analysis/chord-templates";
import type { ChordEstimate, ChordQuality, PitchClass } from "../../src/analysis/types";
import { detectedChordMarkers } from "../../src/music/timeline";

describe("detectedChordMarkers", () => {
  it("collapses repeated estimates into named chord changes", () => {
    const markers = detectedChordMarkers([
      estimate(0, 0, "major"),
      estimate(0.1, 0, "major"),
      estimate(0.2, 0, "major"),
      estimate(0.8, 2, "minor"),
      estimate(0.9, 2, "minor"),
    ]);
    expect(markers).toEqual([
      { timestampSeconds: 0, rootPitchClass: 0, quality: "major", label: "C" },
      { timestampSeconds: 0.8, rootPitchClass: 2, quality: "minor", label: "Dm" },
    ]);
  });

  it("starts a new marker after an explicit no-chord interval", () => {
    const markers = detectedChordMarkers([
      estimate(0, 0, "major"),
      { timestampSeconds: 0.5, state: "no-chord", reason: "silence", confidence: 1, chroma: new Array(12).fill(0) },
      estimate(1, 0, "major"),
    ]);
    expect(markers.map((marker) => marker.timestampSeconds)).toEqual([0, 1]);
  });
});

function estimate(
  timestampSeconds: number,
  rootPitchClass: PitchClass,
  quality: ChordQuality,
): ChordEstimate {
  return {
    timestampSeconds,
    rootPitchClass,
    quality,
    state: "chord",
    confidence: 1,
    chroma: chordTemplate(rootPitchClass, quality),
  };
}
