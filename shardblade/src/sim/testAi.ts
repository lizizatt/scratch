import type { Style } from "./types";

/** Combat-test AI presets (decision at start of each swing cycle). */
export type TestAiKind =
  | "alwaysFast"
  | "alwaysHeavy"
  | "alternate"
  | "mirror"
  | "oppose";

export type TestAiOption = {
  kind: TestAiKind;
  label: string;
};

export const TEST_AI_OPTIONS: TestAiOption[] = [
  { kind: "alwaysFast", label: "Always Fast" },
  { kind: "alwaysHeavy", label: "Always Heavy" },
  { kind: "alternate", label: "Alternate" },
  { kind: "mirror", label: "Mirror" },
  { kind: "oppose", label: "Oppose" },
];

/**
 * Picks the enemy style at the beginning of each of its swing cycles.
 */
export class SwingCycleBrain {
  kind: TestAiKind;
  private alternateNext: Style = "fast";

  constructor(kind: TestAiKind = "alwaysFast") {
    this.kind = kind;
  }

  setKind(kind: TestAiKind): void {
    this.kind = kind;
    this.alternateNext = "fast";
  }

  /** Called once when a new enemy swing starts. */
  decide(playerStyle: Style): Style {
    switch (this.kind) {
      case "alwaysFast":
        return "fast";
      case "alwaysHeavy":
        return "heavy";
      case "alternate": {
        const next = this.alternateNext;
        this.alternateNext = next === "fast" ? "heavy" : "fast";
        return next;
      }
      case "mirror":
        return playerStyle;
      case "oppose":
        return playerStyle === "fast" ? "heavy" : "fast";
    }
  }
}
