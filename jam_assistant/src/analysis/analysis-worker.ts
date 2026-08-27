import { ANALYSIS_FRAME_SIZE, ANALYSIS_HOP_SIZE } from "./config";
import { MeydaChromaExtractor } from "./adapters/meyda";
import { detectChord } from "./detector";
import { detectPianoNotes, type PianoFrame } from "./piano";
import { ChordSmoother } from "./smoother";
import type { ChordEstimate, PcmChunk } from "./types";

export type PcmAnalysisResult = {
  readonly estimates: readonly ChordEstimate[];
  readonly pianoFrames: readonly PianoFrame[];
};

export function analyzePcm(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): readonly ChordEstimate[] {
  return analyzePcmDetailed(samples, sampleRate, onProgress).estimates;
}

export function analyzePcmDetailed(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): PcmAnalysisResult {
  const extractor = new MeydaChromaExtractor();
  const smoother = new ChordSmoother(3);
  const estimates: ChordEstimate[] = [];
  const pianoFrames: PianoFrame[] = [];
  const frameCount = Math.max(
    1,
    Math.floor((samples.length - ANALYSIS_FRAME_SIZE) / ANALYSIS_HOP_SIZE) + 1,
  );
  for (
    let startSample = 0;
    startSample + ANALYSIS_FRAME_SIZE <= samples.length;
    startSample += ANALYSIS_HOP_SIZE
  ) {
    const frame = samples.slice(startSample, startSample + ANALYSIS_FRAME_SIZE);
    const chunk: PcmChunk = { samples: frame, sampleRate, startSample };
    const analysisFrame = extractor.extractAnalysis(chunk);
    estimates.push(smoother.update(detectChord(analysisFrame)));
    pianoFrames.push({
      timestampSeconds: analysisFrame.timestampSeconds,
      notes: detectPianoNotes(analysisFrame.amplitudeSpectrum, sampleRate, frame.length),
    });
    onProgress?.(Math.min(1, estimates.length / frameCount));
  }
  return { estimates, pianoFrames };
}

type WorkerScope = {
  onmessage: (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => void;
  postMessage: (message: unknown) => void;
};

const workerScope = globalThis as unknown as Partial<WorkerScope>;
if (typeof workerScope.postMessage === "function") {
  workerScope.onmessage = (event) => {
    try {
      const analysis = analyzePcmDetailed(
        event.data.samples,
        event.data.sampleRate,
        (fraction) => workerScope.postMessage?.({ type: "progress", fraction }),
      );
      workerScope.postMessage?.({ type: "complete", ...analysis });
    } catch (error) {
      workerScope.postMessage?.({
        type: "error",
        message: error instanceof Error ? error.message : "Audio analysis failed",
      });
    }
  };
}
