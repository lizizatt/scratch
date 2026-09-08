import { describe, expect, it } from "vitest";
import { applyVelocityCurve, PerformanceRouter } from "./performance-router.js";

describe("PerformanceRouter", () => {
  it("maps measured Vortex note velocities through selectable host curves", () => {
    const note = { type: "note-on", channel: 0, note: 60, velocity: 20 } as const;

    expect(applyVelocityCurve(note, "linear")).toEqual(note);
    expect(applyVelocityCurve(note, "responsive")).toMatchObject({ velocity: 27 });
    expect(applyVelocityCurve(note, "strong")).toMatchObject({ velocity: 40 });
    expect(applyVelocityCurve(note, "fixed")).toMatchObject({ velocity: 127 });
    expect(applyVelocityCurve({ ...note, velocity: 38 }, "strong")).toMatchObject({ velocity: 67 });
    expect(applyVelocityCurve({ ...note, velocity: 72 }, "strong")).toMatchObject({ velocity: 118 });
    expect(applyVelocityCurve({ ...note, velocity: 100 }, "strong")).toMatchObject({ velocity: 127 });
  });

  it("does not curve note releases or non-note expression", () => {
    expect(applyVelocityCurve({ type: "note-on", channel: 0, note: 60, velocity: 0 }, "strong")).toEqual({ type: "note-on", channel: 0, note: 60, velocity: 0 });
    expect(applyVelocityCurve({ type: "note-off", channel: 0, note: 60 }, "strong")).toEqual({ type: "note-off", channel: 0, note: 60 });
    expect(applyVelocityCurve({ type: "channel-pressure", channel: 0, value: 20 }, "strong")).toEqual({ type: "channel-pressure", channel: 0, value: 20 });
  });

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

  it("forgets held-note routing on lifecycle panic", () => {
    const router = new PerformanceRouter();
    router.route({ type: "note-on", channel: 3, note: 67, velocity: 100 });

    router.panic();

    expect(router.route({ type: "pitch-bend", channel: 0, value: 0 })).toEqual([
      { type: "pitch-bend", channel: 0, value: 0 },
    ]);
  });
});
