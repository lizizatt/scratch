import { performance } from "node:perf_hooks";
import { ANALYSIS_FRAME_SIZE, ANALYSIS_HOP_SIZE } from "../analysis/config";
import { detectChord } from "../analysis/detector";
import { ChordSmoother } from "../analysis/smoother";
import {
  CHORD_QUALITIES,
  type ChordQuality,
  type ChromaExtractor,
  type PcmChunk,
  type PitchClass,
} from "../analysis/types";
import {
  FIXTURE_DURATION_SECONDS,
  FIXTURE_SAMPLE_RATE,
  synthesizeChord,
  synthesizeTransition,
} from "../fixtures/synthesis";

export type EvaluationReport = {
  readonly adapter: string;
  readonly accuracy: number;
  readonly accuracyByQuality: Readonly<Record<ChordQuality, number>>;
  readonly silenceFalsePositive: boolean;
  readonly transitionLatencyMilliseconds: number | null;
  readonly initializationMilliseconds: number;
  readonly processingMilliseconds: number;
  readonly audioDurationSeconds: number;
  readonly realtimeFactor: number;
};

export async function evaluateExtractor(
  extractor: ChromaExtractor,
): Promise<EvaluationReport> {
  const initializationStart = performance.now();
  await extractor.initialize();
  const initializationMilliseconds = performance.now() - initializationStart;

  const correctByQuality = Object.fromEntries(
    CHORD_QUALITIES.map((quality) => [quality, 0]),
  ) as Record<ChordQuality, number>;
  const processingStart = performance.now();
  let correct = 0;
  let audioDurationSeconds = 0;
  for (let root = 0; root < 12; root += 1) {
    for (const quality of CHORD_QUALITIES) {
      const samples = synthesizeChord({
        rootPitchClass: root as PitchClass,
        quality,
      });
      const estimate = detectChord(
        extractor.extract(centerChunk(samples, FIXTURE_SAMPLE_RATE)),
      );
      if (
        estimate.state === "chord" &&
        estimate.rootPitchClass === root &&
        estimate.quality === quality
      ) {
        correct += 1;
        correctByQuality[quality] += 1;
      }
      audioDurationSeconds += samples.length / FIXTURE_SAMPLE_RATE;
    }
  }

  const silence = new Float32Array(ANALYSIS_FRAME_SIZE);
  const silenceEstimate = detectChord(
    extractor.extract(chunk(silence, FIXTURE_SAMPLE_RATE, 0)),
  );
  audioDurationSeconds += silence.length / FIXTURE_SAMPLE_RATE;
  const processingMilliseconds = performance.now() - processingStart;

  return {
    adapter: extractor.id,
    accuracy: correct / (12 * CHORD_QUALITIES.length),
    accuracyByQuality: Object.fromEntries(
      CHORD_QUALITIES.map((quality) => [quality, correctByQuality[quality] / 12]),
    ) as Record<ChordQuality, number>,
    silenceFalsePositive: silenceEstimate.state === "chord",
    transitionLatencyMilliseconds: measureTransitionLatency(extractor),
    initializationMilliseconds,
    processingMilliseconds,
    audioDurationSeconds,
    realtimeFactor:
      audioDurationSeconds / Math.max(processingMilliseconds / 1000, 0.000_001),
  };
}

function measureTransitionLatency(extractor: ChromaExtractor): number | null {
  const boundarySeconds = FIXTURE_DURATION_SECONDS;
  const samples = synthesizeTransition(
    { rootPitchClass: 0, quality: "major" },
    { rootPitchClass: 2, quality: "minor" },
  );
  const smoother = new ChordSmoother(3);
  for (
    let startSample = 0;
    startSample + ANALYSIS_FRAME_SIZE <= samples.length;
    startSample += ANALYSIS_HOP_SIZE
  ) {
    const frameSamples = samples.slice(
      startSample,
      startSample + ANALYSIS_FRAME_SIZE,
    );
    const estimate = smoother.update(
      detectChord(
        extractor.extract(
          chunk(frameSamples, FIXTURE_SAMPLE_RATE, startSample),
        ),
      ),
    );
    if (
      estimate.state === "chord" &&
      estimate.rootPitchClass === 2 &&
      estimate.quality === "minor"
    ) {
      const acceptedAtSeconds =
        (startSample + ANALYSIS_FRAME_SIZE) / FIXTURE_SAMPLE_RATE;
      if (acceptedAtSeconds >= boundarySeconds) {
        return (acceptedAtSeconds - boundarySeconds) * 1000;
      }
    }
  }
  return null;
}

function centerChunk(samples: Float32Array, sampleRate: number): PcmChunk {
  const startSample = Math.floor((samples.length - ANALYSIS_FRAME_SIZE) / 2);
  return chunk(
    samples.slice(startSample, startSample + ANALYSIS_FRAME_SIZE),
    sampleRate,
    startSample,
  );
}

function chunk(
  samples: Float32Array,
  sampleRate: number,
  startSample: number,
): PcmChunk {
  return { samples, sampleRate, startSample };
}
