import type { EngineResult, HostEngine, MidiEvent } from "@alesis/engine";
import type { EngineCommand, EngineSnapshot } from "@alesis/protocol";

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

type PadNavigationCommand = Extract<EngineCommand, { type: "select-pad-program" | "step-pad-navigation" }>;

export type HardwareProgramChangeMapping =
  | { mode: "absolute" | "empty"; command: Extract<EngineCommand, { type: "select-pad-program" }> }
  | { mode: "relative"; command: Extract<EngineCommand, { type: "step-pad-navigation" }> }
  | { mode: "duplicate"; command: null };

export class HardwareProgramChangeNavigationMapper {
  private previous: { program: number; signature: string } | null = null;
  private currentGeneration = 0;

  get generation(): number {
    return this.currentGeneration;
  }

  reset(): void {
    this.previous = null;
    this.currentGeneration += 1;
  }

  commandForProgramChange(program: number, snapshot: EngineSnapshot): HardwareProgramChangeMapping;
  commandForProgramChange(program: number, snapshot: EngineSnapshot, generation: number): HardwareProgramChangeMapping | null;
  commandForProgramChange(program: number, snapshot: EngineSnapshot, generation = this.currentGeneration): HardwareProgramChangeMapping | null {
    if (generation !== this.currentGeneration) return null;
    const signature = padNavigationCatalogSignature(snapshot);
    const count = snapshot.pads.navigationCount;
    const previous = this.previous?.signature === signature ? this.previous : null;
    if (previous?.program === program) return { mode: "duplicate", command: null };

    this.previous = { program, signature };
    if (count === 0) return { mode: "empty", command: { type: "select-pad-program", program } };
    if (previous) {
      if ((previous.program + 1) % 128 === program) return { mode: "relative", command: { type: "step-pad-navigation", direction: 1 } };
      if ((previous.program + 127) % 128 === program) return { mode: "relative", command: { type: "step-pad-navigation", direction: -1 } };
    }
    return { mode: "absolute", command: { type: "select-pad-program", program: program % count } };
  }
}

function padNavigationCatalogSignature(snapshot: EngineSnapshot): string {
  const target = snapshot.pads.navigationTarget;
  if (target === "voices") {
    const selected = snapshot.synth.soundFontPresets.find(({ id }) => id === snapshot.synth.selectedSoundFontPresetId);
    const bank = selected?.bank ?? 0;
    const soundFont = snapshot.synth.selectedSoundFontId ?? "";
    const voices = snapshot.synth.soundFontPresets
      .filter((preset) => preset.bank === bank)
      .sort((left, right) => left.program - right.program || left.name.localeCompare(right.name))
      .map(({ id, bank, program }) => `${id}:${bank}:${program}`)
      .join(",");
    return `${target}:${soundFont}:${bank}:${snapshot.pads.navigationCount}:${voices}`;
  }
  if (target === "drum-kits") {
    const kits = snapshot.pads.drumKits
      .slice()
      .sort((left, right) => left.bank - right.bank || left.program - right.program || left.name.localeCompare(right.name))
      .map(({ id, bank, program }) => `${id}:${bank}:${program}`)
      .join(",");
    return `${target}:${snapshot.pads.navigationCount}:${kits}`;
  }
  return `${target}:${snapshot.pads.navigationCount}`;
}

export async function executePadNavigation(
  command: PadNavigationCommand,
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
