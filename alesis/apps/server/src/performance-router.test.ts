import { describe, expect, it } from "vitest";
import { PerformanceRouter } from "./performance-router.js";

describe("PerformanceRouter", () => {
  it("routes a global pitch wheel onto the held note channel", () => {
    const router = new PerformanceRouter();
    router.route({ type: "note-on", channel: 1, note: 67, velocity: 103 });

    expect(router.route({ type: "pitch-bend", channel: 0, value: 1 })).toEqual([
      { type: "pitch-bend", channel: 1, value: 1 },
    ]);
  });

  it("fans pitch bend across held note channels without duplicate events", () => {
    const router = new PerformanceRouter();
    router.route({ type: "note-on", channel: 1, note: 60, velocity: 100 });
    router.route({ type: "note-on", channel: 1, note: 64, velocity: 100 });
    router.route({ type: "note-on", channel: 2, note: 67, velocity: 100 });

    expect(router.route({ type: "pitch-bend", channel: 0, value: -0.5 })).toEqual([
      { type: "pitch-bend", channel: 1, value: -0.5 },
      { type: "pitch-bend", channel: 2, value: -0.5 },
    ]);
  });

  it("keeps release-to-center on the most recent note channel", () => {
    const router = new PerformanceRouter();
    router.route({ type: "note-on", channel: 1, note: 67, velocity: 100 });
    router.route({ type: "note-off", channel: 1, note: 67 });

    expect(router.route({ type: "pitch-bend", channel: 0, value: 0 })).toEqual([
      { type: "pitch-bend", channel: 1, value: 0 },
    ]);
  });
});
