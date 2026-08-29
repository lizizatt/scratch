import {
  PROTOCOL_VERSION,
  engineSnapshotSchema,
  type EngineCommand,
  type EngineSnapshot,
  type InstrumentDescriptor,
  type SoundFont,
  type SoundFontPreset,
  type Take,
} from "@alesis/protocol";

export type MidiEvent =
  | { type: "note-on"; channel: number; note: number; velocity: number }
  | { type: "note-off"; channel: number; note: number }
  | { type: "pitch-bend"; channel: number; value: number }
  | { type: "control-change"; channel: number; controller: number; value: number }
  | { type: "channel-pressure"; channel: number; value: number };

export interface EngineResult {
  accepted: boolean;
  revision: number;
  appliedCycle: number;
  error?: string;
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
      { id: "chorus-send", label: "Chorus Send", kind: "range", group: "effects", advanced: false, defaultValue: 0.12, minimum: 0, maximum: 0.5, step: 0.005, unit: "%" },
      { id: "reverb-send", label: "Reverb Send", kind: "range", group: "effects", advanced: false, defaultValue: 0.24, minimum: 0, maximum: 0.5, step: 0.005, unit: "%" },
      { id: "chorus-rate", label: "Chorus Rate", kind: "range", group: "effects", advanced: true, defaultValue: 0.3, minimum: 0.2, maximum: 2, step: 0.01, unit: "Hz" },
      { id: "chorus-depth", label: "Chorus Depth", kind: "range", group: "effects", advanced: true, defaultValue: 8, minimum: 0, maximum: 20, step: 0.1, unit: "ms" },
      { id: "chorus-voices", label: "Chorus Voices", kind: "range", group: "effects", advanced: true, defaultValue: 3, minimum: 0, maximum: 8, step: 1, unit: "" },
      { id: "reverb-room", label: "Room Size", kind: "range", group: "effects", advanced: true, defaultValue: 0.2, minimum: 0, maximum: 1, step: 0.005, unit: "%" },
      { id: "reverb-damping", label: "Damping", kind: "range", group: "effects", advanced: true, defaultValue: 0, minimum: 0, maximum: 1, step: 0.005, unit: "%" },
      { id: "reverb-width", label: "Stereo Width", kind: "range", group: "effects", advanced: true, defaultValue: 0.5, minimum: 0, maximum: 1, step: 0.005, unit: "%" },
    ],
  },
];

const waveformBucketCount = 96;

interface DeletedTake {
  take: Take;
  index: number;
}

export interface SimulatedHostEngineOptions {
  soundFonts?: SoundFont[];
  selectedSoundFontId?: string | null;
  soundFontPresets?: SoundFontPreset[];
  selectedSoundFontPresetId?: string | null;
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
      arpeggiator: { enabled: false, mode: "up", rate: "1/8", octaves: 1, gate: 0.5, latch: false, swing: 0 },
      drums: { enabled: false, pattern: "four-on-floor", volume: 0.7 },
      capture: { currentWaveform: [], staged: null, stagedAudible: true },
      promoted: [],
      canUndoDelete: false,
    });
  }

  snapshot(): EngineSnapshot {
    return structuredClone(this.state);
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
    if (this.state.transport.state === "playing") this.writeIntensity(this.state.transport.progress, this.state.transport.progress);
    this.state.engine.midiEventsReceived += 1;
    this.state.engine.lastMidiEvent = event.type;
    this.publish();
  }

  async execute(command: EngineCommand): Promise<EngineResult> {
    const result = this.applyCommand(command);
    if (result.accepted) this.publish();
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
    this.state.revision += 1;
    this.publish(false);
    return { accepted: true, revision: this.state.revision, appliedCycle: this.state.transport.cycle };
  }

  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("advance requires nonnegative finite seconds");
    if (this.state.transport.state === "counting-in") {
      const countInDuration = this.measureDurationSeconds();
      const consumed = Math.min(seconds, this.countInSecondsRemaining);
      this.countInSecondsRemaining -= consumed;
      seconds -= consumed;
      this.state.transport.progress = 1 - this.countInSecondsRemaining / countInDuration;
      if (this.countInSecondsRemaining === 0) {
        this.state.transport.state = "playing";
        this.state.transport.progress = 0;
      }
    }
    if (this.state.transport.state !== "playing") {
      this.publish(false);
      return;
    }

    const duration = this.cycleDurationSeconds();
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
    this.publish(false);
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
      case "stop":
        this.state.transport.state = "stopped";
        this.state.transport.progress = 0;
        this.state.capture.currentWaveform = [];
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
        const hasAudio = this.state.capture.staged !== null || this.state.promoted.length > 0;
        if (timingChanged && hasAudio && !command.clearAudio) return reject("Timing changes require clearAudio while takes exist");
        if (timingChanged && command.clearAudio) this.clearAudio();
        const settings = command.settings;
        if (settings.bpm !== undefined) this.state.settings.bpm = settings.bpm;
        if (settings.beatsPerMeasure !== undefined) this.state.settings.beatsPerMeasure = settings.beatsPerMeasure;
        if (settings.loopMeasures !== undefined) this.state.settings.loopMeasures = settings.loopMeasures;
        if (settings.midiInputId !== undefined) this.state.settings.midiInputId = settings.midiInputId;
        if (settings.audioOutputId !== undefined) this.state.settings.audioOutputId = settings.audioOutputId;
        if (settings.metronomeEnabled !== undefined) this.state.settings.metronomeEnabled = settings.metronomeEnabled;
        if (settings.metronomeVolume !== undefined) this.state.settings.metronomeVolume = settings.metronomeVolume;
        if (settings.countInEnabled !== undefined) this.state.settings.countInEnabled = settings.countInEnabled;
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
        break;
      case "select-soundfont-preset":
        if (!this.state.synth.soundFontPresets.some(({ id }) => id === command.presetId)) return reject(`Unknown SoundFont preset: ${command.presetId}`);
        this.state.synth.selectedSoundFontPresetId = command.presetId;
        break;
      case "refresh-soundfonts":
        return reject("SoundFont refresh requires the host catalog");
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
      case "promote-staged":
        if (!this.state.capture.staged) return reject("No staged take to promote");
        this.state.promoted.push(this.state.capture.staged);
        this.state.capture.staged = null;
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
    }

    this.state.revision += 1;
    return { accepted: true, revision: this.state.revision, appliedCycle: this.state.transport.cycle };
  }

  private rollover(): void {
    const completedCycle = this.state.transport.cycle;
    this.state.capture.staged = {
      id: `take-${this.nextTakeId++}`,
      cycle: completedCycle,
      level: 0.8,
      muted: !this.state.capture.stagedAudible,
      waveform: [...this.currentWaveform],
    };
    this.currentWaveform = emptyWaveform();
    this.state.transport.cycle += 1;
    this.state.revision += 1;
  }

  private clearAudio(): void {
    this.state.capture.currentWaveform = [];
    this.state.capture.staged = null;
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
    const first = Math.min(waveformBucketCount - 1, Math.floor(start * waveformBucketCount));
    const last = Math.min(waveformBucketCount - 1, Math.floor(end * waveformBucketCount));
    for (let index = first; index <= last; index += 1) {
      this.currentWaveform[index] = Math.max(this.currentWaveform[index] ?? 0, intensity);
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
