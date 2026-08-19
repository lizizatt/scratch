import { ANALYSIS_FRAME_SIZE, ANALYSIS_HOP_SIZE } from "./config";
import { MeydaChromaExtractor } from "./adapters/meyda";
import { detectChord } from "./detector";
import { ChordSmoother } from "./smoother";
import type { ChordEstimate, PcmChunk } from "./types";

type StartMessage = { readonly type: "start"; readonly sampleRate: number };
type SamplesMessage = { readonly type: "samples"; readonly samples: Float32Array };
type StopMessage = { readonly type: "stop" };
type WorkerInput = StartMessage | SamplesMessage | StopMessage;

let sampleRate = 48_000;
let startSample = 0;
let buffer: Float32Array<ArrayBufferLike> = new Float32Array(0);
let extractor: MeydaChromaExtractor | undefined;
let smoother: ChordSmoother | undefined;

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  if (event.data.type === "start") {
    sampleRate = event.data.sampleRate;
    startSample = 0;
    buffer = new Float32Array(0);
    extractor = new MeydaChromaExtractor();
    smoother = new ChordSmoother(3);
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
  while (buffer.length >= ANALYSIS_FRAME_SIZE) {
    const samples = buffer.slice(0, ANALYSIS_FRAME_SIZE);
    const chunk: PcmChunk = { samples, sampleRate, startSample };
    const estimate = smoother.update(detectChord(extractor.extract(chunk)));
    self.postMessage({ type: "estimate", estimate });
    buffer = buffer.slice(ANALYSIS_HOP_SIZE);
    startSample += ANALYSIS_HOP_SIZE;
  }
};

function append(
  left: Float32Array<ArrayBufferLike>,
  right: Float32Array<ArrayBufferLike>,
): Float32Array<ArrayBufferLike> {
  const joined = new Float32Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
}
