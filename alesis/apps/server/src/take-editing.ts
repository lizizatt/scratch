import type { EngineResult, SimulatedHostEngine } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import type { MidiLoopScheduler } from "./loop-playback.js";
import type { TransportPlayback } from "./transport-playback.js";

type TakeNotesCommand = Extract<EngineCommand, { type: "get-take-notes" | "set-take-notes" }>;

export async function executeTakeNotesCommand(
  command: TakeNotesCommand,
  engine: Pick<SimulatedHostEngine, "snapshot" | "runtimeSnapshot" | "setTakeWaveform">,
  loops: MidiLoopScheduler,
  playback: Pick<TransportPlayback, "transaction">,
): Promise<EngineResult> {
  const snapshot = engine.snapshot();
  const base = { revision: snapshot.revision, appliedCycle: snapshot.transport.cycle };
  const reject = (error: string): EngineResult => ({ accepted: false, ...base, error });
  const { staged, previousStaged } = snapshot.capture;
  if (![staged, previousStaged, ...snapshot.promoted].some((take) => take?.id === command.takeId)) return reject(`Unknown take: ${command.takeId}`);

  if (command.type === "get-take-notes") {
    const takeNotes = loops.takeNotes(engine.runtimeSnapshot(), command.takeId);
    return takeNotes ? { accepted: true, ...base, takeNotes } : reject("This take has no MIDI recording");
  }
  return playback.transaction(async () => {
    try {
      const { takeNotes, waveform } = loops.setTakeNotes(engine.runtimeSnapshot(), command.takeId, command.version, command.notes);
      engine.setTakeWaveform(command.takeId, waveform);
      const current = engine.snapshot();
      return { accepted: true, revision: current.revision, appliedCycle: current.transport.cycle, takeNotes };
    } catch (error) {
      return reject(error instanceof Error ? error.message : String(error));
    }
  });
}
