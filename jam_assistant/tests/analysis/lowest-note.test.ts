import { detectLowestNote } from "../../src/analysis/lowest-note";

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 8192;

describe("detectLowestNote", () => {
  it("returns the lowest significant note when several fundamentals are present", () => {
    const spectrum = spectrumWithMidiPeaks([
      [40, 0.35],
      [48, 1],
      [55, 0.8],
    ]);

    expect(detectLowestNote(spectrum, SAMPLE_RATE, FFT_SIZE)).toBe("E2");
  });

  it("ignores weak low-frequency leakage", () => {
    const spectrum = spectrumWithMidiPeaks([
      [40, 0.1],
      [48, 1],
    ]);

    expect(detectLowestNote(spectrum, SAMPLE_RATE, FFT_SIZE)).toBe("C3");
  });

  it("returns no note for silence", () => {
    expect(detectLowestNote(new Float32Array(FFT_SIZE / 2), SAMPLE_RATE, FFT_SIZE)).toBeUndefined();
  });
});

function spectrumWithMidiPeaks(peaks: readonly (readonly [number, number])[]): Float32Array {
  const spectrum = new Float32Array(FFT_SIZE / 2);
  for (const [midi, strength] of peaks) {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    spectrum[Math.round(frequency * FFT_SIZE / SAMPLE_RATE)] = strength;
  }
  return spectrum;
}
