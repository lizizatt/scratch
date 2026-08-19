import Meyda from "meyda";
import { rootMeanSquare } from "../energy";
import {
  assertChroma,
  type ChromaExtractor,
  type ChromaFrame,
  type PcmChunk,
} from "../types";

export class MeydaChromaExtractor implements ChromaExtractor {
  readonly id = "meyda-5.6.3";

  async initialize(): Promise<void> {}

  extract(chunk: PcmChunk): ChromaFrame {
    Meyda.bufferSize = chunk.samples.length;
    Meyda.sampleRate = chunk.sampleRate;
    Meyda.chromaBands = 12;
    const result = Meyda.extract("chroma", chunk.samples);
    if (!Array.isArray(result)) {
      throw new TypeError("Meyda did not return a chroma array");
    }
    assertChroma(result);
    return {
      timestampSeconds: chunk.startSample / chunk.sampleRate,
      values: result,
      energy: rootMeanSquare(chunk.samples),
    };
  }
}
