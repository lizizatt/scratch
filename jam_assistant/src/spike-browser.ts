import { MeydaChromaExtractor } from "./analysis/adapters/meyda";
import { ANALYSIS_FRAME_SIZE } from "./analysis/config";
import { detectChord } from "./analysis/detector";

export type BrowserBenchmarkResult = {
  readonly durationSeconds: number;
  readonly decodeMilliseconds: number;
  readonly analysisMilliseconds: number;
  readonly realtimeFactor: number;
  readonly chordVotes: Readonly<Record<string, number>>;
  readonly firstChroma: readonly number[];
  readonly stableChord: {
    readonly rootPitchClass: number;
    readonly quality: string;
  } | null;
};

export async function runMp3Benchmark(
  encodedBytes: Uint8Array,
): Promise<BrowserBenchmarkResult> {
  const context = new AudioContext();
  const decodeStart = performance.now();
  const encodedBuffer = encodedBytes.buffer.slice(
    encodedBytes.byteOffset,
    encodedBytes.byteOffset + encodedBytes.byteLength,
  ) as ArrayBuffer;
  const audioBuffer = await context.decodeAudioData(encodedBuffer);
  const decodeMilliseconds = performance.now() - decodeStart;
  const samples = downmix(audioBuffer);
  const extractor = new MeydaChromaExtractor();
  await extractor.initialize();

  const counts = new Map<string, number>();
  let firstChroma: readonly number[] = [];
  const analysisStart = performance.now();
  for (
    let startSample = 0;
    startSample + ANALYSIS_FRAME_SIZE <= samples.length;
    startSample += ANALYSIS_FRAME_SIZE
  ) {
    const frameSamples = samples.slice(
      startSample,
      startSample + ANALYSIS_FRAME_SIZE,
    );
    const chroma = extractor.extract({
        samples: frameSamples,
        sampleRate: audioBuffer.sampleRate,
        startSample,
      });
    if (firstChroma.length === 0) {
      firstChroma = chroma.values;
    }
    const estimate = detectChord(chroma);
    if (estimate.state === "chord") {
      const key = `${estimate.rootPitchClass}:${estimate.quality}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const analysisMilliseconds = performance.now() - analysisStart;
  await context.close();

  const stableKey = [...counts.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0];
  const [root, quality] = stableKey?.split(":") ?? [];
  const totalMilliseconds = decodeMilliseconds + analysisMilliseconds;
  return {
    durationSeconds: audioBuffer.duration,
    decodeMilliseconds,
    analysisMilliseconds,
    realtimeFactor:
      audioBuffer.duration / Math.max(totalMilliseconds / 1000, 0.000_001),
    chordVotes: Object.fromEntries(counts),
    firstChroma,
    stableChord:
      root === undefined || quality === undefined
        ? null
        : { rootPitchClass: Number(root), quality },
  };
}

function downmix(audioBuffer: AudioBuffer): Float32Array {
  const samples = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] =
        (samples[index] ?? 0) +
        (channelData[index] ?? 0) / audioBuffer.numberOfChannels;
    }
  }
  return samples;
}

declare global {
  interface Window {
    runMp3Benchmark: (encodedBytes: Uint8Array) => Promise<BrowserBenchmarkResult>;
  }
}

window.runMp3Benchmark = runMp3Benchmark;
