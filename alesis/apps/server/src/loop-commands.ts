import type { EngineResult, SimulatedHostEngine } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import type { MidiLoopScheduler } from "./loop-playback.js";
import type { TransportPlayback } from "./transport-playback.js";

/** Final engine-command path, after host-specific branches and clock advancement. */
export async function executeLoopCommand(
  command: EngineCommand,
  engine: Pick<SimulatedHostEngine, "snapshot" | "execute" | "ensureOverdubStaged">,
  loops: MidiLoopScheduler,
  playback: Pick<TransportPlayback, "transaction">,
): Promise<EngineResult> {
  if (command.type === "configure") {
    const snapshot = engine.snapshot();
    const timingChanged = command.settings.bpm !== undefined && command.settings.bpm !== snapshot.settings.bpm
      || command.settings.beatsPerMeasure !== undefined && command.settings.beatsPerMeasure !== snapshot.settings.beatsPerMeasure
      || command.settings.loopMeasures !== undefined && command.settings.loopMeasures !== snapshot.settings.loopMeasures;
    if (timingChanged && loops.hasCurrentRecording() && !command.clearAudio) {
      return {
        accepted: false,
        revision: snapshot.revision,
        appliedCycle: snapshot.transport.cycle,
        error: "Timing changes require clearAudio while a capture is in progress",
      };
    }
  }
  // Finalize any completed rollover before Stop discards the partial cycle or promotion moves its ID.
  if (command.type === "stop" || command.type === "promote-staged" || command.type === "promote-previous-staged") {
    loops.captureRecordings(engine.snapshot(), []);
  }
  const execute = async (): Promise<EngineResult> => {
    if ((command.type === "stop" || command.type === "promote-staged" || command.type === "set-overdub" && !command.enabled)
      && engine.snapshot().capture.overdub && loops.hasCurrentRecording()) {
      engine.ensureOverdubStaged();
      loops.finishOverdub(engine.snapshot());
    }
    const result = await engine.execute(command);
    if (result.accepted && command.type === "configure" && command.clearAudio) loops.clearRecordings();
    if (result.accepted && command.type === "stop") loops.update(engine.snapshot());
    if (result.accepted && command.type === "delete-take") loops.markDeleted(command.takeId);
    if (result.accepted && command.type === "undo-delete") loops.restoreDeleted();
    return result;
  };
  return command.type === "stop" || command.type === "promote-staged" && engine.snapshot().capture.overdub || command.type === "set-overdub" || command.type === "configure" && command.clearAudio
    ? playback.transaction(execute)
    : execute();
}
