import { CHORD_QUALITIES } from "../../src/analysis/types";
import {
  FIXTURE_SAMPLE_RATE,
  synthesizeChord,
} from "../../src/fixtures/synthesis";
import { encodeMonoWav } from "../../src/fixtures/wav";

describe("fixture synthesis", () => {
  it("generates a non-silent deterministic fixture for every chord", () => {
    for (let rootPitchClass = 0; rootPitchClass < 12; rootPitchClass += 1) {
      for (const quality of CHORD_QUALITIES) {
        const first = synthesizeChord({
          rootPitchClass: rootPitchClass as 0,
          quality,
        });
        const second = synthesizeChord({
          rootPitchClass: rootPitchClass as 0,
          quality,
        });
        expect(first).toEqual(second);
        expect(first.some((sample) => sample !== 0)).toBe(true);
      }
    }
  }, 15_000);

  it("encodes standards-shaped mono PCM WAV data", () => {
    const samples = synthesizeChord({ rootPitchClass: 0, quality: "major" });
    const wav = encodeMonoWav(samples, FIXTURE_SAMPLE_RATE);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(wav.byteLength).toBe(44 + samples.length * 2);
  });
});
