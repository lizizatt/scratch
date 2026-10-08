import type { EngineResult, MidiEvent } from "@alesis/engine";
import { assignedPadAction, type EngineCommand, type EngineSnapshot, type PadAction } from "@alesis/protocol";

type ControlAction = Extract<PadAction, { kind: "control" }>;
type Hold = "sample" | "drum" | "control";

export function padControlCommand(action: ControlAction, snapshot: EngineSnapshot): EngineCommand {
  const current = action.target === "transport" ? snapshot.transport.state !== "stopped"
    : action.target === "drums" ? snapshot.drums.enabled
      : action.target === "metronome" ? snapshot.settings.metronomeEnabled : snapshot.arpeggiator.enabled;
  const enabled = action.operation === "toggle" ? !current : action.operation === "on";
  switch (action.target) {
    case "transport": return { type: enabled ? "play" : "stop" };
    case "drums": return { type: "configure-drums", settings: { enabled } };
    case "metronome": return { type: "configure", settings: { metronomeEnabled: enabled } };
    case "arpeggiator": return { type: "configure-arpeggiator", settings: { enabled } };
  }
}

/** Holds describe the attack, never the current mapping at release time. */
export class PadPerformance {
  private holds = new Map<string, Map<number, Hold>>();
  private generation = 0;

  constructor(private readonly dependencies: {
    snapshot(): EngineSnapshot;
    samples: { trigger(pad: number, velocity: number): boolean; release(pad: number): boolean; panic(): void };
    drum(event: MidiEvent, playAudio: boolean): void;
    control(action: ControlAction, valid: () => boolean, source: string): Promise<EngineResult | null>;
  }) {}

  press(source: string, pad: number, velocity: number): EngineResult | Promise<EngineResult> {
    const snapshot = this.dependencies.snapshot();
    if (!Number.isInteger(pad) || pad < 0 || pad > 7 || !Number.isInteger(velocity) || velocity < 1 || velocity > 127) return this.result(false, "Invalid pad press");
    const action = assignedPadAction(snapshot.pads, pad);
    const kind: Hold = action?.kind === "control" ? "control" : action?.kind === "sample" || snapshot.pads.mode === "samples" ? "sample" : "drum";
    const held = this.holds.get(source) ?? new Map<number, Hold>();
    if (kind === "control" && held.has(pad)) return this.result(true);
    if (kind === "sample" && !this.dependencies.samples.trigger(pad, Math.max(velocity, snapshot.settings.minimumVelocity))) return this.result(false, "Assigned sample is unavailable");
    held.set(pad, kind);
    this.holds.set(source, held);
    if (kind === "drum") this.dependencies.drum({ type: "note-on", channel: 9, note: 36 + pad, velocity }, true);
    if (action?.kind === "control") {
      const generation = this.generation;
      // A failed acknowledgement can follow a successful mutation. Only release/reset
      // ends the physical hold; an old completion must not release a newer press.
      return this.dependencies.control(action, () => generation === this.generation, source)
        .then((result) => result ?? this.result(false, "Pad press was cancelled by a mapping reset"));
    }
    return this.result(true);
  }

  release(source: string, pad: number): EngineResult {
    const held = this.holds.get(source);
    const kind = held?.get(pad);
    if (!kind) return this.result(true);
    held!.delete(pad);
    if (!held!.size) this.holds.delete(source);
    if ([...this.holds.values()].some((other) => other.get(pad) === kind)) return this.result(true);
    if (kind === "sample") this.dependencies.samples.release(pad);
    if (kind === "drum") this.dependencies.drum({ type: "note-off", channel: 9, note: 36 + pad }, false);
    return this.result(true);
  }

  reset(): void {
    ++this.generation;
    for (const [source, pads] of this.holds) for (const pad of [...pads.keys()]) this.release(source, pad);
    this.dependencies.samples.panic();
  }

  private result(accepted: boolean, error?: string): EngineResult {
    const snapshot = this.dependencies.snapshot();
    return { accepted, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle, ...(error ? { error } : {}) };
  }
}