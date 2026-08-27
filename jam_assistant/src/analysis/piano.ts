export const PIANO_MIN_MIDI = 36;
export const PIANO_MAX_MIDI = 107;
export const PIANO_KEY_COUNT = PIANO_MAX_MIDI - PIANO_MIN_MIDI + 1;

export type PianoNote = {
  readonly midi: number;
  readonly strength: number;
};

export type PianoFrame = {
  readonly timestampSeconds: number;
  readonly notes: readonly PianoNote[];
};

export function detectPianoNotes(
  amplitudeSpectrum: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
): readonly PianoNote[] {
  const strengths = new Array<number>(PIANO_KEY_COUNT).fill(0);
  for (let bin = 1; bin < amplitudeSpectrum.length; bin += 1) {
    const frequency = bin * sampleRate / fftSize;
    if (frequency <= 0) {
      continue;
    }
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    if (midi < PIANO_MIN_MIDI || midi > PIANO_MAX_MIDI) {
      continue;
    }
    const index = midi - PIANO_MIN_MIDI;
    strengths[index] = Math.max(strengths[index] ?? 0, amplitudeSpectrum[bin] ?? 0);
  }

  const peak = Math.max(...strengths, 0);
  if (peak <= Number.EPSILON) {
    return [];
  }
  return strengths.map((strength, index) => ({
    midi: PIANO_MIN_MIDI + index,
    strength: strength / peak,
  }));
}
