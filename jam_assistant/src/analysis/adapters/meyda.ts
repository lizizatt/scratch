import Meyda from "meyda";
import { rootMeanSquare } from "../energy";
import {
  assertChroma,
  type ChromaExtractor,
  type ChromaFrame,
  type PcmChunk,
} from "../types";

export type MeydaAnalysisFrame = ChromaFrame & {
  readonly amplitudeSpectrum: Float32Array;
};

export class MeydaChromaExtractor implements ChromaExtractor {
  readonly id = "meyda-5.6.3";

  async initialize(): Promise<void> {}

  extract(chunk: PcmChunk): ChromaFrame {
    return this.extractAnalysis(chunk);
  }

  extractAnalysis(chunk: PcmChunk): MeydaAnalysisFrame {
    Meyda.bufferSize = chunk.samples.length;
    Meyda.sampleRate = chunk.sampleRate;
    Meyda.chromaBands = 12;
    const result = Meyda.extract(["chroma", "amplitudeSpectrum"], chunk.samples);
    if (
      result === null ||
      !Array.isArray(result.chroma) ||
      !(result.amplitudeSpectrum instanceof Float32Array)
    ) {
      throw new TypeError("Meyda did not return chroma and amplitude spectrum");
    }
    assertChroma(result.chroma);
    return {
      timestampSeconds: chunk.startSample / chunk.sampleRate,
      values: result.chroma,
      energy: rootMeanSquare(chunk.samples),
      amplitudeSpectrum: result.amplitudeSpectrum,
    };
  }
}
