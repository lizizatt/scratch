import { SimulatedHostEngine, type EngineResult, type MidiEvent } from "@alesis/engine";
import { discoverCm108AudioDevice, discoverSoundFontPresets, discoverSoundFonts, FluidSynthOutput, SampleLibrary, SamplePlayer, SilentAudioOutput, type AlsaAudioDevice, type AudioOutput } from "@alesis/audio";
import { AlsaSequencerMidiSource, discoverVortexSequencerPort, SoftwareVortex, type AlsaSequencerPort, type MidiInputEvent, type MidiSource } from "@alesis/midi";
import type { DrumKit, EngineCommand, EngineSnapshot, Readiness, SoundFontPreset } from "@alesis/protocol";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createControlServer, type ControlServer } from "./control-server.js";
import { createAudioHealthObserver } from "./audio-health.js";
import { createRendererControllerRestorer, panicRendererInput } from "./renderer-controllers.js";
import { TransportPlayback } from "./transport-playback.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import { executeLoopCommand } from "./loop-commands.js";
import { exportLoopSession, importLoopSession, prepareSessionAudio, type LoopSessionHost } from "./loop-session.js";
import { MetronomeScheduler } from "./metronome.js";
import { exportMp3Session } from "./mp3-exporter.js";
import { exportLoopSample } from "./loop-sample-exporter.js";
import { createLoopSampleExportService } from "./loop-sample-service.js";
import { applyVelocityCurve, PerformanceRouter } from "./performance-router.js";
import { DeviceHotplugCoordinator } from "./hotplug.js";
import { disconnectSamplePlayer, DrumPadNoteTracker, executePadMode, executePadNavigation, executeSamplePadRelease, executeSamplePadTrigger, HardwareProgramChangeNavigationMapper } from "./pad-controls.js";
import { defaultSettingsCachePath, loadSettingsCache, restoreSettingsCache, saveSettingsCache, settingsCacheFromSnapshot } from "./settings-cache.js";
import { padMidiInput, SamplePadService } from "./sample-pads.js";

let soundFonts = discoverSoundFonts();
const defaultSoundFont = soundFonts.find(({ name }) => name.toLowerCase() === "sth") ?? null;
let defaultPresets: SoundFontPreset[] = [];
let soundFontReason = defaultSoundFont ? undefined : "Required STH.sf2 was not found";
if (defaultSoundFont) {
  try {
    defaultPresets = discoverSoundFontPresets(defaultSoundFont.path);
  } catch (error) {
    soundFontReason = `Unable to inspect STH.sf2: ${error instanceof Error ? error.message : String(error)}`;
  }
}
const defaultPercussionPath = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const percussionSoundFontPath = existsSync(defaultPercussionPath) ? defaultPercussionPath : undefined;
let drumKits: DrumKit[] = [];
if (percussionSoundFontPath) {
  try {
    drumKits = discoverSoundFontPresets(percussionSoundFontPath)
      .filter(({ bank }) => bank === 128)
      .map((preset) => ({ ...preset, id: `drum:${preset.bank}:${preset.program}` }));
  } catch (error) {
    console.error(`Unable to enumerate percussion kits: ${error instanceof Error ? error.message : String(error)}`);
  }
}
let soundFontsById = new Map(soundFonts.map((soundFont) => [soundFont.id, soundFont]));
const engine = new SimulatedHostEngine({
  soundFonts: soundFonts.map(({ id, name }) => ({ id, name })),
  ...(defaultSoundFont ? { selectedSoundFontId: defaultSoundFont.id } : {}),
  soundFontPresets: defaultPresets,
  ...(defaultPresets[0] ? { selectedSoundFontPresetId: defaultPresets[0].id } : {}),
  drumKits,
});
const softwareMidiMode = process.env.MIDI_MODE === "software";
const simulatedAudioMode = process.env.AUDIO_MODE === "simulated";
let discoveredMidiPort: AlsaSequencerPort | null = softwareMidiMode ? null : discoverVortexSequencerPort();
let discoveredAudioDevice: AlsaAudioDevice | null = simulatedAudioMode ? null : discoverCm108AudioDevice();
let midi: MidiSource | null = softwareMidiMode ? new SoftwareVortex() : null;
const audioDevice = discoveredAudioDevice ?? {
  id: "alsa:Device",
  name: "CM108 USB audio",
  usbId: "0d8c:013c",
  cardId: "Device",
  pcm: "alesis_cm108",
};
const initialAudio: AudioOutput = simulatedAudioMode || !defaultSoundFont || soundFontReason
  ? new SilentAudioOutput()
  : new FluidSynthOutput({
      device: audioDevice,
      soundFontPath: defaultSoundFont.path,
      ...(percussionSoundFontPath ? { percussionSoundFontPath } : {}),
      controllerResetObserver: createRendererControllerRestorer(() => audio === initialAudio, () => loops),
      healthObserver: createAudioHealthObserver(() => audio === initialAudio, (ready, reason) => {
        readiness.synth = ready ? { ready: true, identity: "FluidSynth" } : { ready: false, reason: reason ?? "Audio renderer stopped" };
        void engine.execute({ type: "configure", settings: {} });
      }),
    });
