import { randomUUID } from "node:crypto";
import type { AudioOutput } from "@alesis/audio";
import type { SimulatedHostEngine, EngineResult } from "@alesis/engine";
import { parseLoopSession, type EngineSnapshot, type LoopSession, type SoundFontPreset } from "@alesis/protocol";
import { MidiLoopScheduler, matchesLegacyQuantization, quantizeRecording } from "./loop-playback.js";

export interface PreparedSessionAudio {
  /** Synchronous, nonthrowing pointer swap; all I/O must finish during preparation. */
  commit(): void;
  dispose(): Promise<void>;
}

export interface LoopSessionHost {
  engine: SimulatedHostEngine;
  loops: MidiLoopScheduler;
  percussionSoundFontId: string | null;
  inspectPresets(soundFontId: string): SoundFontPreset[];
  prepareAudio(session: LoopSession): Promise<PreparedSessionAudio>;
}

export function exportLoopSession(host: LoopSessionHost): EngineResult {
  const snapshot = host.engine.snapshot();
  requireStopped(snapshot);
  if (!snapshot.capture.staged && !snapshot.capture.previousStaged && snapshot.promoted.length === 0) {
    throw new Error("No completed takes to save");
  }
  const { midiInputId: _midi, audioOutputId: _audio, ...settings } = snapshot.settings;
  const font = snapshot.synth.soundFonts.find(({ id }) => id === snapshot.synth.selectedSoundFontId);
  const preset = snapshot.synth.soundFontPresets.find(({ id }) => id === snapshot.synth.selectedSoundFontPresetId);
  if (snapshot.synth.selectedSoundFontId && (!font || !preset)) throw new Error("Selected SoundFont or preset is unavailable");
  const kit = snapshot.pads.drumKits.find(({ id }) => id === snapshot.pads.selectedDrumKitId);
  const session: LoopSession = {
    format: "alesis-loop-session", version: 1, settings,
    sourceOrigin: 0, loopStart: snapshot.capture.loopStart,
    overdub: snapshot.capture.overdub,
    synth: { selectedId: snapshot.synth.selectedId, parameterValues: snapshot.synth.parameterValues, soundFont: font && preset ? { ...font, preset } : null },
    drums: snapshot.drums,
    percussion: kit && host.percussionSoundFontId ? { soundFontId: host.percussionSoundFontId, kit } : null,
    arpeggiator: snapshot.arpeggiator,
    monitorOnly: snapshot.monitorOnly,
    stagedAudible: snapshot.capture.stagedAudible,
    quantization: snapshot.capture.quantization,
    ...host.loops.captureSessionTakes(snapshot),
  };
  const sessionJson = JSON.stringify(session);
  parseLoopSession(sessionJson);
  validateCapabilities(session, snapshot, host);
  return { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle, sessionJson, message: "Loop session ready to download." };
}

export async function importLoopSession(json: string, host: LoopSessionHost): Promise<EngineResult> {
  requireStopped(host.engine.snapshot());
  const session = parseLoopSession(json);
  const presets = validateCapabilities(session, host.engine.snapshot(), host);
  if (session.staged) {
    const totalBeats = session.settings.beatsPerMeasure * session.settings.loopMeasures;
    const rendered = quantizeRecording(session.staged.rawRecording, session.quantization, totalBeats);
    if (JSON.stringify(rendered) !== JSON.stringify(session.staged.recording)
      && !matchesLegacyQuantization(session.staged.recording, session.staged.rawRecording, session.quantization, totalBeats)) {
      throw new Error("Staged MIDI does not match its raw recording and quantization");
    }
    // Restore the saved representation, including legacy timing. Only an explicit
    // quantization change regenerates staged MIDI; frozen slots are never rebuilt.
  }
  // Imported IDs cannot alias old recordings, undo state, or future take-N IDs.
  for (const entry of [session.staged, session.previousStaged, ...session.promoted]) {
    if (entry) entry.take.id = `session-${randomUUID()}`;
  }
  const commitRecordings = host.loops.prepareSessionRestore(session);
  const audio = await host.prepareAudio(session);
  let committed = false;
  try {
    requireStopped(host.engine.snapshot());
    const result = host.engine.restoreLoopSession(session, presets, () => {
      audio.commit();
      commitRecordings();
    });
    committed = true;
    return result;
  } finally {
    if (!committed) await audio.dispose();
  }
}

function requireStopped(snapshot: EngineSnapshot): void {
  if (snapshot.transport.state !== "stopped") throw new Error("Stop transport before saving or loading a loop session");
}

function validateCapabilities(session: LoopSession, snapshot: EngineSnapshot, host: LoopSessionHost): SoundFontPreset[] {
  const instrument = snapshot.synth.instruments.find(({ id }) => id === session.synth.selectedId);
  if (!instrument) throw new Error(`Unavailable synthesizer: ${session.synth.selectedId}`);
  const values = session.synth.parameterValues;
  if (Object.keys(values).length !== instrument.controls.length || instrument.controls.some((control) =>
    !Object.hasOwn(values, control.id) || values[control.id]! < control.minimum || values[control.id]! > control.maximum)) {
    throw new Error(`Invalid or missing parameters for ${instrument.name}`);
  }
  const font = session.synth.soundFont;
  let presets: SoundFontPreset[] = [];
  if (font) {
    if (!snapshot.synth.soundFonts.some(({ id, name }) => id === font.id && name === font.name)) throw new Error(`Missing SoundFont: ${font.name} (${font.id}). Install the original font; no substitute was loaded.`);
    presets = host.inspectPresets(font.id);
    if (!presets.some((preset) => preset.id === font.preset.id && preset.bank === font.preset.bank && preset.program === font.preset.program && preset.name === font.preset.name)) {
      throw new Error(`Missing preset ${font.preset.name} (bank ${font.preset.bank}, program ${font.preset.program}) in ${font.name}`);
    }
  }
  const percussion = session.percussion;
  const usesDrums = session.drums.enabled || [session.staged, session.previousStaged, ...session.promoted]
    .some((take) => take?.recording.some(({ event }) => event.channel === 9));
  if (usesDrums && !percussion) throw new Error("Session requires a percussion SoundFont and kit");
  if (percussion && (percussion.soundFontId !== host.percussionSoundFontId || !snapshot.pads.drumKits.some((kit) =>
    kit.id === percussion.kit.id && kit.bank === percussion.kit.bank && kit.program === percussion.kit.program && kit.name === percussion.kit.name))) {
    throw new Error(`Missing percussion SoundFont/kit: ${percussion.soundFontId} / ${percussion.kit.name}`);
  }
  return presets;
}

/** Configure an isolated output. A failed load never touches the current renderer. */
export async function prepareSessionAudio(session: LoopSession, createOutput: () => AudioOutput, swap: (output: AudioOutput) => void): Promise<PreparedSessionAudio> {
  const output = createOutput();
  try {
    await output.start();
    await output.selectSynth(session.synth.selectedId);
    output.panic();
    for (const [id, value] of Object.entries(session.synth.parameterValues)) output.setSynthParameter(session.synth.selectedId, id, value);
    const preset = session.synth.soundFont?.preset;
    if (preset) output.selectSoundFontPreset(preset.bank, preset.program);
    if (session.percussion) output.selectDrumKit(session.percussion.kit.bank, session.percussion.kit.program);
  } catch (error) {
    await output.close().catch(() => {});
    throw error;
  }
  return { commit: () => swap(output), dispose: () => output.close() };
}
