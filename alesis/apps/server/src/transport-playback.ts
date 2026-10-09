import type { AudioOutput } from "@alesis/audio";
import type { MidiEvent, SimulatedHostEngine } from "@alesis/engine";
import type { EngineSnapshot } from "@alesis/protocol";
import { MidiArpeggiator, rateBeats } from "./arpeggiator.js";
import { DrumPlaybackScheduler } from "./drum-playback.js";
import type { MidiLoopScheduler } from "./loop-playback.js";
import { beatAt, beatDeadline, countInOpeningAllowanceMs, countInOpeningBeat, monotonicClock, transportBeatAnchor, type MonotonicClock, type TransportBeatAnchor } from "./transport-clock.js";

const epsilon = 1e-9;

/** Production subscription/clock owner shared by drums, arpeggios and capture delivery. */
export class TransportPlayback {
  private readonly arpeggiator: MidiArpeggiator;
  private readonly drums: DrumPlaybackScheduler;
  private readonly unsubscribe: () => void;
  private snapshot: EngineSnapshot | null = null;
  private anchor: TransportBeatAnchor | null = null;
  private lastTime: number;
  private idleTime: number;
  private nextStep = 0;
  private lastBeat: number | null = null;
  private standaloneDeadline = Infinity;
  private gateDeadline = Infinity;
  private gateEndsAtCycleBoundary = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private processing = false;
  private transactionDepth = 0;
  private pendingSnapshot: EngineSnapshot | null = null;
  private suspended = false;
  private panicked = false;
  private disposed = false;

  constructor(
    private readonly engine: Pick<SimulatedHostEngine, "snapshot" | "subscribe" | "advance">,
    audio: Pick<AudioOutput, "playDrum">,
    private readonly dispatch: (event: MidiEvent, endsAtCycleBoundary?: boolean) => void,
    private readonly clock: MonotonicClock = monotonicClock,
    private readonly loops?: MidiLoopScheduler,
  ) {
    this.lastTime = this.idleTime = clock.now();
    this.arpeggiator = new MidiArpeggiator(engine.snapshot().arpeggiator);
    this.drums = new DrumPlaybackScheduler(audio, clock);
    this.unsubscribe = engine.subscribe((snapshot) => this.synchronize(snapshot));
  }

  /** Also called by dispatchArpeggio, so recorded positions represent actual delivery. */
  advance(): number {
    if (this.suspended || this.disposed) return 0;
    const now = this.clock.now();
    const seconds = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (seconds > 0) {
      this.engine.advance(seconds);
      // Synchronous arp subscribers finish recording boundary deliveries first.
      // A reentrant command publication must also finish its recording cleanup.
      if (!this.processing) this.loops?.update(this.engine.snapshot());
      this.synchronize(this.engine.snapshot());
    }
    return seconds;
  }

  /** Receives PerformanceRouter output, never raw keyboard controls. */
  handle(event: MidiEvent): void {
    if (this.suspended || this.disposed) return;
    this.advanceIdle();
    const hadNotes = this.arpeggiator.hasHeldNotes;
    for (const output of this.arpeggiator.handle(event)) this.dispatch(output);
    if (!hadNotes && this.arpeggiator.hasHeldNotes) {
      if (this.snapshot?.transport.state === "stopped") this.standaloneDeadline = this.clock.now();
      else if (this.anchor) this.nextStep = this.firstStepAt(beatAt(this.anchor, this.clock.now()));
    }
    this.synchronize(this.engine.snapshot());
  }

