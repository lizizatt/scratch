import type { AudioOutput } from "@alesis/audio";
import type { EngineSnapshot } from "@alesis/protocol";
import type { MidiLoopScheduler } from "./loop-playback.js";

/** Prepared/retired renderers must never replay the current host's controller state. */
export function createRendererControllerRestorer(
  isCurrent: () => boolean,
  loops: () => Pick<MidiLoopScheduler, "reapplyInputControllers">,
): () => void {
  return () => {
    // Reapply delivered state directly, not through the router/capture path:
    // the physical controls have not moved and this is not a new performance.
    if (isCurrent()) loops().reapplyInputControllers();
  };
}

/** Explicit host panic clears input intent, unlike an internal renderer reset. */
export function panicRendererInput(
  snapshot: EngineSnapshot,
  loops: MidiLoopScheduler,
  releasePerformance: () => void,
  output: Pick<AudioOutput, "panic">,
): void {
  // Panic may emit no arp release, so it cannot be relied on to finalize rollover.
  loops.captureRecordings(snapshot, []);
  releasePerformance();
  output.panic();
  loops.resetRecordingInput();
}
