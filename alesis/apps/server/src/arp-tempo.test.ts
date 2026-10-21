import { describe, expect, it } from "vitest";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import { SilentAudioOutput } from "@alesis/audio";
import type { ArpeggiatorConfig, ArpeggiatorRate } from "./arpeggiator.js";
import type { DrumPlaybackClock } from "./drum-playback.js";
import { TransportPlayback } from "./transport-playback.js";
import { PerformanceRouter } from "./performance-router.js";
import { MidiLoopScheduler } from "./loop-playback.js";

type Timer = ReturnType<typeof setTimeout>;
class Clock implements DrumPlaybackClock {
  time = 0;
  private id = 0;
  private pending = new Map<Timer, { at: number; callback: () => void }>();
  now = () => this.time;
  setTimeout = (callback: () => void, delay: number): Timer => {
    const id = ++this.id as unknown as Timer;
    this.pending.set(id, { at: this.time + Math.max(1, Math.trunc(delay)), callback });
    return id;
  };
  clearTimeout = (id: Timer) => { this.pending.delete(id); };
  advance(ms: number): void {
    const end = this.time + ms;
    for (let guard = 0; guard < 100_000; guard++) {
      const first = [...this.pending].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > end) { this.time = end; return; }
      this.time = Math.max(this.time, first[1].at);
      this.pending.delete(first[0]);
      first[1].callback();
    }
    throw new Error("Timer spin");
  }
}

// Independent of the scheduler: beats per step for each rate, and the odd-step swing shift.
const beatsPerStep: Record<ArpeggiatorRate, number> = { "1/4": 1, "1/8": 1 / 2, "1/16": 1 / 4, "1/8T": 1 / 3, "1/16T": 1 / 6 };
const stepBeat = (rate: ArpeggiatorRate, swing: number, step: number) => beatsPerStep[rate] * (step + (step % 2 === 1 ? swing : 0));

async function harness(bpm: number, arp: Partial<ArpeggiatorConfig>, loopMeasures = 1) {
  const clock = new Clock();
  const engine = new SimulatedHostEngine();
  await engine.execute({ type: "configure", settings: { bpm, countInEnabled: false, loopMeasures } });
  await engine.execute({ type: "configure-drums", settings: { enabled: true, pattern: "four-on-floor" } });
  await engine.execute({ type: "configure-arpeggiator", settings: { enabled: true, mode: "up", gate: 0.5, swing: 0, ...arp } });
  const delivered: Array<{ at: number; event: MidiEvent; playing: boolean }> = [];
  const hats: number[] = [];
  const router = new PerformanceRouter();
  const loops = new MidiLoopScheduler(new SilentAudioOutput());
  const playback: TransportPlayback = new TransportPlayback(engine, {
    playDrum: (note) => { if (note === 42) hats.push(clock.now()); },
  }, (event) => {
    playback.advance();
    engine.markCaptureActivity();
    loops.record(event, engine.snapshot());
    delivered.push({ at: clock.now(), event, playing: engine.snapshot().transport.state === "playing" });
  }, clock);
  const press = (note: number) => {
    playback.advance();
    const event: MidiEvent = { type: "note-on", channel: 1, note, velocity: 100 };
    engine.dispatchMidi(event);
    for (const routed of router.route(event)) playback.handle(routed);
  };
  // Production cadence: a 50 ms engine poll; arp deadlines fire from their own timers.
  const run = (ms: number) => {
    const end = clock.now() + ms;
    while (clock.now() < end) {
      clock.advance(Math.min(50, end - clock.now()));
      playback.advance();
      loops.update(engine.snapshot());
    }
  };
  // A chord held before Play also arpeggiates while stopped; only the playing grid is the loop's beat.
  const ons = () => delivered.filter(({ event, playing }) => playing && event.type === "note-on");
  const offs = () => delivered.filter(({ event, playing }) => playing && event.type === "note-off");
  return { engine, clock, playback, press, run, ons, offs, hats };
}

const tolerance = 2; // ms; the scheduler rounds each timer up to a whole millisecond
const rates: ArpeggiatorRate[] = ["1/4", "1/8", "1/16", "1/8T", "1/16T"];
const chord = [60, 64, 67];

