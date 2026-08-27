import { describe, expect, it } from "vitest";
import { detectPianoNotes, PIANO_MAX_MIDI, PIANO_MIN_MIDI } from "../../src/analysis/piano";

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 32_768;

function spectrumWithMidiPeaks(peaks: readonly number[]): Float32Array {
  const spectrum = new Float32Array(FFT_SIZE / 2);
  for (const midi of peaks) {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    spectrum[Math.round(frequency * FFT_SIZE / SAMPLE_RATE)] = 1;
  }
  return spectrum;
}

describe("detectPianoNotes", () => {
  it("returns exactly six octaves from C2 through B7", () => {
    const notes = detectPianoNotes(
      spectrumWithMidiPeaks([PIANO_MIN_MIDI, PIANO_MAX_MIDI]),
      SAMPLE_RATE,
      FFT_SIZE,
    );

    expect(notes).toHaveLength(72);
    expect(notes[0]).toEqual({ midi: PIANO_MIN_MIDI, strength: 1 });
    expect(notes.at(-1)).toEqual({ midi: PIANO_MAX_MIDI, strength: 1 });
  });

  it("normalizes spectrum peaks independently of absolute volume", () => {
    const spectrum = spectrumWithMidiPeaks([60]);
    spectrum[Math.round((440 * 2 ** ((64 - 69) / 12)) * FFT_SIZE / SAMPLE_RATE)] = 0.5;

    const notes = detectPianoNotes(spectrum, SAMPLE_RATE, FFT_SIZE);

    expect(notes.find((note) => note.midi === 60)?.strength).toBe(1);
    expect(notes.find((note) => note.midi === 64)?.strength).toBeCloseTo(0.5);
  });

  it("returns no notes for silence", () => {
    expect(detectPianoNotes(new Float32Array(FFT_SIZE / 2), SAMPLE_RATE, FFT_SIZE)).toEqual([]);
  });
});