let audio: AudioOutput = initialAudio;
const readiness: Readiness = {
  soundFont: soundFontReason
    ? { ready: false, reason: soundFontReason }
    : { ready: true, identity: `${defaultSoundFont!.name} (${defaultSoundFont!.path})` },
  synth: simulatedAudioMode
    ? { ready: true, identity: "Simulated output (development mode)" }
    : { ready: false, reason: "FluidSynth has not started" },
  audio: simulatedAudioMode
    ? { ready: true, identity: "Simulated output (development mode)" }
    : discoveredAudioDevice
      ? { ready: true, identity: `${discoveredAudioDevice.name} (${discoveredAudioDevice.usbId}, ${discoveredAudioDevice.pcm})` }
      : { ready: false, reason: "CM108 USB audio was not found" },
  midi: softwareMidiMode
    ? { ready: true, identity: "Software Vortex (development mode)" }
    : discoveredMidiPort
      ? { ready: true, identity: `${discoveredMidiPort.name} (${discoveredMidiPort.id})` }
      : { ready: false, reason: "Vortex Wireless 2 was not found" },
};
// Schedulers follow the current renderer across an atomic loop-session replacement.
const currentAudio = new Proxy({} as AudioOutput, {
  get(_target, property) {
    const value = Reflect.get(audio, property);
    return typeof value === "function" ? value.bind(audio) : value;
  },
});
const loops = new MidiLoopScheduler(currentAudio);
let importingSession = false;
const sampleRoot = process.env.SAMPLE_LIBRARY_DIR ?? join(homedir(), ".local/share/alesis/samples");
const sampleLibrary = new SampleLibrary(sampleRoot);
let samplePads: SamplePadService;
samplePads = new SamplePadService(sampleLibrary, (state) => {
  engine.setSamplePage(state.pageIndex, state.pageCount, state.page);
  engine.setSampleLibraryStatus(state.status, state.error);
}, !simulatedAudioMode
  ? () => discoveredAudioDevice ? new SamplePlayer(discoveredAudioDevice.pcm, {
      onError: (message) => samplePads.reportPlaybackError(message),
    }) : null
  : undefined);
