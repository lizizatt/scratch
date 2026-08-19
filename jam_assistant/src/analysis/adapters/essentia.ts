import EssentiaPackage from "essentia.js";
import { rootMeanSquare } from "../energy";
import {
  assertChroma,
  type ChromaExtractor,
  type ChromaFrame,
  type PcmChunk,
} from "../types";

type Extractor = {
  hpcpExtractor(
    audioFrame: Float32Array,
    sampleRate: number,
    asVector?: boolean,
  ): Float32Array | number[];
};

export class EssentiaChromaExtractor implements ChromaExtractor {
  readonly id = "essentia.js-0.1.3-hpcp";
  #extractor: Extractor | undefined;

  async initialize(): Promise<void> {
    this.#extractor ??= new EssentiaPackage.EssentiaExtractor(
      EssentiaPackage.EssentiaWASM,
    ) as Extractor;
  }

  extract(chunk: PcmChunk): ChromaFrame {
    if (this.#extractor === undefined) {
      throw new Error("Essentia extractor must be initialized before use");
    }
    const aFirst = Array.from(
      this.#extractor.hpcpExtractor(chunk.samples, chunk.sampleRate),
    );
    assertChroma(aFirst);
    const cFirst = [...aFirst.slice(3), ...aFirst.slice(0, 3)];
    return {
      timestampSeconds: chunk.startSample / chunk.sampleRate,
      values: cFirst,
      energy: rootMeanSquare(chunk.samples),
    };
  }
}
