import {
  PROTOCOL_VERSION,
  engineSnapshotSchema,
  type EngineCommand,
  type EngineSnapshot,
  type SynthParameter,
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

const subtractiveParameters: SynthParameter[] = [
  { id: "cutoff", label: "Cutoff", value: 6_300, minimum: 40, maximum: 18_000, unit: "Hz" },
  { id: "resonance", label: "Resonance", value: 0.42, minimum: 0, maximum: 1, unit: "%" },
  { id: "attack", label: "Attack", value: 0.024, minimum: 0.001, maximum: 3, unit: "s" },
  { id: "release", label: "Release", value: 1.8, minimum: 0.01, maximum: 8, unit: "s" },
  { id: "lfo-rate", label: "LFO Rate", value: 3.2, minimum: 0.05, maximum: 20, unit: "Hz" },
  { id: "drive", label: "Drive", value: 0.18, minimum: 0, maximum: 1, unit: "%" },
];

const soundfontParameters: SynthParameter[] = [
  { id: "bank", label: "Bank", value: 0, minimum: 0, maximum: 127, unit: "" },
  { id: "program", label: "Program", value: 0, minimum: 0, maximum: 127, unit: "" },
  { id: "gain", label: "Gain", value: 0.72, minimum: 0, maximum: 1, unit: "%" },
  { id: "chorus", label: "Chorus", value: 0.12, minimum: 0, maximum: 1, unit: "%" },
  { id: "reverb", label: "Reverb", value: 0.36, minimum: 0, maximum: 1, unit: "%" },
];

const synthParameters = new Map([
  ["subtractive", subtractiveParameters],
  ["soundfont", soundfontParameters],
]);

interface DeletedTake {
  take: Take;
  index: number;
}

export class SimulatedHostEngine implements HostEngine {
  private state: EngineSnapshot;
  private listeners = new Set<EngineListener>();
  private activeNotes = new Set<number>();
  private elapsedSeconds = 0;
  private countInSecondsRemaining = 0;
  private deletedTake: DeletedTake | null = null;
  private nextTakeId = 1;

  constructor() {
    this.state = engineSnapshotSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      revision: 0,
      engine: { mode: "simulated", midiConnected: true, audioConnected: true },
      settings: {
        bpm: 118,
        beatsPerMeasure: 4,
        loopMeasures: 4,
        midiInputId: "software-vortex",
        audioOutputId: "simulated-output",
        metronomeEnabled: true,
        metronomeVolume: 0.3,
        countInEnabled: true,
      },
      transport: { state: "stopped", cycle: 0, progress: 0 },
      monitorOnly: false,
      synth: {
        selectedId: "subtractive",
        available: [
          { id: "subtractive", name: "Neon Pressure" },
          { id: "soundfont", name: "SoundFont Player" },
        ],
        parameters: subtractiveParameters,
      },
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
    if (event.type === "note-on" && event.velocity > 0) this.activeNotes.add(event.note);
    if (event.type === "note-off" || (event.type === "note-on" && event.velocity === 0)) this.activeNotes.delete(event.note);
  }

  async execute(command: EngineCommand): Promise<EngineResult> {
    const result = this.applyCommand(command);
    if (result.accepted) this.publish();
    return result;
  }

  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("advance requires nonnegative finite seconds");
    if (this.state.transport.state === "counting-in") {
      const consumed = Math.min(seconds, this.countInSecondsRemaining);
      this.countInSecondsRemaining -= consumed;
      seconds -= consumed;
      if (this.countInSecondsRemaining === 0) this.state.transport.state = "playing";
    }
    if (this.state.transport.state !== "playing") {
      return;
    }

    const duration = this.cycleDurationSeconds();
    this.elapsedSeconds += seconds;
    while (this.elapsedSeconds >= duration) {
      this.elapsedSeconds -= duration;
      this.rollover();
    }
    this.state.transport.progress = this.elapsedSeconds / duration;
    this.state.capture.currentWaveform = this.createWaveform(this.state.transport.cycle, this.state.transport.progress);
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
        const parameters = synthParameters.get(command.synthId);
        if (!parameters) return reject(`Unknown synth: ${command.synthId}`);
        this.state.synth.selectedId = command.synthId;
        this.state.synth.parameters = structuredClone(parameters);
        break;
      }
      case "set-synth-parameter": {
        const parameter = this.state.synth.parameters.find(({ id }) => id === command.parameterId);
        if (!parameter) return reject(`Unknown parameter: ${command.parameterId}`);
        if (command.value < parameter.minimum || command.value > parameter.maximum) return reject(`Parameter out of range: ${command.parameterId}`);
        parameter.value = command.value;
        break;
      }
      case "set-staged-audible":
        this.state.capture.stagedAudible = command.audible;
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
      waveform: this.createWaveform(completedCycle, 1),
    };
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

  private createWaveform(cycle: number, progress: number): number[] {
    const amplitude = this.activeNotes.size > 0 ? 0.82 : 0.28;
    return Array.from({ length: 96 }, (_, index) => {
      const envelope = Math.min(1, progress * 6 + 0.15);
      return Math.max(-1, Math.min(1, Math.sin(index * 0.31 + cycle * 0.7) * amplitude * envelope));
    });
  }

  private publish(incrementRevision = true): void {
    if (incrementRevision) this.state.revision += 1;
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
