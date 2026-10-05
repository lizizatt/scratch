import type { AudioOutput } from "@alesis/audio";
import type { EngineSnapshot } from "@alesis/protocol";
import { drumPatternAtStep } from "./drum-patterns.js";
import { beatAt, beatDeadline, countInOpeningAllowanceMs, countInOpeningBeat, monotonicClock, transportBeatAnchor, type MonotonicClock, type TransportBeatAnchor } from "./transport-clock.js";

export type DrumPlaybackClock = MonotonicClock;
const gridEpsilon = 1e-9;

interface Anchor {
  grid: TransportBeatAnchor;
  pattern: Pick<EngineSnapshot, "settings" | "drums">;
  playing: boolean;
  countingIn: boolean;
  cycle: number;
  position: number;
  time: number;
  steps: number;
  stepMs: number;
  configuration: string;
}

/** Projects only drum deadlines; the engine remains the transport/capture authority. */
export class DrumPlaybackScheduler {
  private anchor: Anchor | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private nextStep = 0;
  private lastStep: number | null = null;
  private disposed = false;

  constructor(
    private readonly audio: Pick<AudioOutput, "playDrum">,
    private readonly clock: DrumPlaybackClock = monotonicClock,
  ) {}

  /** snapshotTime is the monotonic time represented by transport.progress, not its publication time. */
  update(snapshot: EngineSnapshot, snapshotTime?: number, grid?: TransportBeatAnchor): void {
    if (this.disposed) return;
    const now = this.clock.now();
    const previous = this.anchor;
    const position = snapshot.transport.cycle + snapshot.transport.progress;
    const playing = snapshot.transport.state === "playing";
    const steps = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures * 4;
    const stepMs = 15_000 / snapshot.settings.bpm;
    const configuration = JSON.stringify([
      snapshot.settings.bpm, steps, snapshot.settings.beatsPerMeasure,
      snapshot.drums.enabled, snapshot.drums.pattern, snapshot.drums.volume,
      snapshot.pads.selectedDrumKitId, snapshot.synth.selectedId,
      snapshot.synth.selectedSoundFontId, snapshot.synth.selectedSoundFontPresetId,
      snapshot.settings.audioOutputId,
    ]);
    const restart = !previous || !previous.playing || position < previous.position - gridEpsilon;
    const changed = configuration !== previous?.configuration;
    // MIDI, meters and control commands can publish the same transport position repeatedly.
    const time = snapshotTime ?? (previous && !restart && position === previous.position
      ? previous.time : now);
    this.cancelTimer();
    this.anchor = {
      grid: grid ?? transportBeatAnchor(snapshot, time),
      pattern: { settings: { ...snapshot.settings }, drums: { ...snapshot.drums } },
      playing, countingIn: snapshot.transport.state === "counting-in", cycle: snapshot.transport.cycle, position, time, steps, stepMs, configuration,
    };
    if (restart || !playing) this.lastStep = null;
    else if (previous.steps !== steps && this.lastStep !== null) {
      this.lastStep = Math.floor(this.lastStep / previous.steps * steps + gridEpsilon);
    }
    if (!playing || !snapshot.drums.enabled || snapshot.drums.volume <= 0) return;

    const current = this.project(now);
    // Publishing an engine boundary can itself take a fraction of a millisecond.
    if (restart || changed) this.nextStep = Math.max(this.lastStep === null ? 0 : this.lastStep + 1, Math.ceil(current - 1 / stepMs));
    const opening = countInOpeningBeat(snapshot, this.anchor.grid, now, previous?.countingIn ? previous.cycle : null);
    if (opening !== null) {
      this.nextStep = opening * 4;
      this.schedule(now, countInOpeningAllowanceMs);
      return;
    }
    this.schedule(now);
  }

  /** Cancel delivery during command side effects without forgetting consumed beats. */
  pause(): void {
    this.cancelTimer();
  }

  reset(): void {
    this.cancelTimer();
    this.anchor = null;
    this.lastStep = null;
    this.nextStep = 0;
  }

  dispose(): void {
    this.reset();
    this.disposed = true;
  }

  private project(now: number): number {
    return beatAt(this.anchor!.grid, now) * 4;
  }

  private schedule(now: number, latenessLimitMs?: number): void {
    const anchor = this.anchor!;
    const current = this.project(now);
    // Never catch up a backlog. Allow ordinary timer jitter, but not offbeat stall recovery.
    const staleMs = latenessLimitMs ?? Math.min(20, anchor.stepMs / 4);
    if ((current - this.nextStep) * anchor.stepMs > staleMs) {
      this.nextStep = Math.max(this.nextStep, Math.ceil(current - gridEpsilon));
    }
    const deadline = beatDeadline(anchor.grid, this.nextStep / 4);
    const generation = this.generation;
    if (deadline - now <= gridEpsilon) {
      const step = this.nextStep;
      this.lastStep = step;
      this.nextStep += 1;
      for (const hit of drumPatternAtStep(anchor.pattern, step % anchor.steps)) {
        if (generation !== this.generation || this.disposed) return;
        this.audio.playDrum(hit.note, hit.velocity);
      }
      if (generation !== this.generation || this.disposed) return;
    }
    const nextDeadline = beatDeadline(anchor.grid, this.nextStep / 4);
    // Node truncates fractional delays. Ceil plus a deadline recheck avoids early-spin loops.
    this.timer = this.clock.setTimeout(() => {
      if (generation !== this.generation || this.disposed) return;
      this.timer = undefined;
      this.schedule(this.clock.now());
    }, Math.max(1, Math.ceil(nextDeadline - this.clock.now())));
  }

  private cancelTimer(): void {
    this.generation += 1;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
