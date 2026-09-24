import type { EngineResult, HostEngine, MidiEvent } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";

export interface SamplePadControls {
  selectPage(pageIndex: number): Promise<{ accepted: boolean; error?: string }>;
  trigger(pad: number, velocity: number): boolean;
  release(pad: number): boolean;
  panic(): void;
}

export interface DisconnectableSamplePlayer {
  reportPlaybackError(message: string): void;
}

export interface PadControlAudio {
  selectSoundFontPreset(bank: number, program: number): void;
  selectDrumKit(bank: number, program: number): void;
}

interface PadControlDependencies {
  engine: Pick<HostEngine, "execute" | "snapshot">;
  samplePads: SamplePadControls;
  audio: PadControlAudio;
  panicDrumNotes?: () => void;
}

export async function executePadNavigation(
  command: Extract<EngineCommand, { type: "select-pad-program" | "step-pad-navigation" }>,
  { engine, samplePads, audio }: PadControlDependencies,
): Promise<EngineResult> {
  const before = engine.snapshot();
  const count = before.pads.navigationCount;
  if (count === 0) return engine.execute(command);
  const index = command.type === "select-pad-program"
    ? command.program
    : (before.pads.navigationIndex + command.direction + count) % count;
  if (index >= count) return engine.execute(command);

  const target = before.pads.navigationTarget;
  const voices = target === "voices"
    ? before.synth.soundFontPresets
      .filter((preset) => preset.bank === (before.synth.soundFontPresets.find(({ id }) => id === before.synth.selectedSoundFontPresetId)?.bank ?? 0))
      .sort((left, right) => left.program - right.program || left.name.localeCompare(right.name))
    : [];
  const kits = target === "drum-kits"
    ? before.pads.drumKits.slice().sort((left, right) => left.bank - right.bank || left.program - right.program || left.name.localeCompare(right.name))
    : [];

  try {
    if (target === "voices") {
      const preset = voices[index];
      if (!preset) return engine.execute(command);
      audio.selectSoundFontPreset(preset.bank, preset.program);
    } else if (target === "drum-kits") {
      const kit = kits[index];
      if (!kit) return engine.execute(command);
      audio.selectDrumKit(kit.bank, kit.program);
    }
  } catch (error) {
    return resultFromSnapshot(engine.snapshot(), false, `Unable to select pad navigation entry: ${errorMessage(error)}`);
  }

  if (target === "sample-pages") {
    const pageResult = await samplePads.selectPage(index);
    const snapshot = engine.snapshot();
    return pageResult.accepted
      ? resultFromSnapshot(snapshot, true)
      : resultFromSnapshot(snapshot, false, pageResult.error ?? "Unable to select sample page");
  }

  return engine.execute(command);
}

export function executePadMode(
  command: Extract<EngineCommand, { type: "set-pad-mode" }>,
  { engine, samplePads, panicDrumNotes }: PadControlDependencies,
): Promise<EngineResult> {
  const previousMode = engine.snapshot().pads.mode;
  if (previousMode === "samples" && command.mode !== "samples") samplePads.panic();
  if (previousMode === "drums" && command.mode === "samples") panicDrumNotes?.();
  return engine.execute(command);
}

export function executeSamplePadTrigger(
  command: Extract<EngineCommand, { type: "trigger-sample-pad" }>,
  { engine, samplePads }: Pick<PadControlDependencies, "engine" | "samplePads">,
): EngineResult {
  const snapshot = engine.snapshot();
  if (snapshot.pads.mode !== "samples") {
    return resultFromSnapshot(snapshot, false, "Sample pads are only available in sample mode");
  }
  return samplePads.trigger(command.pad, command.velocity)
    ? resultFromSnapshot(engine.snapshot(), true)
    : resultFromSnapshot(engine.snapshot(), false, "Sample pad is not loaded");
}

export function executeSamplePadRelease(
  command: Extract<EngineCommand, { type: "release-sample-pad" }>,
  { engine, samplePads }: Pick<PadControlDependencies, "engine" | "samplePads">,
): EngineResult {
  const snapshot = engine.snapshot();
  if (snapshot.pads.mode !== "samples") {
    return resultFromSnapshot(snapshot, false, "Sample pads are only available in sample mode");
  }
  return samplePads.release(command.pad)
    ? resultFromSnapshot(engine.snapshot(), true)
    : resultFromSnapshot(engine.snapshot(), false, "Sample pad is not loaded");
}

export function disconnectSamplePlayer(samplePads: DisconnectableSamplePlayer): void {
  samplePads.reportPlaybackError("Audio device disconnected");
}

export class DrumPadNoteTracker {
  private readonly heldNotes = new Set<number>();

  observe(event: MidiEvent): void {
    if (event.channel !== 9 || !("note" in event) || event.note < 36 || event.note > 43) return;
    if (event.type === "note-on" && event.velocity > 0) this.heldNotes.add(event.note);
    else if (event.type === "note-off" || event.type === "note-on" && event.velocity === 0) this.heldNotes.delete(event.note);
  }

  panic(dispatch: (event: MidiEvent) => void): void {
    for (const note of this.heldNotes) dispatch({ type: "note-off", channel: 9, note });
    this.heldNotes.clear();
  }
}

function resultFromSnapshot(snapshot: ReturnType<HostEngine["snapshot"]>, accepted: boolean, error?: string): EngineResult {
  return {
    accepted,
    revision: snapshot.revision,
    appliedCycle: snapshot.transport.cycle,
    ...(error === undefined ? {} : { error }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
