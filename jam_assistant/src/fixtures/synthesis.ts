import { CHORD_INTERVALS } from "../analysis/chord-templates";
import type { ChordQuality, PitchClass } from "../analysis/types";

export const FIXTURE_SAMPLE_RATE = 16_000;
export const FIXTURE_DURATION_SECONDS = 0.768;

export type FixtureLabel = {
  readonly rootPitchClass: PitchClass;
  readonly quality: ChordQuality;
};

export function synthesizeChord(
  label: FixtureLabel,
  durationSeconds = FIXTURE_DURATION_SECONDS,
  sampleRate = FIXTURE_SAMPLE_RATE,
): Float32Array {
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const samples = new Float32Array(sampleCount);
  const rootMidi = 48 + label.rootPitchClass;
  for (const interval of CHORD_INTERVALS[label.quality]) {
    const frequency = midiToFrequency(rootMidi + interval);
    const toneWeight = interval === 0 ? 1.25 : 1;
    for (let harmonic = 1; harmonic <= 4; harmonic += 1) {
      const harmonicWeight = toneWeight / harmonic;
      for (let index = 0; index < sampleCount; index += 1) {
        samples[index] =
          (samples[index] ?? 0) +
          harmonicWeight *
          Math.sin((2 * Math.PI * frequency * harmonic * index) / sampleRate);
      }
    }
  }
  applyFade(samples, sampleRate, 0.02);
  normalize(samples, 0.8);
  return samples;
}

export function synthesizeTransition(
  first: FixtureLabel,
  second: FixtureLabel,
): Float32Array {
  const firstSamples = synthesizeChord(first);
  const secondSamples = synthesizeChord(second);
  const output = new Float32Array(firstSamples.length + secondSamples.length);
  output.set(firstSamples);
  output.set(secondSamples, firstSamples.length);
  return output;
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function applyFade(
  samples: Float32Array,
  sampleRate: number,
  fadeSeconds: number,
): void {
  const fadeSamples = Math.min(
    Math.round(sampleRate * fadeSeconds),
    Math.floor(samples.length / 2),
  );
  for (let index = 0; index < fadeSamples; index += 1) {
    const gain = index / fadeSamples;
    samples[index] = (samples[index] ?? 0) * gain;
    const endIndex = samples.length - 1 - index;
    samples[endIndex] = (samples[endIndex] ?? 0) * gain;
  }
}

function normalize(samples: Float32Array, peak: number): void {
  let maximum = 0;
  for (const sample of samples) {
    maximum = Math.max(maximum, Math.abs(sample));
  }
  if (maximum === 0) {
    return;
  }
  const scale = peak / maximum;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (samples[index] ?? 0) * scale;
  }
}