const performanceRouter = new PerformanceRouter();
const drumPadNotes = new DrumPadNoteTracker();
const dispatchPerformance = (event: MidiEvent, endsAtCycleBoundary = false): void => {
  engine.markCaptureActivity();
  loops.record(event, engine.snapshot(), endsAtCycleBoundary);
  audio.dispatchMidi(event);
};
const dispatchDrumPadEvent = (event: MidiEvent, playAudio: boolean): void => {
  engine.dispatchMidi(event);
  engine.markCaptureActivity();
  loops.record(event, engine.snapshot());
  if (playAudio) audio.dispatchMidi(event);
};
const dispatchArpeggio = (event: MidiEvent, endsAtCycleBoundary = false): void => {
  advanceTransportClock();
  dispatchPerformance(event, endsAtCycleBoundary);
};
let handleProgramChange: (program: number) => void = () => {};
const hardwareProgramChangeNavigation = new HardwareProgramChangeNavigationMapper();
const advanceTransportClock = (): number => playback.advance();
const playback = new TransportPlayback(engine, currentAudio, dispatchArpeggio, undefined, loops);
const handleMidi = (event: MidiInputEvent): void => {
  if (event.type === "program-change") {
    handleProgramChange(event.program);
    return;
  }
  const padInput = padMidiInput(event, engine.snapshot().pads.mode);
  if (padInput?.kind === "trigger-sample") {
    samplePads.trigger(padInput.pad, padInput.velocity);
    return;
  }
  if (padInput?.kind === "release-sample") {
    samplePads.release(padInput.pad);
    return;
  }
  if (padInput?.kind === "drum-hit" || padInput?.kind === "drum-release") {
    advanceTransportClock();
    const curvedEvent = applyVelocityCurve(event, engine.snapshot().settings.velocityCurve);
    drumPadNotes.observe(curvedEvent);
    dispatchDrumPadEvent(curvedEvent, padInput.kind === "drum-hit");
    return;
  }
  advanceTransportClock();
  const curvedEvent = applyVelocityCurve(event, engine.snapshot().settings.velocityCurve);
  engine.dispatchMidi(curvedEvent);
  for (const routedEvent of performanceRouter.route(curvedEvent)) {
    playback.handle(routedEvent);
  }
};
let disconnectMidi = (): void => {};
let midiConnected = false;
const connectMidi = async (source: MidiSource): Promise<boolean> => {
  const unsubscribe = source.subscribe(handleMidi);
  try {
    await source.start();
    midi = source;
    disconnectMidi = unsubscribe;
    midiConnected = true;
    return true;
  } catch (error) {
    unsubscribe();
    await source.close();
    readiness.midi = { ready: false, reason: `Vortex Wireless 2 failed to start: ${error instanceof Error ? error.message : String(error)}` };
    return false;
  }
};
let audioStarted = false;
if (simulatedAudioMode || discoveredAudioDevice && audio instanceof FluidSynthOutput) {
  try {
    await audio.start();
    audio.panic();
    audioStarted = true;
    if (audio instanceof FluidSynthOutput) readiness.synth = { ready: true, identity: "FluidSynth" };
  } catch (error) {
    readiness.synth = { ready: false, reason: `FluidSynth failed to start: ${error instanceof Error ? error.message : String(error)}` };
  }
}
await engine.execute({ type: "configure", settings: { midiInputId: midi?.id ?? "unavailable", audioOutputId: audio.id } });
if (audio instanceof FluidSynthOutput) {
  try {
    await engine.execute({ type: "select-synth", synthId: "soundfont" });
    for (const [parameterId, value] of Object.entries(engine.snapshot().synth.parameterValues)) audio.setSynthParameter("soundfont", parameterId, value);
    if (defaultPresets[0]) audio.selectSoundFontPreset(defaultPresets[0].bank, defaultPresets[0].program);
  } catch (error) {
    readiness.synth = { ready: false, reason: `Unable to initialize SoundFont controls: ${error instanceof Error ? error.message : String(error)}` };
    audio.panic();
  }
}
const initialPads = engine.snapshot().pads;
const initialDrumKit = initialPads.drumKits.find(({ id }) => id === initialPads.selectedDrumKitId);
if (initialDrumKit) audio.selectDrumKit(initialDrumKit.bank, initialDrumKit.program);
if (midi) await connectMidi(midi);
else if (discoveredMidiPort) await connectMidi(new AlsaSequencerMidiSource(discoveredMidiPort));
const initialSampleScan = await samplePads.refresh();
if (!initialSampleScan.accepted) console.error(initialSampleScan.error);
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
let controlServer: ControlServer | undefined;
const captureLoopSample = (_name?: string) => {
  const snapshot = engine.snapshot();
  const durationSeconds = 60 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  if (durationSeconds > 30) throw new Error("Loop arrangement must be 30 seconds or shorter");

  const staged = !snapshot.monitorOnly
    && snapshot.capture.stagedAudible
    && snapshot.capture.staged !== null
    && !snapshot.capture.staged.muted
    && snapshot.capture.staged.level > 0
    ? snapshot.capture.staged
    : null;
  const promoted = snapshot.monitorOnly
    ? []
    : snapshot.promoted.filter((take) => !take.muted && take.level > 0);
  const includeDrums = snapshot.drums.enabled && snapshot.drums.volume > 0;
  if (!staged && promoted.length === 0 && !includeDrums) throw new Error("No audible loop content to export");

  const recordingIds = [...(staged ? [staged.id] : []), ...promoted.map(({ id }) => id)];
  const recordings = loops.captureRecordings(snapshot, recordingIds);
  const renderSnapshot: EngineSnapshot = structuredClone(snapshot);
  renderSnapshot.capture.staged = staged ? structuredClone(staged) : null;
  renderSnapshot.capture.previousStaged = null;
  renderSnapshot.capture.stagedAudible = staged !== null;
  renderSnapshot.capture.currentWaveform = [];
  renderSnapshot.capture.hasCurrentEvents = false;
  renderSnapshot.promoted = structuredClone(promoted);
  renderSnapshot.monitorOnly = false;
  renderSnapshot.settings.metronomeEnabled = false;
  if (!includeDrums) renderSnapshot.drums.enabled = false;

  const selectedSoundFont = snapshot.synth.selectedId === "soundfont" && snapshot.synth.selectedSoundFontId
    ? soundFontsById.get(snapshot.synth.selectedSoundFontId)
    : undefined;
  return {
    snapshot: renderSnapshot,
    recordings,
    ...(selectedSoundFont ? { soundFontPath: selectedSoundFont.path } : {}),
    ...(percussionSoundFontPath ? { percussionSoundFontPath } : {}),
  };
};
const loopSampleExport = createLoopSampleExportService({
  capture: captureLoopSample,
  render: ({ name, snapshot, recordings, sampleRoot: root, soundFontPath, percussionSoundFontPath: percussionPath }) => exportLoopSample({
    ...(name === undefined ? {} : { name }),
    snapshot,
    recordings,
    sampleRoot: root,
    ...(soundFontPath === undefined ? {} : { soundFontPath }),
    ...(percussionPath === undefined ? {} : { percussionSoundFontPath: percussionPath }),
  }),
  async refreshSamples() {
    if (!controlServer) {
      const snapshot = engine.snapshot();
      return { accepted: false, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle, error: "Control server is unavailable" };
    }
    return controlServer.submit({ type: "refresh-samples" });
  },
  sampleRoot,
  resultState: () => {
    const snapshot = engine.snapshot();
    return { revision: snapshot.revision, appliedCycle: snapshot.transport.cycle };
  },
});
const loopSessionHost: LoopSessionHost = {
  engine, loops,
  percussionSoundFontId: percussionSoundFontPath ? "fluidr3-gm-sf2" : null,
  inspectPresets(id) {
    const font = soundFontsById.get(id);
    if (!font) throw new Error(`Missing SoundFont: ${id}`);
    return discoverSoundFontPresets(font.path);
  },
  prepareAudio(session) {
    return prepareSessionAudio(session, () => {
      if (simulatedAudioMode) return new SilentAudioOutput();
      if (!discoveredAudioDevice) throw new Error("Audio device is unavailable; session was not replaced");
      const fontId = session.synth.soundFont?.id ?? engine.snapshot().synth.selectedSoundFontId;
      const font = fontId ? soundFontsById.get(fontId) : null;
      if (!font) throw new Error("Native renderer requires an installed SoundFont");
      const candidate: AudioOutput = new FluidSynthOutput({
        device: discoveredAudioDevice,
        soundFontPath: font.path,
        ...(percussionSoundFontPath ? { percussionSoundFontPath } : {}),
        controllerResetObserver: createRendererControllerRestorer(() => audio === candidate, () => loops),
        healthObserver: createAudioHealthObserver(() => audio === candidate, (ready, reason) => {
          readiness.synth = ready ? { ready: true, identity: "FluidSynth" } : { ready: false, reason: reason ?? "Audio renderer stopped" };
          void engine.execute({ type: "configure", settings: {} });
        }),
      });
      return candidate;
    }, (candidate) => {
      const previous = audio;
      audio = candidate;
      // Preparation completed; close the retired renderer without delaying the commit.
      void previous.close().catch((error) => console.error(`Unable to close retired renderer: ${String(error)}`));
      readiness.synth = { ready: true, identity: simulatedAudioMode ? "Simulated output (development mode)" : "FluidSynth" };
    });
  },
};
const executeCommand = async (command: EngineCommand): Promise<EngineResult> => {
  if (command.type === "play" || command.type === "stop" || command.type === "configure" || command.type === "configure-arpeggiator") {
    advanceTransportClock();
  }
  if (command.type === "export-loop-session") return exportLoopSession(loopSessionHost);
  if (command.type === "import-loop-session") {
    if (hotplugBusy) throw new Error("Audio/MIDI reconnection is in progress; retry loading the session");
    importingSession = true;
    playback.suspend();
    try {
      const result = await importLoopSession(command.sessionJson, loopSessionHost);
      performanceRouter.panic();
      drumPadNotes.panic(() => {});
      return result;
    } finally {
      importingSession = false;
      playback.resume();
    }
  }
  if (command.type === "set-pad-mode") return executePadMode(command, {
    engine,
    samplePads,
    audio,
    panicDrumNotes() {
      drumPadNotes.panic((event) => dispatchDrumPadEvent(event, false));
    },
  });
  if (command.type === "set-pad-navigation-target") return engine.execute(command);
  if (command.type === "select-pad-program" || command.type === "step-pad-navigation") return executePadNavigation(command, { engine, samplePads, audio });
  if (command.type === "refresh-samples") {
    const result = await samplePads.refresh();
    const snapshot = engine.snapshot();
    return result.accepted
      ? { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle }
      : { accepted: false, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle, error: result.error ?? "Unable to refresh samples" };
  }
  if (command.type === "trigger-sample-pad") {
    return executeSamplePadTrigger(command, { engine, samplePads });
  }
  if (command.type === "release-sample-pad") return executeSamplePadRelease(command, { engine, samplePads });
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
  if (command.type === "export-loop-sample") return loopSampleExport.execute(command.name);
  if (command.type === "configure-arpeggiator") {
    return engine.execute(command);
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
    const selected = refreshed.find(({ id }) => id === currentId)
      ?? refreshed.find(({ name }) => name.toLowerCase() === "sth")
      ?? null;
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
  return executeLoopCommand(command, engine, loops, playback);
};

const settingsCachePath = defaultSettingsCachePath();
const cachedSettings = await loadSettingsCache(settingsCachePath);
if (cachedSettings) {
  try {
    await restoreSettingsCache(cachedSettings, executeCommand, () => engine.snapshot());
  } catch (error) {
    console.error(`Unable to restore saved settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const persistentCommandTypes = new Set<EngineCommand["type"]>([
  "import-loop-session",
  "configure",
  "select-synth",
  "select-soundfont",
  "select-soundfont-preset",
  "set-synth-parameter",
  "configure-arpeggiator",
  "configure-drums",
  "set-pad-mode",
  "set-pad-navigation-target",
  "select-pad-program",
  "step-pad-navigation",
  "set-quantization",
]);
let settingsSave = Promise.resolve();
const persistSettings = (): Promise<void> => {
  settingsSave = settingsSave
    .catch(() => {})
    .then(() => saveSettingsCache(settingsCachePath, settingsCacheFromSnapshot(engine.snapshot())))
    .catch((error) => console.error(`Unable to save settings: ${error instanceof Error ? error.message : String(error)}`));
  return settingsSave;
};
const executeAndPersist = async (command: EngineCommand) => {
  const result = await executeCommand(command);
  if (result.accepted && persistentCommandTypes.has(command.type)) void persistSettings();
  return result;
};
const host = process.env.HOST ?? "127.0.0.1";
controlServer = await createControlServer(engine, Number(process.env.PORT ?? 8787), webDirectory, executeAndPersist, host, readiness);
handleProgramChange = (program) => {
  const generation = hardwareProgramChangeNavigation.generation;
  void controlServer!.submit(() => hardwareProgramChangeNavigation.commandForProgramChange(program, engine.snapshot(), generation)?.command ?? null)
    .then((result) => {
      if (result && !result.accepted) console.error(`Rejected MIDI Program Change ${program}: ${result.error ?? "command was not accepted"}`);
    })
    .catch((error) => console.error(`Unable to apply MIDI Program Change: ${error instanceof Error ? error.message : String(error)}`));
};
const panic = (): void => panicRendererInput(engine.snapshot(), loops, () => {
  playback.panic();
  controlServer?.invalidateSamplePadHolds();
  performanceRouter.panic();
  drumPadNotes.panic((event) => dispatchDrumPadEvent(event, false));
  samplePads.panic();
}, audio);
const hotplug = new DeviceHotplugCoordinator({ audio: audioStarted, midi: midiConnected }, {
  panic,
  async stopTransport() {
    await engine.execute({ type: "stop" });
  },
  async disconnectAudio() {
    discoveredAudioDevice = null;
    disconnectSamplePlayer(samplePads);
    await audio.close();
    audioStarted = false;
  },
  async reconnectAudio() {
    discoveredAudioDevice = discoverCm108AudioDevice();
    if (!discoveredAudioDevice || !(audio instanceof FluidSynthOutput)) return false;
    try {
      await audio.start();
      audio.panic();
      await restoreAudioSelection(engine.snapshot());
      await samplePads.refresh();
      audioStarted = true;
      readiness.synth = { ready: true, identity: "FluidSynth" };
      return true;
    } catch (error) {
      readiness.synth = { ready: false, reason: `FluidSynth failed to reconnect: ${error instanceof Error ? error.message : String(error)}` };
      return false;
    }
  },
  async disconnectMidi() {
    hardwareProgramChangeNavigation.reset();
    disconnectMidi();
    await midi?.close();
    midi = null;
    midiConnected = false;
  },
  async reconnectMidi() {
    hardwareProgramChangeNavigation.reset();
    discoveredMidiPort = discoverVortexSequencerPort();
    return discoveredMidiPort ? connectMidi(new AlsaSequencerMidiSource(discoveredMidiPort)) : false;
  },
  async setReady(device, ready) {
    if (device === "audio") {
      readiness.audio = ready && discoveredAudioDevice
        ? { ready: true, identity: `${discoveredAudioDevice.name} (${discoveredAudioDevice.usbId}, ${discoveredAudioDevice.pcm})` }
        : { ready: false, reason: "CM108 USB audio was disconnected" };
      if (!ready) readiness.synth = { ready: false, reason: "FluidSynth stopped after audio disconnect" };
    } else {
      readiness.midi = ready && discoveredMidiPort
        ? { ready: true, identity: `${discoveredMidiPort.name} (${discoveredMidiPort.id})` }
        : { ready: false, reason: "Vortex Wireless 2 was disconnected" };
    }
    await engine.execute({ type: "configure", settings: {} });
  },
});
let hotplugBusy = false;
const hotplugTimer = simulatedAudioMode && softwareMidiMode ? undefined : setInterval(() => {
  if (hotplugBusy || importingSession) return;
  hotplugBusy = true;
  const detectedAudio = simulatedAudioMode || discoverCm108AudioDevice() !== null;
  const detectedMidi = softwareMidiMode || discoverVortexSequencerPort() !== null;
  void hotplug.reconcile({ audio: detectedAudio, midi: detectedMidi })
    .catch((error) => console.error(`Hotplug reconciliation failed: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => { hotplugBusy = false; });
}, 1000);
const metronome = new MetronomeScheduler(currentAudio);
const timer = setInterval(() => {
  if (importingSession) return;
  advanceTransportClock();
  const snapshot = engine.snapshot();
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

console.log(`Alesis control server listening on http://${host}:${controlServer!.port}`);
console.log(`MIDI input: ${midi ? `${midi.name} (${midi.id})` : "unavailable"}`);
console.log(`Audio output: ${audio.name} (${audio.id})`);
console.log(`SoundFont: ${defaultSoundFont?.name ?? "none"}${defaultSoundFont ? ` (${defaultSoundFont.path})` : ""}`);

async function shutdown(): Promise<void> {
  playback.dispose();
  clearInterval(timer);
  if (hotplugTimer) clearInterval(hotplugTimer);
  if (midiDemoStart) clearTimeout(midiDemoStart);
  if (midiDemo) clearInterval(midiDemo);
  panic();
  await persistSettings();
  disconnectMidi();
  await midi?.close();
  await samplePads.close();
  await audio.close();
  await controlServer?.close();
  await engine.dispose();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
