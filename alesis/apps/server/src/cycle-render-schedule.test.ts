import { expect, it } from "vitest";
import { cycleRenderEvents, cycleRenderSchedule, cycleWarmupCount } from "./cycle-render-schedule.js";

it("bounds effect warm-up independently of the extracted cycle duration", () => {
  expect(cycleWarmupCount(0.125)).toBe(16);
  expect(cycleWarmupCount(0.5)).toBe(8);
  expect(cycleWarmupCount(2)).toBe(2);
  expect(cycleWarmupCount(960)).toBe(2);
  const plan = cycleRenderSchedule([
    { position: 0.25, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
    { position: 1, event: { type: "note-off", channel: 0, note: 60 } },
  ], 0, 1, 60 / 118 * 4);
  const events = [...cycleRenderEvents(plan)];
  const attacks = events.filter(({ event }) => event.type === "note-on");
  expect(attacks.map(({ frame }) => frame)).toEqual([0, 1, 2].map((pass) => pass * plan.frames + Math.round(plan.frames / 4)));
  expect(events.at(-1)!.frame).toBe(3 * plan.frames);
});

it("retains equal-time physical release/pedal chronology, then resets before the next opening", () => {
  const plan = cycleRenderSchedule([
    { position: 0, event: { type: "note-on", channel: 0, note: 64, velocity: 100 } },
    { position: 0.5, event: { type: "note-off", channel: 0, note: 64 } },
    { position: 0.5, event: { type: "control-change", channel: 0, controller: 64, value: 127 } },
    { position: 0.75, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
    { position: 0.9, event: { type: "pitch-bend", channel: 0, value: 0.25 } },
    { position: 1, event: { type: "note-off", channel: 0, note: 60 } },
  ], 0, 1, 2);
  expect(plan.events.filter(({ position }) => position === 0.5).map(({ event }) => event.type)).toEqual(["note-off", "control-change"]);
  expect([...cycleRenderEvents(plan)].filter(({ frame }) => frame === plan.frames).map(({ event }) => event)).toEqual([
    { type: "note-off", channel: 1, note: 60 },
    { type: "pitch-bend", channel: 1, value: 0 },
    { type: "control-change", channel: 1, controller: 64, value: 0 },
    { type: "note-on", channel: 1, note: 64, velocity: 100 },
  ]);
});
