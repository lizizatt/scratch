import { describe, expect, it } from "vitest";
import { layoutCombat } from "../src/render/layout";
import { hitTestStyle } from "../src/render/hitTest";

describe("layoutCombat", () => {
  it("style hit-tests match drawn button positions including slope offset", () => {
    const layout = layoutCombat(960, 540, { stormLevel: 3 });
    const flatEntityY = 540 * 0.72 - 70;
    expect(layout.entityY).toBeLessThan(flatEntityY);

    const fast = layout.styleButtons.find((b) => b.style === "fast")!;
    const heavy = layout.styleButtons.find((b) => b.style === "heavy")!;
    const defend = layout.styleButtons.find((b) => b.style === "defend")!;
    expect(hitTestStyle(fast.rect.x + 4, fast.rect.y + 4, layout.styleButtons)).toBe("fast");
    expect(hitTestStyle(heavy.rect.x + 4, heavy.rect.y + 4, layout.styleButtons)).toBe("heavy");
    expect(hitTestStyle(defend.rect.x + 4, defend.rect.y + 4, layout.styleButtons)).toBe("defend");
    expect(defend.rect.y).toBeGreaterThan(fast.rect.y);
  });
});
