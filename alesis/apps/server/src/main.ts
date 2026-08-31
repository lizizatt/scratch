import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import { discoverDefaultPulseAudioDevice, discoverSoundFontPresets, discoverSoundFonts, FluidSynthOutput, preferredSoundFont, SilentAudioOutput } from "@alesis/audio";
import { AlsaSequencerMidiSource, discoverVortexSequencerPort, SoftwareVortex } from "@alesis/midi";
import type { EngineCommand } from "@alesis/protocol";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createControlServer } from "./control-server.js";
import { MidiArpeggiator } from "./arpeggiator.js";
import { DrumPatternScheduler } from "./drum-patterns.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import { MetronomeScheduler } from "./metronome.js";
import { exportMp3Session } from "./mp3-exporter.js";
import { PerformanceRouter } from "./performance-router.js";

let soundFonts = discoverSoundFonts();
const defaultSoundFont = preferredSoundFont(soundFonts);
const defaultPresets = defaultSoundFont ? discoverSoundFontPresets(defaultSoundFont.path) : [];
let soundFontsById = new Map(soundFonts.map((soundFont) => [soundFont.id, soundFont]));
const engine = new SimulatedHostEngine({
  soundFonts: soundFonts.map(({ id, name }) => ({ id, name })),
  ...(defaultSoundFont ? { selectedSoundFontId: defaultSoundFont.id } : {}),
  soundFontPresets: defaultPresets,
  ...(defaultPresets[0] ? { selectedSoundFontPresetId: defaultPresets[0].id } : {}),
});
const hardware = process.env.MIDI_MODE === "software" ? null : discoverVortexSequencerPort();
const midi = hardware ? new AlsaSequencerMidiSource(hardware) : new SoftwareVortex();
const pulseDevice = process.env.AUDIO_MODE === "simulated" ? null : discoverDefaultPulseAudioDevice();
const audio = pulseDevice
  ? new FluidSynthOutput({ device: pulseDevice, ...(defaultSoundFont ? { soundFontPath: defaultSoundFont.path } : {}) })
  : new SilentAudioOutput();
