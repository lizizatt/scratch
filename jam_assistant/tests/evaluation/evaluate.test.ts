import { EssentiaChromaExtractor } from "../../src/analysis/adapters/essentia";
import { MeydaChromaExtractor } from "../../src/analysis/adapters/meyda";
import { evaluateExtractor } from "../../src/evaluation/evaluate";

describe.each([
  ["Essentia.js", () => new EssentiaChromaExtractor()],
  ["Meyda", () => new MeydaChromaExtractor()],
] as const)("%s corpus evaluation", (_name, createExtractor) => {
  it("reports all required metrics without false chords on silence", async () => {
    const report = await evaluateExtractor(createExtractor());
    expect(report.accuracy).toBeGreaterThanOrEqual(0);
    expect(report.accuracy).toBeLessThanOrEqual(1);
    expect(Object.keys(report.accuracyByQuality)).toHaveLength(7);
    expect(report.silenceFalsePositive).toBe(false);
    expect(report.realtimeFactor).toBeGreaterThan(0);
  });
});

describe("Milestone 0 exit gate", () => {
  it("selects Meyda only when every product threshold passes", async () => {
    const report = await evaluateExtractor(new MeydaChromaExtractor());
    expect(report.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(Object.values(report.accuracyByQuality)).toEqual(
      expect.arrayContaining(new Array(7).fill(1)),
    );
    expect(report.silenceFalsePositive).toBe(false);
    expect(report.transitionLatencyMilliseconds).not.toBeNull();
    expect(report.transitionLatencyMilliseconds ?? Infinity).toBeLessThanOrEqual(
      500,
    );
    expect(report.realtimeFactor).toBeGreaterThanOrEqual(10);
  });
});
