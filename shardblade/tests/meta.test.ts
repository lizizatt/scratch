import { describe, expect, it } from "vitest";
import { AVAILABLE_CLASSES, isClassAvailable } from "../src/sim/meta";

describe("class availability", () => {
  it("both greatsword and spear are always available", () => {
    expect(AVAILABLE_CLASSES).toEqual(["greatsword", "spear"]);
    expect(isClassAvailable("greatsword")).toBe(true);
    expect(isClassAvailable("spear")).toBe(true);
  });
});
