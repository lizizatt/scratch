import { describe, expect, it } from "vitest";
import { hitTestStyle, playerStyleButtons } from "../src/render/hitTest";

describe("style hit-test", () => {
  it("maps clicks on fast/heavy/defend buttons to SetStyle intents", () => {
    const buttons = playerStyleButtons(200, 300);
    const fast = buttons.find((b) => b.style === "fast")!;
    const heavy = buttons.find((b) => b.style === "heavy")!;
    const defend = buttons.find((b) => b.style === "defend")!;

    expect(defend.rect.y).toBeLessThan(fast.rect.y);
    expect(defend.rect.h).toBe(Math.round(28 * (2 / 3)));
    expect(fast.rect.h).toBe(defend.rect.h);

    expect(
      hitTestStyle(fast.rect.x + 2, fast.rect.y + 2, buttons),
    ).toBe("fast");
    expect(
      hitTestStyle(heavy.rect.x + 2, heavy.rect.y + 2, buttons),
    ).toBe("heavy");
    expect(
      hitTestStyle(defend.rect.x + 2, defend.rect.y + 2, buttons),
    ).toBe("defend");
    expect(hitTestStyle(0, 0, buttons)).toBeNull();
  });
});
