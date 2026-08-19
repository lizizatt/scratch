import { assertChroma } from "../../src/analysis/types";

describe("assertChroma", () => {
  it("accepts 12 finite non-negative bins", () => {
    expect(() => assertChroma(new Array(12).fill(0))).not.toThrow();
  });

  it("rejects malformed feature output", () => {
    expect(() => assertChroma(new Array(11).fill(0))).toThrow(RangeError);
    expect(() => assertChroma([Number.NaN, ...new Array(11).fill(0)])).toThrow(
      RangeError,
    );
  });
});