describe.each([60, 240])("arpeggiator against the beat at %i BPM", (bpm) => {
  const beatMs = 60_000 / bpm;

  it.each(rates.flatMap((rate) => [0, 0.5].map((swing) => ({ rate, swing }))))(
    "lands every step, gate release and chord note on the grid across cycle wraps: $rate swing $swing", async ({ rate, swing }) => {
      const h = await harness(bpm, { rate, swing, gate: 0.5 });
      for (const note of chord) h.press(note);
      await h.engine.execute({ type: "play" });
      h.run(3.2 * 4 * beatMs); // 3+ cycles of one 4-beat measure
      const runEnd = h.clock.now();
      const ons = h.ons();
      const offs = h.offs();

      expect(ons.length).toBeGreaterThan(3 * 4 / beatsPerStep[rate] - 2);
      ons.forEach(({ at, event }, index) => {
        const expected = stepBeat(rate, swing, index) * beatMs;
        expect(Math.abs(at - expected), `step ${index} on at ${at.toFixed(1)}ms, expected ${expected.toFixed(1)}ms`).toBeLessThanOrEqual(tolerance);
        expect((event as Extract<MidiEvent, { type: "note-on" }>).note).toBe(chord[index % chord.length]);
        const intervalMs = (stepBeat(rate, swing, index + 1) - stepBeat(rate, swing, index)) * beatMs;
        // The run ends mid-gate for the last step; its release has not been due yet.
        if (at + intervalMs * 0.5 > runEnd - tolerance) return;
        // Strictly later: Play also releases the stopped-mode note at the same instant as step 0.
        const release = offs.find((off) => off.at > at && (off.event as Extract<MidiEvent, { type: "note-off" }>).note === (event as { note: number }).note && off.at <= at + intervalMs);
        expect(release, `step ${index} release`).toBeDefined();
        expect(Math.abs(release!.at - (at + intervalMs * 0.5)), `step ${index} gate`).toBeLessThanOrEqual(tolerance + 1);
      });
      h.playback.dispose();
    });

  it.each(rates)("keeps the same grid when the chord is entered off the beat: %s", async (rate) => {
    const h = await harness(bpm, { rate, swing: 0.25 });
    await h.engine.execute({ type: "play" });
    h.run(0.37 * beatMs);
    h.press(60);
    const pressedAt = h.clock.now();
    h.run(3.2 * 4 * beatMs);
    const ons = h.ons();
    // First step is the next grid point at or after the press, never an early or double-timed one.
    let first = 0;
    while (stepBeat(rate, 0.25, first) * beatMs < pressedAt - tolerance) first += 1;

    expect(ons.length).toBeGreaterThan(3 * 4 / beatsPerStep[rate] - 3);
    ons.forEach(({ at }, index) => {
      const expected = stepBeat(rate, 0.25, first + index) * beatMs;
      expect(Math.abs(at - expected), `step ${first + index} at ${at.toFixed(1)}ms, expected ${expected.toFixed(1)}ms`).toBeLessThanOrEqual(tolerance);
    });
    h.playback.dispose();
  });

  it("stays locked to the drum grid for straight eighth notes over several cycles", async () => {
    const h = await harness(bpm, { rate: "1/8" });
    h.press(60);
    await h.engine.execute({ type: "play" });
    h.run(5.1 * 4 * beatMs);
    const ons = h.ons();

    expect(ons.length).toBeGreaterThan(5 * 8 - 2);
    ons.forEach(({ at }, index) => {
      expect(Math.abs(at - h.hats[index]!), `arp step ${index} vs hat`).toBeLessThanOrEqual(tolerance);
    });
    h.playback.dispose();
  });

  it("does not drift: the last step after ten cycles is as accurate as the first", async () => {
    const h = await harness(bpm, { rate: "1/16T", swing: 0 });
    h.press(60);
    await h.engine.execute({ type: "play" });
    h.run(10.1 * 4 * beatMs);
    const ons = h.ons();
    const lastIndex = ons.length - 1;

    expect(ons.length).toBeGreaterThan(10 * 24 - 2);
    expect(Math.abs(ons[lastIndex]!.at - lastIndex * beatMs / 6)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(ons[0]!.at)).toBeLessThanOrEqual(tolerance);
    h.playback.dispose();
  });
});

describe("arpeggiator follows a mid-play tempo change", () => {
  it.each([[60, 240], [240, 60]])("re-grids from %i to %i BPM without double-timed or skipped steps", async (from, to) => {
    const h = await harness(from, { rate: "1/8" });
    h.press(60);
    await h.engine.execute({ type: "play" });
    h.run(4 * 60_000 / from);
    await h.engine.execute({ type: "configure", settings: { bpm: to }, clearAudio: true });
    const changedAt = h.clock.now();
    const before = h.ons().length;
    h.run(3 * 4 * 60_000 / to);
    const after = h.ons().slice(before);
    const stepMs = 60_000 / to / 2;

    expect(after.length).toBeGreaterThan(3 * 8 - 3);
    after.slice(1).forEach(({ at }, index) => {
      expect(Math.abs(at - after[index]!.at - stepMs), `interval ${index} after the change at ${changedAt.toFixed(0)}ms`).toBeLessThanOrEqual(tolerance * 2);
    });
    h.playback.dispose();
  });
});
