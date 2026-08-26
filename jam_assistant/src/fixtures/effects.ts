export type ChorusOptions = {
  readonly baseDelaySamples?: number;
  readonly depthSamples?: number;
  readonly rateHz?: number;
  readonly wet?: number;
};

const DEFAULT_CHORUS_OPTIONS: Required<ChorusOptions> = {
  baseDelaySamples: 240,
  depthSamples: 120,
  rateHz: 0.8,
  wet: 0.4,
};

export function applySoftClip(
  samples: Float32Array,
  drive: number,
): Float32Array {
  const normalization = Math.tanh(drive);
  const output = new Float32Array(samples.length);
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    output[sampleIndex] = Math.tanh(
      (samples[sampleIndex] ?? 0) * drive,
    ) / normalization;
  }
  return output;
}

export function applyChorus(
  samples: Float32Array,
  sampleRate: number,
  options: ChorusOptions = {},
): Float32Array {
  const resolvedOptions = { ...DEFAULT_CHORUS_OPTIONS, ...options };
  const output = new Float32Array(samples.length);
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const delaySamples =
      resolvedOptions.baseDelaySamples +
      resolvedOptions.depthSamples *
        Math.sin(
          (2 * Math.PI * resolvedOptions.rateHz * sampleIndex) / sampleRate,
        );
    const delayedSample = interpolateDelayedSample(samples, sampleIndex - delaySamples);
    output[sampleIndex] =
      (samples[sampleIndex] ?? 0) * (1 - resolvedOptions.wet) +
      delayedSample * resolvedOptions.wet;
  }
  return output;
}

function interpolateDelayedSample(
  samples: Float32Array,
  sourceIndex: number,
): number {
  if (sourceIndex < 0 || sourceIndex >= samples.length) {
    return 0;
  }
  const lowerIndex = Math.floor(sourceIndex);
  const fraction = sourceIndex - lowerIndex;
  const lowerSample = samples[lowerIndex] ?? 0;
  const upperSample = samples[lowerIndex + 1] ?? 0;
  return lowerSample * (1 - fraction) + upperSample * fraction;
}
