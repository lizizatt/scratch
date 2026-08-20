import { emptyHeatmap, logarithmicOpacity, updateHeatmap } from "../../src/analysis/heatmap";
import { fftFrameSizeForMilliseconds } from "../../src/analysis/config";

describe("updateHeatmap", () => {
  it("accumulates repeated pitch-class energy toward full intensity", () => {
    const chroma = [1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const first = updateHeatmap(emptyHeatmap(), chroma, 0.1, 1, 100);
    const second = updateHeatmap(first, chroma, 0.1, 1, 100);

    expect(second[0]).toBeGreaterThan(first[0] ?? 0);
    expect(second[0]).toBeGreaterThan(second[1] ?? 0);
    expect(second[2]).toBe(0);
  });

  it("fades inactive pitch classes exponentially over elapsed time", () => {
    const current = [1, ...new Array<number>(11).fill(0)];
    const faded = updateHeatmap(current, emptyHeatmap(), 1, 1, 2);

    expect(faded[0]).toBeCloseTo(Math.exp(-0.5));
  });

  it("normalizes each frame against its strongest pitch class", () => {
    const quiet = updateHeatmap(emptyHeatmap(), [0.1, ...new Array<number>(11).fill(0)], 1, 1, 100);
    const loud = updateHeatmap(emptyHeatmap(), [1, ...new Array<number>(11).fill(0)], 1, 1, 100);

    expect(quiet[0]).toBeCloseTo(loud[0] ?? 0);
  });
});

describe("fftFrameSizeForMilliseconds", () => {
  it("selects bounded power-of-two FFT windows", () => {
    expect(fftFrameSizeForMilliseconds(21, 48_000)).toBe(1024);
    expect(fftFrameSizeForMilliseconds(85, 48_000)).toBe(4096);
    expect(fftFrameSizeForMilliseconds(171, 48_000)).toBe(8192);
  });
});

describe("logarithmicOpacity", () => {
  it("preserves endpoints and boosts quieter values as response increases", () => {
    expect(logarithmicOpacity(0, 0.5)).toBe(0);
    expect(logarithmicOpacity(1, 0.5)).toBe(1);
    expect(logarithmicOpacity(0.1, 1)).toBeGreaterThan(logarithmicOpacity(0.1, 0.1));
  });
});