  /** Defer subscription playback until command cleanup completes, retaining the held chord. */
  async transaction<T>(action: () => Promise<T>): Promise<T> {
    this.transactionDepth += 1;
    if (this.transactionDepth === 1) {
      this.cancelTimer();
      this.drums.pause();
    }
    try {
      return await action();
    } finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0) {
        this.pendingSnapshot = null;
        this.synchronize(this.engine.snapshot());
      }
    }
  }

  panic(): void {
    this.panicked = true;
    this.cancelTimer();
    this.drums.reset();
    this.gateDeadline = Infinity;
    for (const event of this.arpeggiator.panic()) this.dispatch(event);
  }

  suspend(): void {
    this.suspended = true;
    this.panic();
  }

  resume(): void {
    if (this.disposed) return;
    this.lastTime = this.idleTime = this.clock.now();
    this.snapshot = null;
    this.suspended = this.panicked = false;
    this.synchronize(this.engine.snapshot());
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.panic();
    this.drums.dispose();
  }

  private synchronize(snapshot: EngineSnapshot): void {
    if (this.disposed) return;
    if (this.transactionDepth > 0) {
      this.pendingSnapshot = snapshot;
      return;
    }
    // Recording a delivered event advances/publishes the engine synchronously.
    // Finish consuming this deadline before reconciling that publication.
    if (this.processing) {
      this.pendingSnapshot = snapshot;
      if (snapshot.transport.state !== this.snapshot?.transport.state) {
        this.cancelTimer();
        this.drums.reset();
      }
      return;
    }
    this.processing = true;
    try {
      this.update(snapshot);
    } finally {
      this.processing = false;
      const pending = this.pendingSnapshot;
      this.pendingSnapshot = null;
      if (pending) this.synchronize(pending);
    }
  }

  private update(snapshot: EngineSnapshot): void {
    const now = this.clock.now();
    const previous = this.snapshot;
    const transport = snapshot.transport;
    const starting = previous?.transport.state === "stopped" && transport.state !== "stopped";
    const rewound = previous?.transport.state === "playing" && transport.state === "playing"
      && transport.cycle + transport.progress < previous.transport.cycle + previous.transport.progress - epsilon;
    const epoch = !previous || previous.transport.state !== transport.state || rewound;
    const timingChanged = previous?.settings.bpm !== snapshot.settings.bpm
      || previous.settings.beatsPerMeasure !== snapshot.settings.beatsPerMeasure
      || previous.settings.loopMeasures !== snapshot.settings.loopMeasures;
    const arpChanged = JSON.stringify(previous?.arpeggiator) !== JSON.stringify(snapshot.arpeggiator);
    if (starting || rewound) this.lastTime = now;
    this.snapshot = snapshot;
    this.anchor = transportBeatAnchor(snapshot, this.lastTime);
    const opening = countInOpeningBeat(snapshot, this.anchor, now, previous?.transport.state === "counting-in" ? previous.transport.cycle : null);
    this.advanceIdle();
    this.cancelTimer();
    if (transport.state === "stopped") this.panicked = false;
    if (this.suspended || this.panicked) {
      this.drums.reset();
      return;
    }
    const generation = this.generation;
    if (epoch || timingChanged || arpChanged) {
      this.gateDeadline = Infinity;
      this.emit(epoch ? this.arpeggiator.flush() : this.arpeggiator.releaseStep(), generation);
      this.emit(this.arpeggiator.configure(snapshot.arpeggiator), generation);
      if (epoch) this.lastBeat = null;
      else if (previous && this.lastBeat !== null) {
        this.lastBeat *= snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures
          / (previous.settings.beatsPerMeasure * previous.settings.loopMeasures);
      }
      this.nextStep = this.firstStepAt(opening ?? beatAt(this.anchor, now) - 1 / this.anchor.beatMs);
      this.standaloneDeadline = now;
    }
    if (generation !== this.generation) return;
    // Both consumers receive the very same anchor, including off-cadence publications.
    this.drums.update(snapshot, this.lastTime, this.anchor);
    if (generation !== this.generation) return;
    if (transport.state === "counting-in") {
      // Wake the authoritative engine at the boundary instead of waiting for its 50ms poll.
      this.arm(this.lastTime + (1 - transport.progress) * snapshot.settings.beatsPerMeasure * this.anchor.beatMs);
      return;
    }
    this.pump(now, generation, opening !== null ? countInOpeningAllowanceMs : undefined);
  }

  private pump(now: number, generation: number, latenessLimitMs?: number): void {
    const snapshot = this.snapshot!;
    if (!snapshot.arpeggiator.enabled) {
      this.arm(Infinity);
      return;
    }
    if (this.gateDeadline <= now + epsilon) {
      this.gateDeadline = Infinity;
      this.emit(this.arpeggiator.releaseStep(), generation, this.gateEndsAtCycleBoundary);
    }
    if (generation !== this.generation) return;
    const playing = snapshot.transport.state === "playing";
    let deadline = playing ? beatDeadline(this.anchor!, this.stepBeat(this.nextStep)) : this.standaloneDeadline;
    if (this.arpeggiator.hasHeldNotes && now - deadline > (latenessLimitMs ?? Math.min(20, this.anchor!.beatMs / 16))) {
      this.gateDeadline = Infinity;
      this.emit(this.arpeggiator.flush(), generation);
      if (playing) this.nextStep = this.firstStepAt(beatAt(this.anchor!, now));
      else this.standaloneDeadline = now + this.arpeggiator.stepDuration(snapshot.settings.bpm) * 1000;
      deadline = playing ? beatDeadline(this.anchor!, this.stepBeat(this.nextStep)) : this.standaloneDeadline;
    }
    if (generation !== this.generation) return;
    if (this.arpeggiator.hasHeldNotes && deadline <= now + epsilon) {
      const beat = this.stepBeat(this.nextStep);
      const intervalMs = playing
        ? (this.stepBeat(this.nextStep + 1) - beat) * this.anchor!.beatMs
        : this.arpeggiator.stepDuration(snapshot.settings.bpm) * 1000;
      this.lastBeat = playing ? beat : null;
      this.nextStep += 1;
      this.standaloneDeadline = deadline + intervalMs;
      this.gateDeadline = deadline + intervalMs * snapshot.arpeggiator.gate;
      const gateEndCycle = (beat + intervalMs / this.anchor!.beatMs * snapshot.arpeggiator.gate)
        / (snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures);
      // Preserve scheduled seam ownership even when the timer delivers late.
      this.gateEndsAtCycleBoundary = playing && Math.abs(gateEndCycle - Math.round(gateEndCycle)) < epsilon;
      this.emit(this.arpeggiator.stepNow(intervalMs / 1000), generation);
    }
    if (generation !== this.generation) return;
    const next = !this.arpeggiator.hasHeldNotes ? Infinity
      : playing ? beatDeadline(this.anchor!, this.stepBeat(this.nextStep)) : this.standaloneDeadline;
    this.arm(Math.min(next, this.gateDeadline));
  }

  private stepBeat(step: number): number {
    const config = this.snapshot!.arpeggiator;
    return rateBeats[config.rate] * (step + (step % 2 === 1 ? config.swing : 0));
  }

  private firstStepAt(beat: number): number {
    const rate = rateBeats[this.snapshot!.arpeggiator.rate];
    let step = Math.max(0, Math.floor(beat / (2 * rate)) * 2);
    while (this.stepBeat(step) < beat - epsilon
      || this.lastBeat !== null && this.stepBeat(step) <= this.lastBeat + epsilon) step += 1;
    return step;
  }

  private advanceIdle(): void {
    const now = this.clock.now();
    this.arpeggiator.advanceIdle(Math.max(0, now - this.idleTime) / 1000);
    this.idleTime = now;
  }

  private emit(events: MidiEvent[], generation: number, endsAtCycleBoundary = false): void {
    for (const event of events) {
      if (generation !== this.generation || this.disposed || this.suspended) return;
      this.dispatch(event, endsAtCycleBoundary);
    }
  }

  private arm(deadline: number): void {
    if (this.loops && this.snapshot) {
      const snapshot = this.snapshot;
      const cycleMs = 60_000 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
      const position = this.loops.nextPlaybackPosition(snapshot);
      deadline = Math.min(deadline, this.lastTime + (position - snapshot.transport.progress) * cycleMs);
    }
    if (!Number.isFinite(deadline)) return;
    const generation = this.generation;
    this.timer = this.clock.setTimeout(() => {
      if (generation !== this.generation || this.disposed || this.suspended) return;
      this.timer = undefined;
      if (this.advance() === 0) this.synchronize(this.engine.snapshot());
    }, Math.max(1, Math.ceil(deadline - this.clock.now())));
  }

  private cancelTimer(): void {
    this.generation += 1;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
