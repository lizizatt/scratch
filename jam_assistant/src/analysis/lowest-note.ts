const MIN_GUITAR_MIDI = 40;
const MAX_GUITAR_MIDI = 88;
const RELATIVE_PEAK_THRESHOLD = 0.2;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function detectLowestNote(
  amplitudeSpectrum: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
): string | undefined {
  const strengths = new Array<number>(MAX_GUITAR_MIDI - MIN_GUITAR_MIDI + 1).fill(0);
  for (let bin = 1; bin < amplitudeSpectrum.length; bin += 1) {
    const frequency = bin * sampleRate / fftSize;
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    if (midi < MIN_GUITAR_MIDI || midi > MAX_GUITAR_MIDI) {
      continue;
    }
    const index = midi - MIN_GUITAR_MIDI;
    strengths[index] = Math.max(strengths[index] ?? 0, amplitudeSpectrum[bin] ?? 0);
  }
  const peak = Math.max(...strengths, 0);
  if (peak <= Number.EPSILON) {
    return undefined;
  }
  const lowestIndex = strengths.findIndex(
    (strength) => strength >= peak * RELATIVE_PEAK_THRESHOLD,
  );
  return lowestIndex < 0
    ? undefined
    : midiNoteName(MIN_GUITAR_MIDI + lowestIndex);
}

function midiNoteName(midi: number): string {
  const pitchClass = NOTE_NAMES[((midi % 12) + 12) % 12] ?? "?";
  return `${pitchClass}${Math.floor(midi / 12) - 1}`;
}
