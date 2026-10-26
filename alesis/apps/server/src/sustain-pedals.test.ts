import { describe, expect, it } from "vitest";
import { PerformanceRouter } from "./performance-router.js";
import { SustainPedals } from "./sustain-pedals.js";

const pedal = (value: number, channel = 1) => ({ type: "control-change" as const, channel, controller: 64, value });

describe("two sustain pedals", () => {
  it("passes the keytar's pedal through untouched while the foot switch is up", () => {
    const pedals = new SustainPedals();
    for (const value of [127, 127, 90, 0, 0]) expect(pedals.primary(pedal(value))).toEqual(pedal(value));
  });

  it("sustains while the foot switch is down, on the keytar pedal's channel", () => {
    const pedals = new SustainPedals();
    pedals.primary(pedal(0, 3));
    expect(pedals.secondary(true)).toEqual(pedal(127, 3));
    expect(pedals.secondary(true)).toBeNull();
    expect(pedals.secondary(false)).toEqual(pedal(0, 3));
    expect(pedals.secondary(false)).toBeNull();
  });

  it("keeps sustaining until both pedals are up, in either order", () => {
    const pedals = new SustainPedals();
    expect(pedals.secondary(true)).toEqual(pedal(127, 0));
    expect(pedals.primary(pedal(127))).toBeNull();
    expect(pedals.primary(pedal(0))).toBeNull();
    expect(pedals.secondary(false)).toEqual(pedal(0, 1));

    expect(pedals.primary(pedal(127))).toEqual(pedal(127));
    expect(pedals.secondary(true)).toBeNull();
    expect(pedals.secondary(false)).toBeNull();
    expect(pedals.primary(pedal(0))).toEqual(pedal(0));
  });

  it("returns to the keytar pedal's partial depth when the foot switch lifts", () => {
    const pedals = new SustainPedals();
    pedals.primary(pedal(80));
    expect(pedals.secondary(true)).toEqual(pedal(127));
    expect(pedals.secondary(false)).toEqual(pedal(80));
  });

  it("forgets sent sustain after a panic so the next press sustains again", () => {
    const pedals = new SustainPedals();
    pedals.secondary(true);
    pedals.reset();
    expect(pedals.secondary(false)).toBeNull();
    expect(pedals.secondary(true)).toEqual(pedal(127, 0));
  });

  it("reaches the notes being held when routed like a real pedal", () => {
    const pedals = new SustainPedals();
    const router = new PerformanceRouter();
    router.route({ type: "note-on", channel: 2, note: 60, velocity: 90 });
    expect(router.route(pedals.secondary(true)!)).toEqual([pedal(127, 2)]);
    router.route({ type: "note-off", channel: 2, note: 60 });
    expect(router.route(pedals.secondary(false)!)).toEqual([pedal(0, 2)]);
  });
});
