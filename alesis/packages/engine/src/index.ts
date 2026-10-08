import {
  PROTOCOL_VERSION,
  MAX_PROMOTED_TAKES,
  padAssignmentSchema,
  padAssignmentsSchema,
  engineSnapshotSchema,
  type EngineCommand,
  type EngineSnapshot,
  type DrumKit,
  type InstrumentDescriptor,
  type PadNavigationTarget,
  type Pads,
  type SamplePad,
  type SoundFont,
  type SoundFontPreset,
  type Take,
  type LoopSession,
  type MidiEvent,
} from "@alesis/protocol";

export type { MidiEvent } from "@alesis/protocol";

export interface EngineResult {
  accepted: boolean;
  revision: number;
  appliedCycle: number;
  error?: string;
  message?: string;
  sessionJson?: string;
}

export type EngineListener = (snapshot: EngineSnapshot) => void;

export interface HostEngine {
  execute(command: EngineCommand): Promise<EngineResult>;
  dispatchMidi(event: MidiEvent): void;
  snapshot(): EngineSnapshot;
  subscribe(listener: EngineListener): () => void;
  dispose(): Promise<void>;
}

const instruments: InstrumentDescriptor[] = [
  {
    id: "subtractive", name: "Neon Pressure", engine: "neon", controls: [
      { id: "cutoff", label: "Cutoff", kind: "range", group: "tone", advanced: false, defaultValue: 6_300, minimum: 40, maximum: 18_000, step: 89.8, unit: "Hz" },
      { id: "resonance", label: "Resonance", kind: "range", group: "tone", advanced: false, defaultValue: 0.42, minimum: 0, maximum: 1, step: 0.005, unit: "%" },
      { id: "attack", label: "Attack", kind: "range", group: "envelope", advanced: false, defaultValue: 0.024, minimum: 0.001, maximum: 3, step: 0.015, unit: "s" },
      { id: "release", label: "Release", kind: "range", group: "envelope", advanced: false, defaultValue: 1.8, minimum: 0.01, maximum: 8, step: 0.04, unit: "s" },
      { id: "lfo-rate", label: "LFO Rate", kind: "range", group: "modulation", advanced: false, defaultValue: 3.2, minimum: 0.05, maximum: 20, step: 0.1, unit: "Hz" },
      { id: "drive", label: "Drive", kind: "range", group: "tone", advanced: false, defaultValue: 0.18, minimum: 0, maximum: 1, step: 0.005, unit: "%" },
    ],
  },
  {
    id: "soundfont", name: "SoundFont Player", engine: "fluidsynth", controls: [
      { id: "gain", label: "Volume", kind: "range", group: "output", advanced: false, defaultValue: 0.72, minimum: 0, maximum: 1, step: 0.005, unit: "%" },
      { id: "reverb-send", label: "Reverb Mix", kind: "range", group: "effects", advanced: false, defaultValue: 0.45, minimum: 0, maximum: 1, step: 0.005, unit: "%" },
      { id: "reverb-room", label: "Room Size", kind: "range", group: "effects", advanced: true, defaultValue: 0.2, minimum: 0, maximum: 1, step: 0.005, unit: "%" },
      { id: "reverb-damping", label: "Damping", kind: "range", group: "effects", advanced: true, defaultValue: 0, minimum: 0, maximum: 1, step: 0.005, unit: "%" },
    ],
  },
];

const waveformBucketCount = 96;

interface DeletedTake {
  take: Take;
  index: number;
}

const maxPromotedTakes = MAX_PROMOTED_TAKES;

export interface SimulatedHostEngineOptions {
  soundFonts?: SoundFont[];
  selectedSoundFontId?: string | null;
  soundFontPresets?: SoundFontPreset[];
  selectedSoundFontPresetId?: string | null;
  drumKits?: DrumKit[];
}

export class SimulatedHostEngine implements HostEngine {
  private state: EngineSnapshot;
  private listeners = new Set<EngineListener>();
  private activeNotes = new Map<string, number>();
  private currentWaveform = emptyWaveform();
  private elapsedSeconds = 0;
  private countInSecondsRemaining = 0;
  private deletedTake: DeletedTake | null = null;
  private nextTakeId = 1;

