import { ANALYSIS_FRAME_SIZE, ANALYSIS_HOP_SIZE, fftFrameSizeForMilliseconds } from "./config";
import { MeydaChromaExtractor } from "./adapters/meyda";
import { detectChord } from "./detector";
import { detectLowestNote } from "./lowest-note";
import { ChordSmoother } from "./smoother";
import type { ChordEstimate, PcmChunk } from "./types";

type StartMessage = {
  readonly type: "start";
  readonly sampleRate: number;
  readonly fftWindowMilliseconds: number;
};
type ConfigureMessage = {
  readonly type: "configure";
  readonly fftWindowMilliseconds: number;
};
type SamplesMessage = { readonly type: "samples"; readonly samples: Float32Array };
type StopMessage = { readonly type: "stop" };
type WorkerInput = StartMessage | ConfigureMessage | SamplesMessage | StopMessage;

let sampleRate = 48_000;
let startSample = 0;
let buffer: Float32Array<ArrayBufferLike> = new Float32Array(0);
let extractor: MeydaChromaExtractor | undefined;
let smoother: ChordSmoother | undefined;
let frameSize = ANALYSIS_FRAME_SIZE;
let hopSize = ANALYSIS_HOP_SIZE;

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  if (event.data.type === "start") {
    sampleRate = event.data.sampleRate;
    configureFftWindow(event.data.fftWindowMilliseconds);
    startSample = 0;
    buffer = new Float32Array(0);
    extractor = new MeydaChromaExtractor();
    smoother = new ChordSmoother(3);
    return;
  }
  if (event.data.type === "configure") {
    configureFftWindow(event.data.fftWindowMilliseconds);
    buffer = new Float32Array(0);
    return;
  }
  if (event.data.type === "stop") {
    extractor = undefined;
    smoother = undefined;
    buffer = new Float32Array(0);
    return;
  }
  if (extractor === undefined || smoother === undefined) {
    return;
  }
  buffer = append(buffer, event.data.samples);
  while (buffer.length >= frameSize) {
    const samples = buffer.slice(0, frameSize);
    const chunk: PcmChunk = { samples, sampleRate, startSample };
    const frame = extractor.extractAnalysis(chunk);
    const estimate = smoother.update(detectChord(frame));
    const lowestNote = estimate.state === "no-chord"
      ? undefined
      : detectLowestNote(frame.amplitudeSpectrum, sampleRate, frameSize);
    self.postMessage({
      type: "estimate",
      estimate,
      heatmapFrame: {
        timestampSeconds: frame.timestampSeconds,
        chroma: estimate.state === "no-chord" ? new Array(12).fill(0) : frame.values,
        intervalSeconds: hopSize / sampleRate,
        lowestNote,
      },
    });
    buffer = buffer.slice(hopSize);
    startSample += hopSize;
  }
};

function configureFftWindow(milliseconds: number): void {
  frameSize = fftFrameSizeForMilliseconds(milliseconds, sampleRate);
  hopSize = frameSize / 8;
}

function append(
  left: Float32Array<ArrayBufferLike>,
  right: Float32Array<ArrayBufferLike>,
): Float32Array<ArrayBufferLike> {
  const joined = new Float32Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
}
