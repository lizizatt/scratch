import { EssentiaChromaExtractor } from "../../src/analysis/adapters/essentia";
import { MeydaChromaExtractor } from "../../src/analysis/adapters/meyda";
import type { ChromaExtractor, PcmChunk } from "../../src/analysis/types";
import { FIXTURE_SAMPLE_RATE } from "../../src/fixtures/synthesis";

const FRAME_SIZE = 4096;

describe.each([
  ["Essentia.js", () => new EssentiaChromaExtractor()],
  ["Meyda", () => new MeydaChromaExtractor()],
] as const)("%s chroma adapter", (_name, createExtractor) => {
  it("maps every pitch to canonical C-to-B bins", async () => {
    const extractor = createExtractor();
    await extractor.initialize();
    for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
      const chroma = extractor.extract(toneChunk(pitchClass));
      expect(indexOfMaximum(chroma.values)).toBe(pitchClass);
    }
  });

  it("requires initialization when applicable", () => {
    const extractor: ChromaExtractor = createExtractor();
    if (extractor instanceof EssentiaChromaExtractor) {
      expect(() => extractor.extract(toneChunk(0))).toThrow(/initialized/);
    }
  });
});

function toneChunk(pitchClass: number): PcmChunk {
  const samples = new Float32Array(FRAME_SIZE);
  const frequency = 440 * 2 ** ((60 + pitchClass - 69) / 12);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin(
      (2 * Math.PI * frequency * index) / FIXTURE_SAMPLE_RATE,
    );
  }
  return { samples, sampleRate: FIXTURE_SAMPLE_RATE, startSample: 0 };
}

function indexOfMaximum(values: readonly number[]): number {
  let maximumIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index] ?? 0) > (values[maximumIndex] ?? 0)) {
      maximumIndex = index;
    }
  }
  return maximumIndex;
}
