import { describe, expect, it } from "vitest";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import { SilentAudioOutput } from "@alesis/audio";
import type { DrumPlaybackClock } from "./drum-playback.js";
import { MetronomeScheduler } from "./metronome.js";
import { PerformanceRouter } from "./performance-router.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import { TransportPlayback } from "./transport-playback.js";

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

const tolerance = 2; // ms; timers are rounded up to whole milliseconds

async function harness(bpm: number, settings: { countIn?: boolean; loopMeasures?: number; arp?: boolean } = {}) {
  const clock = new Clock();
  const engine = new SimulatedHostEngine();
  await engine.execute({ type: "configure", settings: { bpm, countInEnabled: settings.countIn ?? false, loopMeasures: settings.loopMeasures ?? 1, metronomeEnabled: true, metronomeVolume: 0.5 } });
  await engine.execute({ type: "configure-arpeggiator", settings: { enabled: settings.arp ?? false, mode: "up", rate: "1/4", gate: 0.5, swing: 0 } });
  const clicks: Array<{ at: number; accent: boolean }> = [];
  const arpOns: number[] = [];
  const metronome = new MetronomeScheduler({ playMetronome: (accent: boolean) => { clicks.push({ at: clock.now(), accent }); } } as never);
  const router = new PerformanceRouter();
  const loops = new MidiLoopScheduler(new SilentAudioOutput());
  const playback: TransportPlayback = new TransportPlayback(engine, { playDrum: () => {} }, (event: MidiEvent) => {
    playback.advance();
    if (event.type === "note-on" && engine.snapshot().transport.state === "playing") arpOns.push(clock.now());
  }, clock, loops, metronome);
  // Production cadence (main.ts): a 50 ms poll advances the transport then evaluates the metronome.
  // Polls sit on absolute 50 ms ticks, independent of when Play is pressed.
  const run = (ms: number) => {
    const end = clock.now() + ms;
    while (clock.now() < end) {
      const nextPoll = (Math.floor(clock.now() / 50) + 1) * 50;
      clock.advance(Math.min(nextPoll, end) - clock.now());
      if (clock.now() % 50 !== 0) continue;
      playback.advance();
      loops.update(engine.snapshot());
      metronome.update(engine.runtimeSnapshot());
    }
  };
  const state = { playedAt: 0 };
  /** Press Play 17 ms after a poll, so beats never coincide with a poll. */
  const play = async () => {
    run(17);
    state.playedAt = clock.now();
    await engine.execute({ type: "play" });
  };
  const press = (note = 60) => {
    playback.advance();
    const event: MidiEvent = { type: "note-on", channel: 1, note, velocity: 100 };
    engine.dispatchMidi(event);
    for (const routed of router.route(event)) playback.handle(routed);
  };
  return { engine, clock, playback, metronome, clicks, arpOns, run, press, play, state };
}

describe.each([60, 120, 240])("metronome clicks at %i BPM", (bpm) => {
  const beatMs = 60_000 / bpm;

  it("lands every click on the beat grid and accents each measure start", async () => {
    const h = await harness(bpm);
    await h.play();
    h.run(3.2 * 4 * beatMs);

    expect(h.clicks.length).toBeGreaterThanOrEqual(12);
    h.clicks.forEach(({ at, accent }, index) => {
      expect(Math.abs(at - h.state.playedAt - index * beatMs), `click ${index} at ${at.toFixed(1)}ms`).toBeLessThanOrEqual(tolerance);
      expect(accent, `accent ${index}`).toBe(index % 4 === 0);
    });
    h.playback.dispose();
  });

  it("clicks together with a quarter-note arpeggio, not behind it", async () => {
    const h = await harness(bpm, { arp: true });
    h.press(60);
    await h.play();
    h.run(3.2 * 4 * beatMs);
    const n = Math.min(h.clicks.length, h.arpOns.length);

    expect(n).toBeGreaterThanOrEqual(12);
    for (let k = 0; k < n; k += 1) {
      expect(Math.abs(h.clicks[k]!.at - h.arpOns[k]!), `beat ${k}: click ${h.clicks[k]!.at.toFixed(1)} vs arp ${h.arpOns[k]!.toFixed(1)}`).toBeLessThanOrEqual(tolerance);
    }
    h.playback.dispose();
  });

  it("clicks each count-in beat and the first loop beat exactly once", async () => {
    const h = await harness(bpm, { countIn: true });
    await h.play();
    h.run(2.2 * 4 * beatMs);

    expect(h.clicks.length).toBeGreaterThanOrEqual(8);
    h.clicks.forEach(({ at, accent }, index) => {
      expect(Math.abs(at - h.state.playedAt - index * beatMs), `click ${index} at ${at.toFixed(1)}ms`).toBeLessThanOrEqual(tolerance);
      expect(accent, `accent ${index}`).toBe(index % 4 === 0);
    });
    h.playback.dispose();
  });

  it("follows loop length: only the measure starts are accented across a two-measure loop", async () => {
    const h = await harness(bpm, { loopMeasures: 2 });
    await h.play();
    h.run(2.2 * 8 * beatMs);

    expect(h.clicks.length).toBeGreaterThanOrEqual(16);
    h.clicks.forEach(({ at, accent }, index) => {
      expect(Math.abs(at - h.state.playedAt - index * beatMs)).toBeLessThanOrEqual(tolerance);
      expect(accent).toBe(index % 4 === 0);
    });
    h.playback.dispose();
  });

  it("does not click after Stop, even when Stop lands just before a beat and between polls", async () => {
    const h = await harness(bpm);
    await h.play();
    h.run(1.5 * beatMs);
    const before = h.clicks.length;
    h.clock.advance(0.45 * beatMs); // lands shortly before beat 2, between 50 ms polls
    await h.engine.execute({ type: "stop" });
    h.run(3 * beatMs);

    expect(h.clicks.length).toBe(before);
    h.playback.dispose();
  });

  it("stays silent while disabled and resumes on the next beat only", async () => {
    const h = await harness(bpm);
    await h.engine.execute({ type: "configure", settings: { metronomeEnabled: false } });
    await h.play();
    h.run(1.3 * beatMs);
    expect(h.clicks).toEqual([]);

    const enabledAt = h.clock.now();
    await h.engine.execute({ type: "configure", settings: { metronomeEnabled: true } });
    h.run(2 * beatMs);

    expect(h.clicks.length).toBeGreaterThanOrEqual(1);
    expect(h.clicks[0]!.at).toBeGreaterThan(enabledAt);
    expect(Math.abs(h.clicks[0]!.at - h.state.playedAt - 2 * beatMs)).toBeLessThanOrEqual(tolerance);
    h.playback.dispose();
  });
});

describe("metronome follows a mid-play tempo change", () => {
  it.each([[60, 240], [240, 60]])("re-grids from %i to %i BPM without a double or skipped click", async (from, to) => {
    const h = await harness(from);
    await h.play();
    h.run(4 * 60_000 / from);
    await h.engine.execute({ type: "configure", settings: { bpm: to }, clearAudio: true });
    const before = h.clicks.length;
    h.run(3 * 4 * 60_000 / to);
    const after = h.clicks.slice(before);
    const beatMs = 60_000 / to;

    expect(after.length).toBeGreaterThanOrEqual(10);
    after.slice(1).forEach(({ at }, index) => {
      expect(Math.abs(at - after[index]!.at - beatMs), `interval ${index}`).toBeLessThanOrEqual(tolerance * 2);
    });
    h.playback.dispose();
  });
});