const loops = new MidiLoopScheduler(audio);
const arpeggiator = new MidiArpeggiator(engine.snapshot().arpeggiator);
const performanceRouter = new PerformanceRouter();
const drums = new DrumPatternScheduler();
const dispatchPerformance = (event: MidiEvent): void => {
  loops.record(event, engine.snapshot());
  audio.dispatchMidi(event);
};
const disconnectMidi = midi.subscribe((event) => {
  engine.dispatchMidi(event);
  for (const routedEvent of performanceRouter.route(event)) {
    for (const outputEvent of arpeggiator.handle(routedEvent)) dispatchPerformance(outputEvent);
  }
});
await audio.start();
await engine.execute({ type: "configure", settings: { midiInputId: midi.id, audioOutputId: audio.id } });
if (audio instanceof FluidSynthOutput) {
  try {
    await engine.execute({ type: "select-synth", synthId: "soundfont" });
    for (const [parameterId, value] of Object.entries(engine.snapshot().synth.parameterValues)) audio.setSynthParameter("soundfont", parameterId, value);
    if (defaultPresets[0]) audio.selectSoundFontPreset(defaultPresets[0].bank, defaultPresets[0].program);
  } catch (error) {
    throw new Error(`Unable to initialize SoundFont controls: ${error instanceof Error ? error.message : String(error)}`);
  }
}
await midi.start();
const webDirectory = fileURLToPath(new URL("../../web/dist", import.meta.url));
const restoreAudioSelection = async (snapshot: ReturnType<typeof engine.snapshot>): Promise<void> => {
  try {
    const soundFont = snapshot.synth.selectedSoundFontId ? soundFontsById.get(snapshot.synth.selectedSoundFontId) : null;
    if (soundFont) await audio.loadSoundFont(soundFont.path);
    const preset = snapshot.synth.soundFontPresets.find(({ id }) => id === snapshot.synth.selectedSoundFontPresetId);
    if (preset) audio.selectSoundFontPreset(preset.bank, preset.program);
  } catch (error) {
    console.error(`Unable to roll back SoundFont selection: ${error instanceof Error ? error.message : String(error)}`);
  }
};
const executeCommand = async (command: EngineCommand) => {
  if (command.type === "export-mp3") {
    const snapshot = engine.snapshot();
    const soundFont = snapshot.synth.selectedSoundFontId ? soundFontsById.get(snapshot.synth.selectedSoundFontId) : defaultSoundFont;
    if (!soundFont) {
      return { accepted: false, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle, error: "MP3 export requires an installed SoundFont" };
    }
    try {
      const result = await exportMp3Session({
        name: command.name,
        snapshot,
        recordings: loops.exportRecordings(snapshot.promoted.map(({ id }) => id)),
        soundFontPath: soundFont.path,
        ...(existsSync("/usr/share/sounds/sf2/FluidR3_GM.sf2") ? { percussionSoundFontPath: "/usr/share/sounds/sf2/FluidR3_GM.sf2" } : {}),
      });
      return { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle, message: `Saved ${result.tracks.length} tracks and mix to ${result.directory}` };
    } catch (error) {
      return { accepted: false, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle, error: `Unable to export MP3: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  if (command.type === "configure-arpeggiator") {
    const result = await engine.execute(command);
    if (!result.accepted) return result;
    const settings = engine.snapshot().arpeggiator;
    for (const event of arpeggiator.configure(settings)) dispatchPerformance(event);
    return result;
  }
  if (command.type === "select-synth") {
    const before = engine.snapshot();
    const target = before.synth.instruments.find(({ id }) => id === command.synthId);
    if (!target) return engine.execute(command);
    try {
      await audio.selectSynth(command.synthId);
      for (const control of target.controls) audio.setSynthParameter(command.synthId, control.id, control.defaultValue);
    } catch (error) {
      try {
        await audio.selectSynth(before.synth.selectedId);
        for (const [parameterId, value] of Object.entries(before.synth.parameterValues)) audio.setSynthParameter(before.synth.selectedId, parameterId, value);
      } catch (rollbackError) {
        console.error(`Unable to roll back synth selection: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      return { accepted: false, revision: before.revision, appliedCycle: before.transport.cycle, error: `Unable to select synth: ${error instanceof Error ? error.message : String(error)}` };
    }
    return engine.execute(command);
  }
  if (command.type === "refresh-soundfonts") {
    const before = engine.snapshot();
    const refreshed = discoverSoundFonts();
    const currentId = before.synth.selectedSoundFontId;
    const selected = refreshed.find(({ id }) => id === currentId) ?? preferredSoundFont(refreshed);
    const presets = selected ? discoverSoundFontPresets(selected.path) : [];
    const currentPresetId = before.synth.selectedSoundFontPresetId;
    const preset = presets.find(({ id }) => id === currentPresetId) ?? presets[0] ?? null;
    if (selected && selected.id !== currentId) {
      try {
        await audio.loadSoundFont(selected.path);
      } catch (error) {
        const snapshot = engine.snapshot();
        return {
          accepted: false,
          revision: snapshot.revision,
          appliedCycle: snapshot.transport.cycle,
          error: `Unable to load SoundFont: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    if (preset) audio.selectSoundFontPreset(preset.bank, preset.program);
    const result = engine.replaceSoundFontCatalog(refreshed.map(({ id, name }) => ({ id, name })), selected?.id ?? null, presets, preset?.id ?? null);
    if (!result.accepted) {
      await restoreAudioSelection(before);
      return result;
    }
    soundFonts = refreshed;
    soundFontsById = new Map(soundFonts.map((soundFont) => [soundFont.id, soundFont]));
    return result;
  }
  if (command.type === "select-soundfont") {
    const before = engine.snapshot();
    const soundFont = soundFontsById.get(command.soundFontId);
    if (!soundFont) return engine.execute(command);
    const presets = discoverSoundFontPresets(soundFont.path);
    const preset = presets[0] ?? null;
    try {
      await audio.loadSoundFont(soundFont.path);
      if (preset) audio.selectSoundFontPreset(preset.bank, preset.program);
    } catch (error) {
      const snapshot = engine.snapshot();
      return {
        accepted: false,
        revision: snapshot.revision,
        appliedCycle: snapshot.transport.cycle,
        error: `Unable to load SoundFont: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const result = engine.replaceSoundFontSelection(soundFont.id, presets, preset?.id ?? null);
    if (!result.accepted) await restoreAudioSelection(before);
    return result;
  }
  if (command.type === "select-soundfont-preset") {
    const before = engine.snapshot();
    const preset = before.synth.soundFontPresets.find(({ id }) => id === command.presetId);
    if (!preset) return engine.execute(command);
    try {
      audio.selectSoundFontPreset(preset.bank, preset.program);
      const result = await engine.execute(command);
      if (!result.accepted) await restoreAudioSelection(before);
      return result;
    } catch (error) {
      const snapshot = engine.snapshot();
      return { accepted: false, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle, error: `Unable to select SoundFont preset: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  if (command.type === "set-synth-parameter" && engine.snapshot().synth.selectedId === "soundfont") {
    const control = engine.snapshot().synth.instruments.find(({ id }) => id === "soundfont")?.controls.find(({ id }) => id === command.parameterId);
    if (!control || command.value < control.minimum || command.value > control.maximum) return engine.execute(command);
    try {
      audio.setSynthParameter("soundfont", command.parameterId, command.value);
    } catch (error) {
      const snapshot = engine.snapshot();
      return {
        accepted: false,
        revision: snapshot.revision,
        appliedCycle: snapshot.transport.cycle,
        error: `Unable to set SoundFont parameter: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (command.type === "set-synth-parameter" && engine.snapshot().synth.selectedId === "subtractive") {
    const control = engine.snapshot().synth.instruments.find(({ id }) => id === "subtractive")?.controls.find(({ id }) => id === command.parameterId);
    if (!control || command.value < control.minimum || command.value > control.maximum) return engine.execute(command);
    try {
      audio.setSynthParameter("subtractive", command.parameterId, command.value);
    } catch (error) {
      const snapshot = engine.snapshot();
      return {
        accepted: false,
        revision: snapshot.revision,
        appliedCycle: snapshot.transport.cycle,
        error: `Unable to set Neon Pressure parameter: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  const result = await engine.execute(command);
  if (result.accepted && command.type === "configure" && command.clearAudio) loops.clearRecordings();
  if (result.accepted && command.type === "delete-take") loops.markDeleted(command.takeId);
  if (result.accepted && command.type === "undo-delete") loops.restoreDeleted();
  return result;
};
const server = await createControlServer(engine, Number(process.env.PORT ?? 8787), webDirectory, executeCommand);
const metronome = new MetronomeScheduler(audio);
const timer = setInterval(() => {
  engine.advance(0.05);
  const snapshot = engine.snapshot();
  for (const event of arpeggiator.advance(0.05, snapshot.settings.bpm)) dispatchPerformance(event);
  for (const hit of drums.update(snapshot)) audio.playDrum(hit.note, hit.velocity);
  loops.update(snapshot);
  metronome.update(snapshot);
}, 50);
let demoNoteOn = false;
let demoNote = 60;
let midiDemo: ReturnType<typeof setInterval> | undefined;
const softwareMidi = midi instanceof SoftwareVortex ? midi : null;
const startMidiDemo = (): void => {
  if (!softwareMidi) return;
  midiDemo = setInterval(() => {
      demoNoteOn = !demoNoteOn;
      if (demoNoteOn) {
        demoNote = 60 + engine.snapshot().transport.cycle % 12;
        softwareMidi.keyDown(demoNote, 104);
      } else {
        softwareMidi.keyUp(demoNote);
      }
    }, 500);
};
const midiDemoStart = softwareMidi && process.env.SOFTWARE_VORTEX_DEMO === "1"
  ? setTimeout(startMidiDemo, Number(process.env.SOFTWARE_VORTEX_DEMO_DELAY_MS ?? 0))
  : undefined;

console.log(`Alesis control server listening on http://127.0.0.1:${server.port}`);
console.log(`MIDI input: ${midi.name} (${midi.id})`);
console.log(`Audio output: ${audio.name} (${audio.id})`);
console.log(`SoundFont: ${defaultSoundFont?.name ?? "none"}${defaultSoundFont ? ` (${defaultSoundFont.path})` : ""}`);

async function shutdown(): Promise<void> {
  clearInterval(timer);
  if (midiDemoStart) clearTimeout(midiDemoStart);
  if (midiDemo) clearInterval(midiDemo);
  disconnectMidi();
  await midi.close();
  await audio.close();
  await server.close();
  await engine.dispose();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