  constructor(options: SimulatedHostEngineOptions = {}) {
    const soundFonts = options.soundFonts ?? [];
    const selectedSoundFontId = options.selectedSoundFontId ?? soundFonts[0]?.id ?? null;
    const soundFontPresets = options.soundFontPresets ?? [];
    const selectedSoundFontPresetId = options.selectedSoundFontPresetId ?? soundFontPresets[0]?.id ?? null;
    const drumKits = options.drumKits ?? [];
    this.state = engineSnapshotSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      revision: 0,
      engine: { mode: "simulated", midiConnected: true, audioConnected: true, midiEventsReceived: 0, lastMidiEvent: null },
      settings: {
        bpm: 118,
        beatsPerMeasure: 4,
        loopMeasures: 4,
        midiInputId: "software-vortex",
        audioOutputId: "simulated-output",
        velocityCurve: "strong",
        metronomeEnabled: true,
        metronomeVolume: 0.25,
        countInEnabled: true,
      },
      transport: { state: "stopped", cycle: 0, progress: 0 },
      monitorOnly: false,
      synth: {
        selectedId: "subtractive",
        instruments,
        soundFonts,
        selectedSoundFontId,
        soundFontPresets,
        selectedSoundFontPresetId,
        parameterValues: defaultParameterValues(instruments[0]!),
      },
      pads: {
        mode: "drums",
        navigationTarget: "voices",
        navigationIndex: 0,
        navigationCount: 0,
        selectedDrumKitId: drumKits[0]?.id ?? null,
        samplePageIndex: 0,
        samplePageCount: 0,
        samplePage: emptySamplePage(),
        sampleLibraryStatus: "loading",
        drumKits: structuredClone(drumKits),
      },
      arpeggiator: { enabled: false, mode: "up", rate: "1/8", octaves: 1, gate: 0.5, latch: false, swing: 0 },
      drums: { enabled: false, pattern: "four-on-floor", volume: 0.7 },
      capture: { currentWaveform: [], hasCurrentEvents: false, staged: null, previousStaged: null, stagedAudible: true, quantization: "off" },
      promoted: [],
      canUndoDelete: false,
    });
    this.updatePadNavigation(false);
  }

  snapshot(): EngineSnapshot {
    return structuredClone(this.state);
  }

  /** Host-only commit, after file/capability validation and audio preparation. */
  restoreLoopSession(session: LoopSession, presets: SoundFontPreset[], commitResources: () => void): EngineResult {
    if (this.state.transport.state !== "stopped") throw new Error("Stop transport before loading a loop session");
    const next = this.snapshot();
    next.settings = { ...next.settings, ...session.settings };
    next.synth.selectedId = session.synth.selectedId;
    next.synth.parameterValues = structuredClone(session.synth.parameterValues);
    next.synth.selectedSoundFontId = session.synth.soundFont?.id ?? null;
    next.synth.selectedSoundFontPresetId = session.synth.soundFont?.preset.id ?? null;
    next.synth.soundFontPresets = structuredClone(presets);
    next.pads.selectedDrumKitId = session.percussion?.kit.id ?? null;
    next.drums = structuredClone(session.drums);
    next.arpeggiator = structuredClone(session.arpeggiator);
    next.monitorOnly = session.monitorOnly;
    next.capture = {
      loopStart: session.loopStart,
      overdub: session.overdub, error: null,
      currentWaveform: [], hasCurrentEvents: false,
      staged: session.staged ? structuredClone(session.staged.take) : null,
      previousStaged: session.previousStaged ? structuredClone(session.previousStaged.take) : null,
      stagedAudible: session.stagedAudible, quantization: session.quantization,
    };
    next.promoted = session.promoted.map(({ take }) => structuredClone(take));
    next.canUndoDelete = false;
    next.transport = { state: "stopped", cycle: 0, progress: 0, origin: 0 };
    next.revision += 1;
    engineSnapshotSchema.parse(next);
    // Install recordings before publishing their take IDs. No await may split this commit.
    commitResources();
    this.state = next;
    this.deletedTake = null;
    this.activeNotes.clear();
    this.currentWaveform = emptyWaveform();
    this.elapsedSeconds = 0;
    this.countInSecondsRemaining = 0;
    this.updatePadNavigation(false);
    this.publish(false);
    return { accepted: true, revision: next.revision, appliedCycle: 0, message: "Loop session loaded. Transport remains stopped." };
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  dispatchMidi(event: MidiEvent): void {
    const noteKey = "note" in event ? `${event.channel}:${event.note}` : null;
    if (event.type === "note-on" && event.velocity > 0) this.activeNotes.set(noteKey!, event.velocity);
    if (noteKey && (event.type === "note-off" || (event.type === "note-on" && event.velocity === 0))) this.activeNotes.delete(noteKey);
    if (this.state.transport.state === "playing") {
      this.state.capture.hasCurrentEvents = true;
      this.writeIntensity(this.state.transport.progress, this.state.transport.progress);
    }
    this.state.engine.midiEventsReceived += 1;
    this.state.engine.lastMidiEvent = event.type;
    this.publish();
  }

  markCaptureActivity(): void {
    if (this.state.transport.state === "playing") this.state.capture.hasCurrentEvents = true;
  }

  /** Host capture commits before the next publication, avoiding reentrant recording writes. */
  setStagedWaveform(takeId: string, waveform: number[]): void {
    if (this.state.capture.staged?.id === takeId) this.state.capture.staged.waveform = [...waveform];
  }

  setCaptureError(error: string): void {
    this.state.capture.error = error;
  }

  ensureOverdubStaged(): void {
    if (this.state.capture.overdub && !this.state.capture.staged) this.state.capture.staged = this.newStagedTake(this.state.transport.cycle);
  }

  async execute(command: EngineCommand): Promise<EngineResult> {
    const result = this.applyCommand(command);
    if (result.accepted) this.publish(false);
    return result;
  }

  replaceSoundFonts(soundFonts: SoundFont[], selectedSoundFontId: string | null): EngineResult {
    if (selectedSoundFontId !== null && !soundFonts.some(({ id }) => id === selectedSoundFontId)) {
      return {
        accepted: false,
        revision: this.state.revision,
        appliedCycle: this.state.transport.cycle,
        error: `Unknown SoundFont: ${selectedSoundFontId}`,
      };
    }
    this.state.synth.soundFonts = structuredClone(soundFonts);
    this.state.synth.selectedSoundFontId = selectedSoundFontId;
    this.updatePadNavigation(false);
    this.state.revision += 1;
    this.publish(false);
    return { accepted: true, revision: this.state.revision, appliedCycle: this.state.transport.cycle };
  }

  replaceSoundFontPresets(presets: SoundFontPreset[], selectedPresetId: string | null): EngineResult {
    if (selectedPresetId !== null && !presets.some(({ id }) => id === selectedPresetId)) {
      return { accepted: false, revision: this.state.revision, appliedCycle: this.state.transport.cycle, error: `Unknown SoundFont preset: ${selectedPresetId}` };
    }
    this.state.synth.soundFontPresets = structuredClone(presets);
    this.state.synth.selectedSoundFontPresetId = selectedPresetId;
    this.updatePadNavigation(false);
    this.state.revision += 1;
    this.publish(false);
    return { accepted: true, revision: this.state.revision, appliedCycle: this.state.transport.cycle };
  }

  replaceSoundFontSelection(soundFontId: string, presets: SoundFontPreset[], selectedPresetId: string | null): EngineResult {
    if (!this.state.synth.soundFonts.some(({ id }) => id === soundFontId)) {
      return { accepted: false, revision: this.state.revision, appliedCycle: this.state.transport.cycle, error: `Unknown SoundFont: ${soundFontId}` };
    }
    if (selectedPresetId !== null && !presets.some(({ id }) => id === selectedPresetId)) {
      return { accepted: false, revision: this.state.revision, appliedCycle: this.state.transport.cycle, error: `Unknown SoundFont preset: ${selectedPresetId}` };
    }
    this.state.synth.selectedSoundFontId = soundFontId;
    this.state.synth.soundFontPresets = structuredClone(presets);
    this.state.synth.selectedSoundFontPresetId = selectedPresetId;
    this.updatePadNavigation(false);
    this.state.revision += 1;
    this.publish(false);
    return { accepted: true, revision: this.state.revision, appliedCycle: this.state.transport.cycle };
  }

  replaceSoundFontCatalog(soundFonts: SoundFont[], soundFontId: string | null, presets: SoundFontPreset[], selectedPresetId: string | null): EngineResult {
    if (soundFontId !== null && !soundFonts.some(({ id }) => id === soundFontId)) {
      return { accepted: false, revision: this.state.revision, appliedCycle: this.state.transport.cycle, error: `Unknown SoundFont: ${soundFontId}` };
    }
    if (selectedPresetId !== null && !presets.some(({ id }) => id === selectedPresetId)) {
      return { accepted: false, revision: this.state.revision, appliedCycle: this.state.transport.cycle, error: `Unknown SoundFont preset: ${selectedPresetId}` };
    }
    this.state.synth.soundFonts = structuredClone(soundFonts);
    this.state.synth.selectedSoundFontId = soundFontId;
    this.state.synth.soundFontPresets = structuredClone(presets);
    this.state.synth.selectedSoundFontPresetId = selectedPresetId;
    this.updatePadNavigation(false);
    this.state.revision += 1;
    this.publish(false);
    return { accepted: true, revision: this.state.revision, appliedCycle: this.state.transport.cycle };
  }

  replaceDrumKits(drumKits: DrumKit[]): void {
    this.state.pads.drumKits = structuredClone(drumKits);
    if (!drumKits.some(({ id }) => id === this.state.pads.selectedDrumKitId)) {
      this.state.pads.selectedDrumKitId = drumKits[0]?.id ?? null;
    }
    this.updatePadNavigation(false);
    this.state.revision += 1;
    this.publish(false);
  }

  setSampleLibraryStatus(status: Pads["sampleLibraryStatus"], error?: string): void {
    this.state.pads.sampleLibraryStatus = status;
    if (error === undefined) delete this.state.pads.sampleLibraryError;
    else this.state.pads.sampleLibraryError = error;
    this.state.revision += 1;
    this.publish(false);
  }

  setSamplePage(index: number, count: number, page: SamplePad[]): void {
    this.state.pads.samplePageIndex = Math.max(0, index);
    this.state.pads.samplePageCount = Math.max(0, count);
    this.state.pads.samplePage = page.length === 8 ? structuredClone(page) : emptySamplePage();
    if (this.state.pads.navigationTarget === "sample-pages") this.updatePadNavigation(false);
    this.state.revision += 1;
    this.publish(false);
  }

  setSampleCatalog(catalog: Pads["sampleCatalog"]): void {
    this.state.pads.sampleCatalog = structuredClone(catalog);
    this.state.revision += 1;
    this.publish(false);
  }

  restorePadAssignments(assignments: Pads["assignments"]): void {
    this.state.pads.assignments = padAssignmentsSchema.parse(assignments);
    this.state.revision += 1;
    this.publish(false);
  }

  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("advance requires nonnegative finite seconds");
    if (this.state.transport.state === "stopped") return;
    this.advanceTransport(seconds);
    this.publish(false);
  }

  private advanceTransport(seconds: number): void {
    if (this.state.transport.state === "counting-in") {
      const consumed = Math.min(seconds, this.countInSecondsRemaining);
      this.countInSecondsRemaining -= consumed;
      seconds -= consumed;
      this.updateCountInProgress();
      if (this.countInSecondsRemaining === 0) {
        this.state.transport.state = "playing";
        this.state.transport.progress = 0;
      }
    }
    if (this.state.transport.state !== "playing") return;

    const duration = this.cycleDurationSeconds();
    // Timing edits preserve elapsed seconds, which may now span several cycles.
    if (this.elapsedSeconds >= duration) {
      seconds += this.elapsedSeconds - duration;
      this.elapsedSeconds = 0;
      this.rollover();
    }
    while (seconds > 0) {
      const remaining = duration - this.elapsedSeconds;
      const consumed = Math.min(seconds, remaining);
      const start = this.elapsedSeconds / duration;
      this.elapsedSeconds += consumed;
      this.writeIntensity(start, this.elapsedSeconds / duration);
      seconds -= consumed;
      if (this.elapsedSeconds >= duration) {
        this.elapsedSeconds = 0;
        this.rollover();
      }
    }
    this.state.transport.progress = this.elapsedSeconds / duration;
    this.state.capture.currentWaveform = [...this.currentWaveform];
  }

  private updateCountInProgress(): void {
    // Preserve the countdown's remaining seconds even if the new measure is shorter.
    this.state.transport.progress = Math.max(0, 1 - this.countInSecondsRemaining / this.measureDurationSeconds());
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    this.activeNotes.clear();
  }

  private applyCommand(command: EngineCommand): EngineResult {
    const reject = (error: string): EngineResult => ({
      accepted: false,
      revision: this.state.revision,
      appliedCycle: this.state.transport.cycle,
      error,
    });

    switch (command.type) {
      case "play":
        if (this.state.transport.state === "stopped") {
          this.state.transport.origin = this.state.capture.loopStart;
          this.elapsedSeconds = 0;
          this.state.transport.progress = 0;
          if (this.state.settings.countInEnabled) {
            this.state.transport.state = "counting-in";
            this.countInSecondsRemaining = this.measureDurationSeconds();
          } else {
            this.state.transport.state = "playing";
          }
        }
        break;
      case "set-overdub":
        this.state.capture.overdub = command.enabled;
        break;
      case "set-loop-start":
        if (!Number.isFinite(command.position) || command.position < 0 || command.position >= 1) return reject("Loop start must be from 0 (inclusive) to 1 (exclusive)");
        this.state.capture.loopStart = command.position;
        break;
      case "stop":
        this.state.transport.state = "stopped";
        this.state.transport.progress = 0;
        this.state.capture.currentWaveform = [];
        this.state.capture.hasCurrentEvents = false;
        this.currentWaveform = emptyWaveform();
        this.elapsedSeconds = 0;
        this.countInSecondsRemaining = 0;
        break;
      case "set-monitor-only":
        this.state.monitorOnly = command.enabled;
        break;
      case "configure": {
        const timingChanged = command.settings.bpm !== undefined && command.settings.bpm !== this.state.settings.bpm
          || command.settings.beatsPerMeasure !== undefined && command.settings.beatsPerMeasure !== this.state.settings.beatsPerMeasure
          || command.settings.loopMeasures !== undefined && command.settings.loopMeasures !== this.state.settings.loopMeasures;
        const hasAudio = this.state.capture.staged !== null || this.state.capture.previousStaged !== null || this.state.promoted.length > 0;
        if (timingChanged && hasAudio && !command.clearAudio) return reject("Timing changes require clearAudio while takes exist");
        if (timingChanged && command.clearAudio) this.clearAudio();
        const settings = command.settings;
        if (settings.bpm !== undefined) this.state.settings.bpm = settings.bpm;
        if (settings.beatsPerMeasure !== undefined) this.state.settings.beatsPerMeasure = settings.beatsPerMeasure;
        if (settings.loopMeasures !== undefined) this.state.settings.loopMeasures = settings.loopMeasures;
        if (settings.midiInputId !== undefined) this.state.settings.midiInputId = settings.midiInputId;
        if (settings.audioOutputId !== undefined) this.state.settings.audioOutputId = settings.audioOutputId;
        if (settings.velocityCurve !== undefined) this.state.settings.velocityCurve = settings.velocityCurve;
        if (settings.minimumVelocity !== undefined) {
          if (!Number.isInteger(settings.minimumVelocity) || settings.minimumVelocity < 1 || settings.minimumVelocity > 127) return reject("Minimum velocity must be an integer from 1 to 127");
          this.state.settings.minimumVelocity = settings.minimumVelocity;
        }
        if (settings.metronomeEnabled !== undefined) this.state.settings.metronomeEnabled = settings.metronomeEnabled;
        if (settings.metronomeVolume !== undefined) this.state.settings.metronomeVolume = settings.metronomeVolume;
        if (settings.countInEnabled !== undefined) this.state.settings.countInEnabled = settings.countInEnabled;
        if (timingChanged) {
          if (this.state.transport.state === "counting-in") this.updateCountInProgress();
          if (this.state.transport.state === "playing" && !command.clearAudio) this.advanceTransport(0);
        }
        break;
      }
      case "select-synth": {
        const instrument = this.state.synth.instruments.find(({ id }) => id === command.synthId);
        if (!instrument) return reject(`Unknown synth: ${command.synthId}`);
        this.state.synth.selectedId = command.synthId;
        this.state.synth.parameterValues = defaultParameterValues(instrument);
        break;
      }
      case "select-soundfont":
        if (!this.state.synth.soundFonts.some(({ id }) => id === command.soundFontId)) return reject(`Unknown SoundFont: ${command.soundFontId}`);
        this.state.synth.selectedSoundFontId = command.soundFontId;
        this.updatePadNavigation(false);
        break;
      case "select-soundfont-preset":
        if (!this.state.synth.soundFontPresets.some(({ id }) => id === command.presetId)) return reject(`Unknown SoundFont preset: ${command.presetId}`);
        this.state.synth.selectedSoundFontPresetId = command.presetId;
        this.updatePadNavigation(false);
        break;
      case "refresh-soundfonts":
        return reject("SoundFont refresh requires the host catalog");
      case "set-pad-mode":
        this.state.pads.mode = command.mode;
        break;
      case "configure-pad": {
        const parsed = padAssignmentSchema.omit({ action: true }).safeParse({ mode: command.mode, page: command.page, pad: command.pad });
        if (!parsed.success || command.page >= Math.max(1, this.state.pads.samplePageCount)) return reject("Pad page is outside the available range");
        if (command.action !== null && !padAssignmentSchema.safeParse({ ...parsed.data, action: command.action }).success) return reject("Invalid pad action");
        const action = command.action;
        if (action?.kind === "sample" && !this.state.pads.sampleCatalog.some(({ id }) => id === action.sampleId)) return reject("Sample is not in the library");
        this.state.pads.assignments = this.state.pads.assignments.filter(({ mode, page, pad }) => mode !== command.mode || page !== command.page || pad !== command.pad);
        if (command.action) this.state.pads.assignments.push({ ...parsed.data, action: structuredClone(command.action) });
        break;
      }
      case "set-pad-navigation-target":
        this.state.pads.navigationTarget = command.target;
        this.updatePadNavigation(false);
        break;
      case "select-pad-program": {
        const count = this.padNavigationCount();
        if (command.program >= count) return reject("Pad program is outside the available navigation range");
        this.state.pads.navigationIndex = command.program;
        this.applyPadNavigationIndex();
        break;
      }
      case "step-pad-navigation": {
        const count = this.padNavigationCount();
        if (count === 0) return reject("No entries are available for pad navigation");
        this.state.pads.navigationIndex = (this.state.pads.navigationIndex + command.direction + count) % count;
        this.applyPadNavigationIndex();
        break;
      }
      case "refresh-samples":
      case "trigger-sample-pad":
      case "release-sample-pad":
        return reject(`${command.type} requires the host sample service`);
      case "set-synth-parameter": {
        const instrument = this.state.synth.instruments.find(({ id }) => id === this.state.synth.selectedId);
        const control = instrument?.controls.find(({ id }) => id === command.parameterId);
        if (!control) return reject(`Unknown parameter: ${command.parameterId}`);
        if (command.value < control.minimum || command.value > control.maximum) return reject(`Parameter out of range: ${command.parameterId}`);
        this.state.synth.parameterValues[command.parameterId] = command.value;
        break;
      }
      case "configure-arpeggiator":
        if (command.settings.enabled !== undefined) this.state.arpeggiator.enabled = command.settings.enabled;
        if (command.settings.mode !== undefined) this.state.arpeggiator.mode = command.settings.mode;
        if (command.settings.rate !== undefined) this.state.arpeggiator.rate = command.settings.rate;
        if (command.settings.octaves !== undefined) this.state.arpeggiator.octaves = command.settings.octaves;
        if (command.settings.gate !== undefined) this.state.arpeggiator.gate = command.settings.gate;
        if (command.settings.latch !== undefined) this.state.arpeggiator.latch = command.settings.latch;
        if (command.settings.swing !== undefined) this.state.arpeggiator.swing = command.settings.swing;
        break;
      case "configure-drums":
        if (command.settings.enabled !== undefined) this.state.drums.enabled = command.settings.enabled;
        if (command.settings.pattern !== undefined) this.state.drums.pattern = command.settings.pattern;
        if (command.settings.volume !== undefined) {
          if (command.settings.volume < 0 || command.settings.volume > 1) return reject("Drum volume must be between 0 and 1");
          this.state.drums.volume = command.settings.volume;
        }
        break;
      case "set-staged-audible":
        this.state.capture.stagedAudible = command.audible;
        if (this.state.capture.staged) this.state.capture.staged.muted = !command.audible;
        break;
      case "set-quantization":
        this.state.capture.quantization = command.mode;
        break;
      case "promote-staged":
        if (!this.state.capture.staged) return reject("No staged take to promote");
        if (this.state.promoted.length >= maxPromotedTakes) return reject(`At most ${maxPromotedTakes} promoted takes are supported`);
        this.state.promoted.push(this.state.capture.staged);
        this.state.capture.staged = null;
        break;
      case "promote-previous-staged":
        if (!this.state.capture.previousStaged) return reject("No previous staged take to promote");
        if (this.state.promoted.length >= maxPromotedTakes) return reject(`At most ${maxPromotedTakes} promoted takes are supported`);
        this.state.promoted.push({ ...this.state.capture.previousStaged, muted: false });
        this.state.capture.previousStaged = null;
        break;
      case "set-take-level": {
        const take = this.findTake(command.takeId);
        if (!take) return reject(`Unknown take: ${command.takeId}`);
        take.level = command.level;
        break;
      }
      case "set-take-muted": {
        const take = this.findTake(command.takeId);
        if (!take) return reject(`Unknown take: ${command.takeId}`);
        take.muted = command.muted;
        break;
      }
      case "delete-take": {
        const index = this.state.promoted.findIndex(({ id }) => id === command.takeId);
        if (index < 0) return reject(`Unknown take: ${command.takeId}`);
        const [take] = this.state.promoted.splice(index, 1);
        if (!take) return reject(`Unknown take: ${command.takeId}`);
        this.deletedTake = { take, index };
        this.state.canUndoDelete = true;
        break;
      }
      case "undo-delete":
        if (!this.deletedTake) return reject("No deleted take to restore");
        this.state.promoted.splice(this.deletedTake.index, 0, this.deletedTake.take);
        this.deletedTake = null;
        this.state.canUndoDelete = false;
        break;
      case "export-mp3":
        return reject("MP3 export is not available in the simulated engine");
      case "export-loop-sample":
        return reject("Loop sample export requires the host sample service");
      case "export-loop-session":
      case "import-loop-session":
        return reject("Loop sessions require host orchestration");
    }

    this.state.revision += 1;
    return { accepted: true, revision: this.state.revision, appliedCycle: this.state.transport.cycle };
  }

  private rollover(): void {
    const completedCycle = this.state.transport.cycle;
    if (!this.state.capture.overdub) this.state.capture.previousStaged = this.state.capture.staged;
    if (!this.state.capture.overdub || !this.state.capture.staged) this.state.capture.staged = this.newStagedTake(completedCycle);
    else this.state.capture.staged.cycle = completedCycle;
    this.currentWaveform = emptyWaveform();
    this.state.capture.hasCurrentEvents = false;
    this.state.transport.cycle += 1;
    this.state.revision += 1;
  }

  private newStagedTake(cycle: number): Take {
    return { id: `take-${this.nextTakeId++}`, cycle, level: 0.8, muted: !this.state.capture.stagedAudible, waveform: [...this.currentWaveform] };
  }

  private padNavigationCount(target: PadNavigationTarget = this.state.pads.navigationTarget): number {
    if (target === "voices") return this.voicesInCurrentBank().length;
    if (target === "drum-kits") return this.sortedDrumKits().length;
    return this.state.pads.samplePageCount;
  }

  private updatePadNavigation(preserveIndex: boolean): void {
    const pads = this.state.pads;
    const target = pads.navigationTarget;
    const count = this.padNavigationCount(target);
    pads.navigationCount = count;
    if (count === 0) {
      pads.navigationIndex = 0;
      return;
    }
    if (preserveIndex) {
      pads.navigationIndex = Math.min(pads.navigationIndex, count - 1);
      return;
    }
    if (target === "voices") {
      const selected = this.voicesInCurrentBank().findIndex(({ id }) => id === this.state.synth.selectedSoundFontPresetId);
      pads.navigationIndex = selected >= 0 ? selected : 0;
    } else if (target === "drum-kits") {
      const selected = this.sortedDrumKits().findIndex(({ id }) => id === pads.selectedDrumKitId);
      pads.navigationIndex = selected >= 0 ? selected : 0;
    } else {
      pads.navigationIndex = Math.min(pads.samplePageIndex, count - 1);
    }
  }

  private applyPadNavigationIndex(): void {
    const { navigationTarget, navigationIndex } = this.state.pads;
    if (navigationTarget === "voices") {
      const preset = this.voicesInCurrentBank()[navigationIndex];
      if (preset) this.state.synth.selectedSoundFontPresetId = preset.id;
    } else if (navigationTarget === "drum-kits") {
      const kit = this.sortedDrumKits()[navigationIndex];
      if (kit) this.state.pads.selectedDrumKitId = kit.id;
    } else {
      this.state.pads.samplePageIndex = navigationIndex;
    }
    this.updatePadNavigation(true);
  }

  private voicesInCurrentBank(): SoundFontPreset[] {
    const selected = this.state.synth.soundFontPresets.find(({ id }) => id === this.state.synth.selectedSoundFontPresetId);
    const bank = selected?.bank ?? 0;
    return this.state.synth.soundFontPresets
      .filter((preset) => preset.bank === bank)
      .sort((left, right) => left.program - right.program || left.name.localeCompare(right.name));
  }

  private sortedDrumKits(): DrumKit[] {
    return [...this.state.pads.drumKits]
      .sort((left, right) => left.bank - right.bank || left.program - right.program || left.name.localeCompare(right.name));
  }

  private clearAudio(): void {
    this.state.capture.error = null;
    this.state.capture.loopStart = 0;
    this.state.transport.origin = 0;
    this.state.capture.currentWaveform = [];
    this.state.capture.hasCurrentEvents = false;
    this.state.capture.staged = null;
    this.state.capture.previousStaged = null;
    this.state.promoted = [];
    this.deletedTake = null;
    this.state.canUndoDelete = false;
    this.state.transport.cycle = 0;
    this.state.transport.progress = 0;
    this.elapsedSeconds = 0;
    this.currentWaveform = emptyWaveform();
  }

  private findTake(id: string): Take | undefined {
    return this.state.promoted.find((take) => take.id === id);
  }

  private measureDurationSeconds(): number {
    return 60 / this.state.settings.bpm * this.state.settings.beatsPerMeasure;
  }

  private cycleDurationSeconds(): number {
    return this.measureDurationSeconds() * this.state.settings.loopMeasures;
  }

  private writeIntensity(start: number, end: number): void {
    const intensity = Math.min(1, Math.sqrt([...this.activeNotes.values()].reduce((sum, velocity) => sum + (velocity / 127) ** 2, 0)));
    const origin = this.state.transport.origin;
    const first = Math.floor((origin + start) * waveformBucketCount);
    const last = Math.floor((origin + Math.min(end, 1 - Number.EPSILON)) * waveformBucketCount);
    for (let index = first; index <= last; index += 1) {
      const bucket = index % waveformBucketCount;
      this.currentWaveform[bucket] = Math.max(this.currentWaveform[bucket] ?? 0, intensity);
    }
  }

  private publish(incrementRevision = true): void {
    if (incrementRevision) this.state.revision += 1;
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

function defaultParameterValues(instrument: InstrumentDescriptor): Record<string, number> {
  return Object.fromEntries(instrument.controls.map(({ id, defaultValue }) => [id, defaultValue]));
}

function emptyWaveform(): number[] {
  return Array.from({ length: waveformBucketCount }, () => 0);
}

function emptySamplePage(): SamplePad[] {
  return Array.from({ length: 8 }, () => null);
}
