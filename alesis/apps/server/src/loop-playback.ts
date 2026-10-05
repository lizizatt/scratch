import type { AudioOutput } from "@alesis/audio";
import type { MidiEvent } from "@alesis/engine";
import type { EngineSnapshot, LoopSession, QuantizationMode, SessionTake, Take } from "@alesis/protocol";
import { isMappedDrumPadRelease } from "./sample-pads.js";

export interface RecordedMidiEvent {
  position: number;
  event: MidiEvent;
}

const subdivisionsPerBeat: Record<Exclude<QuantizationMode, "off">, number> = {
  "1/4": 1,
  "1/8": 2,
  "1/16": 4,
  "1/32": 8,
};

interface AudibleTake {
  take: Take;
  channel: number;
}

const playbackChannels = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14];

export class MidiLoopScheduler {
  private recordings = new Map<string, RecordedMidiEvent[]>();
  private rawRecordings = new Map<string, RecordedMidiEvent[]>();
  private appliedQuantization = new Map<string, QuantizationMode>();
  private retainedDeletedTakeId: string | null = null;
  private currentRecording: RecordedMidiEvent[] = [];
  private heldRecordingNotes = new Map<string, Extract<MidiEvent, { type: "note-on" }>>();
  private recordingControllers = new Map<string, MidiEvent>();
  private initializedRecordingChannels = new Set<number>();
  private capturedControllerKeys = new Set<string>();
  private carriedRecordingNotes = new Map<string, RecordedMidiEvent>();
  private recordingCycle: number | null = null;
  private playbackCycle: number | null = null;
  private playbackPosition = -1;
  private activeNotes = new Map<string, { takeId: string; channel: number; note: number }>();
  private activeBends = new Map<string, { takeId: string; channel: number; value: number }>();
  private activeSustains = new Map<string, { takeId: string; channel: number; value: number }>();
  private takeChannels = new Map<string, number>();

  constructor(private readonly output: AudioOutput) {}

  /** Next event or rollover on the authoritative cycle, including a newly audible opening. */
  nextPlaybackPosition(snapshot: EngineSnapshot): number {
    if (snapshot.transport.state !== "playing") return Infinity;
    if (this.playbackCycle !== snapshot.transport.cycle) return 0;
    let next = 1;
    for (const { take } of this.audibleTakes(snapshot)) {
      for (const recorded of this.recordings.get(take.id) ?? []) {
        if (recorded.position > this.playbackPosition) next = Math.min(next, recorded.position);
      }
    }
    return next;
  }

  record(event: MidiEvent, snapshot: EngineSnapshot, endsAtCycleBoundary = false): void {
    if (snapshot.transport.state === "playing") this.advanceRecordingCycle(snapshot);
    // This is delivered/routed state, including controls heard before Play/count-in.
    if (event.type === "pitch-bend" || event.type === "control-change" && event.controller === 64) {
      const key = `${event.channel}:${event.type}`;
      if (event.type === "pitch-bend" ? event.value === 0 : event.value < 64) this.recordingControllers.delete(key);
      else this.recordingControllers.set(key, structuredClone(event));
      if (snapshot.transport.state === "playing") this.capturedControllerKeys.add(key);
    }
    const noteKey = "note" in event ? `${event.channel}:${event.note}` : null;
    const release = event.type === "note-off" || event.type === "note-on" && event.velocity === 0;
    if (snapshot.transport.state !== "playing") return;
    if (event.type === "note-on" && event.velocity > 0) this.initializeRecordingChannel(event.channel, snapshot.transport.progress);
    const carried = noteKey ? this.carriedRecordingNotes.get(noteKey) : undefined;
    // An exact-boundary gate belongs to the preceding cycle, which already has
    // its terminal release. Do not turn its synthetic continuation into an attack.
    if (release && carried && (endsAtCycleBoundary || snapshot.transport.progress < 1e-9)) {
      this.currentRecording = this.currentRecording.filter((recorded) => recorded !== carried);
    } else {
      this.currentRecording.push({ position: snapshot.transport.progress, event: structuredClone(event) });
    }
    if (noteKey) this.carriedRecordingNotes.delete(noteKey);
    if (event.type === "note-on" && event.velocity > 0) this.heldRecordingNotes.set(noteKey!, structuredClone(event));
    if (noteKey && release) this.heldRecordingNotes.delete(noteKey);
  }

  update(snapshot: EngineSnapshot): void {
    if (snapshot.transport.state !== "playing") {
      this.releaseAllNotes();
      this.playbackCycle = null;
      this.playbackPosition = -1;
      if (snapshot.transport.state === "stopped") {
        this.discardCurrentRecording();
      }
      return;
    }

    this.advanceRecordingCycle(snapshot);

    if (snapshot.capture.staged) {
      const rawRecording = this.rawRecordings.get(snapshot.capture.staged.id);
      if (rawRecording && this.appliedQuantization.get(snapshot.capture.staged.id) !== snapshot.capture.quantization) {
        const totalBeats = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
        this.recordings.set(snapshot.capture.staged.id, quantizeRecording(rawRecording, snapshot.capture.quantization, totalBeats));
        this.appliedQuantization.set(snapshot.capture.staged.id, snapshot.capture.quantization);
      }
    }

    const audible = this.audibleTakes(snapshot);
    const cycleChanged = this.playbackCycle !== snapshot.transport.cycle;
    if (cycleChanged) this.releaseAllNotes();
    this.releaseInactiveNotes(new Set(audible.map(({ take }) => take.id)));

    const from = cycleChanged ? -1 : this.playbackPosition;
    const to = snapshot.transport.progress;
    for (const { take, channel } of audible) {
      const recording = this.recordings.get(take.id) ?? [];
      for (const recorded of recording) {
        if (recorded.position > from && recorded.position <= to) {
          this.dispatch(take.id, channel, take.level, recorded.event);
        }
      }
    }

    this.playbackCycle = snapshot.transport.cycle;
    this.playbackPosition = to;
    this.reconcileRecordings(snapshot);
  }

  markDeleted(takeId: string): void {
    if (this.retainedDeletedTakeId && this.retainedDeletedTakeId !== takeId) this.deleteRecording(this.retainedDeletedTakeId);
    this.retainedDeletedTakeId = takeId;
  }

  restoreDeleted(): void {
    this.retainedDeletedTakeId = null;
  }

  clearRecordings(): void {
    this.releaseAllNotes();
    this.recordings.clear();
    this.rawRecordings.clear();
    this.appliedQuantization.clear();
    this.takeChannels.clear();
    this.currentRecording = [];
    this.heldRecordingNotes.clear();
    this.initializedRecordingChannels.clear();
    this.capturedControllerKeys.clear();
    this.carriedRecordingNotes.clear();
    this.recordingCycle = null;
    this.playbackCycle = null;
    this.playbackPosition = -1;
    this.retainedDeletedTakeId = null;
  }

  hasCurrentRecording(): boolean {
    return this.currentRecording.length > 0 || this.heldRecordingNotes.size > 0;
  }

  /** Stop/clear discard captured audio, not controllers still applied live. */
  discardCurrentRecording(): void {
    this.currentRecording = [];
    this.heldRecordingNotes.clear();
    this.initializedRecordingChannels.clear();
    this.capturedControllerKeys.clear();
    this.carriedRecordingNotes.clear();
    this.recordingCycle = null;
  }

  /** Explicit host panic or session replacement invalidates delivered input state. */
  resetRecordingInput(): void {
    this.recordingControllers.clear();
    this.discardCurrentRecording();
  }

  /** Renderer replacement preserves physical holds; host panic clears them instead. */
  reapplyInputControllers(): void {
    for (const event of this.recordingControllers.values()) this.output.dispatchMidi(structuredClone(event));
  }

  storageStats(): { recordings: number; rawRecordings: number; channels: number } {
    return { recordings: this.recordings.size, rawRecordings: this.rawRecordings.size, channels: this.takeChannels.size };
  }

  exportRecordings(takeIds: readonly string[]): Map<string, RecordedMidiEvent[]> {
    return new Map(takeIds.flatMap((takeId) => {
      const recording = this.recordings.get(takeId);
      return recording ? [[takeId, structuredClone(recording)] as const] : [];
    }));
  }

  captureRecordings(snapshot: EngineSnapshot, takeIds: readonly string[]): Map<string, RecordedMidiEvent[]> {
    this.advanceRecordingCycle(snapshot);
    const staged = snapshot.capture.staged;
    if (staged && this.rawRecordings.has(staged.id)
      && this.appliedQuantization.get(staged.id) !== snapshot.capture.quantization) {
      const totalBeats = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
      this.recordings.set(staged.id, quantizeRecording(this.rawRecordings.get(staged.id)!, snapshot.capture.quantization, totalBeats));
      this.appliedQuantization.set(staged.id, snapshot.capture.quantization);
    }
    return this.exportRecordings(takeIds);
  }

  captureSessionTakes(snapshot: EngineSnapshot): Pick<LoopSession, "staged" | "previousStaged" | "promoted"> {
    this.captureRecordings(snapshot, []);
    const capture = (take: Take): SessionTake => {
      const recording = this.recordings.get(take.id);
      if (!recording) throw new Error(`Missing MIDI recording for take ${take.id}; session was not saved`);
      return { take: structuredClone(take), recording: structuredClone(recording) };
    };
    const staged = snapshot.capture.staged;
    const raw = staged ? this.rawRecordings.get(staged.id) : null;
    if (staged && !raw) throw new Error(`Missing raw MIDI recording for staged take ${staged.id}`);
    return {
      staged: staged ? { ...capture(staged), rawRecording: structuredClone(raw!) } : null,
      previousStaged: snapshot.capture.previousStaged ? capture(snapshot.capture.previousStaged) : null,
      promoted: snapshot.promoted.map(capture),
    };
  }

  prepareSessionRestore(session: LoopSession): () => void {
    const recordings = new Map([session.staged, session.previousStaged, ...session.promoted]
      .filter((take) => take !== null).map(({ take, recording }) => [take.id, structuredClone(recording)]));
    const raw = new Map<string, RecordedMidiEvent[]>();
    const applied = new Map<string, QuantizationMode>();
    if (session.staged) {
      raw.set(session.staged.take.id, structuredClone(session.staged.rawRecording));
      applied.set(session.staged.take.id, session.quantization);
    }
    return () => {
      // Host has stopped/panicked the old output; this commit performs no fallible I/O.
      this.activeNotes.clear();
      this.activeBends.clear();
      this.activeSustains.clear();
      this.recordings = recordings;
      this.rawRecordings = raw;
      this.appliedQuantization = applied;
      this.takeChannels.clear();
      this.resetRecordingInput();
      this.playbackCycle = null;
      this.playbackPosition = -1;
      this.retainedDeletedTakeId = null;
    };
  }

  private advanceRecordingCycle(snapshot: EngineSnapshot): void {
    if (snapshot.transport.state !== "playing") return;
    if (this.recordingCycle === null) {
      this.recordingCycle = snapshot.transport.cycle;
      this.seedRecording();
      return;
    }
    if (snapshot.transport.cycle === this.recordingCycle) return;
    for (const note of this.heldRecordingNotes.values()) {
      this.currentRecording.push({ position: 1, event: { type: "note-off", channel: note.channel, note: note.note } });
    }
    const completedTake = [snapshot.capture.staged, snapshot.capture.previousStaged]
      .find((take) => take?.cycle === this.recordingCycle);
    if (completedTake) {
      const totalBeats = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
      const rawRecording = structuredClone(this.currentRecording);
      this.rawRecordings.set(completedTake.id, rawRecording);
      this.recordings.set(completedTake.id, quantizeRecording(rawRecording, snapshot.capture.quantization, totalBeats));
      this.appliedQuantization.set(completedTake.id, snapshot.capture.quantization);
    }
    this.seedRecording();
    this.recordingCycle = snapshot.transport.cycle;
  }

  private seedRecording(): void {
    this.carriedRecordingNotes = new Map([...this.heldRecordingNotes].map(([key, event]) => [key, { position: 0, event: structuredClone(event) }]));
    this.currentRecording = [];
    this.initializedRecordingChannels.clear();
    this.capturedControllerKeys.clear();
    for (const { event } of this.carriedRecordingNotes.values()) this.initializeRecordingChannel(event.channel, 0);
    this.currentRecording.push(...this.carriedRecordingNotes.values());
  }

  private initializeRecordingChannel(channel: number, position: number): void {
    if (this.initializedRecordingChannels.has(channel)) return;
    this.initializedRecordingChannels.add(channel);
    // Melodic channels collapse onto one playback channel. An unused channel's
    // remembered controls must not override the state of the actual performance.
    for (const [key, event] of this.recordingControllers) {
      if (event.channel !== channel || this.capturedControllerKeys.has(key)) continue;
      this.currentRecording.push({ position: position < 1e-9 ? 0 : position, event: structuredClone(event) });
      this.capturedControllerKeys.add(key);
    }
  }

  private audibleTakes(snapshot: EngineSnapshot): AudibleTake[] {
    if (snapshot.monitorOnly) return [];
    const takes = [
      ...(snapshot.capture.staged && snapshot.capture.stagedAudible ? [snapshot.capture.staged] : []),
      ...snapshot.promoted.filter((take) => !take.muted),
    ];
    return takes.map((take) => ({ take, channel: this.channelFor(take.id) }));
  }

  private dispatch(takeId: string, channel: number, level: number, event: MidiEvent): void {
    const remapped = remapMidiEvent(event, channel, level);
    if (!isMappedDrumPadRelease(remapped)) this.output.dispatchMidi(remapped);
    if (remapped.type === "note-on" && remapped.velocity > 0) {
      this.activeNotes.set(`${takeId}:${event.channel}:${remapped.note}`, { takeId, channel, note: remapped.note });
    } else if (remapped.type === "note-off" || (remapped.type === "note-on" && remapped.velocity === 0)) {
      this.activeNotes.delete(`${takeId}:${event.channel}:${remapped.note}`);
    } else if (remapped.type === "pitch-bend") {
      const key = `${takeId}:${event.channel}`;
      if (remapped.value === 0) this.activeBends.delete(key);
      else this.activeBends.set(key, { takeId, channel: remapped.channel, value: remapped.value });
    } else if (remapped.type === "control-change" && remapped.controller === 64) {
      const key = `${takeId}:${event.channel}`;
      if (remapped.value < 64) this.activeSustains.delete(key);
      else this.activeSustains.set(key, { takeId, channel: remapped.channel, value: remapped.value });
    }
  }

  private releaseInactiveNotes(audibleTakeIds: Set<string>): void {
    for (const [key, note] of this.activeNotes) {
      if (audibleTakeIds.has(note.takeId)) continue;
      const release = { type: "note-off" as const, channel: note.channel, note: note.note };
      if (!isMappedDrumPadRelease(release)) this.output.dispatchMidi(release);
      this.activeNotes.delete(key);
    }
    for (const [key, bend] of this.activeBends) {
      if (audibleTakeIds.has(bend.takeId)) continue;
      this.activeBends.delete(key);
      const remaining = [...this.activeBends.values()].find((candidate) => candidate.channel === bend.channel && audibleTakeIds.has(candidate.takeId));
      this.output.dispatchMidi({ type: "pitch-bend", channel: bend.channel, value: remaining?.value ?? 0 });
    }
    for (const [key, sustain] of this.activeSustains) {
      if (audibleTakeIds.has(sustain.takeId)) continue;
      this.activeSustains.delete(key);
      const remaining = [...this.activeSustains.values()].find((candidate) => candidate.channel === sustain.channel && audibleTakeIds.has(candidate.takeId));
      this.output.dispatchMidi({ type: "control-change", channel: sustain.channel, controller: 64, value: remaining?.value ?? 0 });
    }
  }

  private releaseAllNotes(): void {
    for (const note of this.activeNotes.values()) {
      const release = { type: "note-off" as const, channel: note.channel, note: note.note };
      if (!isMappedDrumPadRelease(release)) this.output.dispatchMidi(release);
    }
    this.activeNotes.clear();
    for (const channel of new Set([...this.activeBends.values()].map(({ channel }) => channel))) {
      this.output.dispatchMidi({ type: "pitch-bend", channel, value: 0 });
    }
    this.activeBends.clear();
    for (const channel of new Set([...this.activeSustains.values()].map(({ channel }) => channel))) {
      this.output.dispatchMidi({ type: "control-change", channel, controller: 64, value: 0 });
    }
    this.activeSustains.clear();
  }

  private channelFor(takeId: string): number {
    const assigned = this.takeChannels.get(takeId);
    if (assigned !== undefined) return assigned;
    const used = new Set(this.takeChannels.values());
    const channel = playbackChannels.find((candidate) => !used.has(candidate))
      ?? playbackChannels[this.takeChannels.size % playbackChannels.length]!;
    this.takeChannels.set(takeId, channel);
    return channel;
  }

  private reconcileRecordings(snapshot: EngineSnapshot): void {
    const retainedIds = new Set([
      snapshot.capture.staged?.id,
      snapshot.capture.previousStaged?.id,
      ...snapshot.promoted.map(({ id }) => id),
      this.retainedDeletedTakeId,
    ].filter((id): id is string => id !== null && id !== undefined));
    for (const id of this.recordings.keys()) if (!retainedIds.has(id)) this.deleteRecording(id);
    for (const id of this.rawRecordings.keys()) if (id !== snapshot.capture.staged?.id) this.rawRecordings.delete(id);
    for (const id of this.appliedQuantization.keys()) if (id !== snapshot.capture.staged?.id) this.appliedQuantization.delete(id);
  }

  private deleteRecording(takeId: string): void {
    this.recordings.delete(takeId);
    this.rawRecordings.delete(takeId);
    this.appliedQuantization.delete(takeId);
    this.takeChannels.delete(takeId);
  }
}

export function remapMidiEvent(event: MidiEvent, channel: number, level: number): MidiEvent {
  const outputChannel = event.channel === 9 ? 9 : channel;
  if (event.type === "note-on") {
    return { ...event, channel: outputChannel, velocity: Math.max(0, Math.min(127, Math.round(event.velocity * level))) };
  }
  if (event.type === "pitch-bend") return { ...event, channel: outputChannel, value: Math.max(-1, Math.min(1, event.value)) };
  return { ...event, channel: outputChannel };
}

export function quantizeRecording(recording: RecordedMidiEvent[], mode: QuantizationMode, totalBeats: number): RecordedMidiEvent[] {
  if (mode === "off") return structuredClone(recording);
  const gridSize = totalBeats * subdivisionsPerBeat[mode];
  type QuantizedEvent = RecordedMidiEvent & { order: number; attack?: number };
  const candidates: QuantizedEvent[] = [];
  const survivingAttacks = new Map<string, number>();
  const activeNoteBins = new Map<string, { bin: number; order: number }>();
  recording.forEach(({ position, event }, order) => {
    const terminalRelease = position === 1 && (event.type === "note-off" || event.type === "note-on" && event.velocity === 0);
    const absoluteBin = Math.round(position * gridSize);
    let bin = terminalRelease ? gridSize : absoluteBin % gridSize;
    let attack: number | undefined;
    if (event.type === "note-on" && event.velocity > 0) {
      attack = order;
      activeNoteBins.set(`${event.channel}:${event.note}`, { bin: absoluteBin, order });
      survivingAttacks.set(`${bin}:${eventIdentity(event)}`, order);
    }
    if (event.type === "note-off" || event.type === "note-on" && event.velocity === 0) {
      const key = `${event.channel}:${event.note}`;
      const onset = activeNoteBins.get(key);
      if (onset !== undefined) {
        attack = onset.order;
        // Wrap the pair together: an end release stays at 1 unless its attack
        // also crossed the seam. Keep ownership until losing pairs are removed.
        bin = absoluteBin - (onset.bin >= gridSize ? gridSize : 0);
        const attackBin = onset.bin % gridSize;
        if (bin === attackBin || gridSize === 1 && !terminalRelease) {
          bin = attackBin < gridSize - 1 ? attackBin + 1 : attackBin + 0.5;
        }
      }
      activeNoteBins.delete(key);
    }
    candidates.push({ position: bin / gridSize, event: structuredClone(event), order, ...(attack === undefined ? {} : { attack }) });
  });
  const retained = new Set(survivingAttacks.values());
  const deduplicated = new Map<string, QuantizedEvent>();
  for (const item of candidates) {
    if (item.attack !== undefined && !retained.has(item.attack)) continue;
    const release = item.event.type === "note-off" || item.event.type === "note-on" && item.event.velocity === 0;
    deduplicated.set(`${item.position}:${eventIdentity(item.event)}:${release}`, item);
  }
  const quantized = [...deduplicated.values()];
  const attackOrder = (event: MidiEvent): number => event.type === "note-on" && event.velocity > 0 ? 1 : 0;
  return quantized
    // A prior gate ending on a new attack's bin must release before that attack.
    .sort((left, right) => left.position - right.position || attackOrder(left.event) - attackOrder(right.event) || left.order - right.order)
    .map(({ position, event }) => ({ position, event }));
}

/** Exact v1 pre-pair-quantizer representation; validation only, never new capture. */
export function matchesLegacyQuantization(recording: RecordedMidiEvent[], raw: RecordedMidiEvent[], mode: QuantizationMode, totalBeats: number): boolean {
  if (mode === "off") return JSON.stringify(recording) === JSON.stringify(raw);
  const gridSize = totalBeats * subdivisionsPerBeat[mode];
  const deduplicated = new Map<string, RecordedMidiEvent & { order: number }>();
  raw.forEach(({ position, event }, order) => {
    const terminalRelease = position === 1 && (event.type === "note-off" || event.type === "note-on" && event.velocity === 0);
    const bin = terminalRelease ? gridSize : Math.round(position * gridSize) % gridSize;
    deduplicated.set(`${bin}:${eventIdentity(event)}`, { position: bin / gridSize, event: structuredClone(event), order });
  });
  const quantized = [...deduplicated.values()];
  const activeNoteBins = new Map<string, number>();
  for (const item of quantized.sort((left, right) => left.order - right.order)) {
    const event = item.event;
    if (event.type === "note-on" && event.velocity > 0) activeNoteBins.set(`${event.channel}:${event.note}`, Math.round(item.position * gridSize));
    if (event.type === "note-off" || event.type === "note-on" && event.velocity === 0) {
      const key = `${event.channel}:${event.note}`;
      const noteOnBin = activeNoteBins.get(key);
      const noteOffBin = Math.round(item.position * gridSize);
      if (noteOnBin !== undefined && noteOffBin === noteOnBin) {
        item.position = noteOffBin < gridSize - 1 ? (noteOffBin + 1) / gridSize : (noteOffBin + 0.5) / gridSize;
      }
      activeNoteBins.delete(key);
    }
  }
  const legacy = quantized.sort((left, right) => left.position - right.position || left.order - right.order)
    .map(({ position, event }) => ({ position, event }));
  return JSON.stringify(recording) === JSON.stringify(legacy);
}

function eventIdentity(event: MidiEvent): string {
  switch (event.type) {
    case "note-on": return `${event.type}:${event.channel}:${event.note}`;
    case "note-off": return `${event.type}:${event.channel}:${event.note}`;
    case "control-change": return `${event.type}:${event.channel}:${event.controller}`;
    case "pitch-bend": return `${event.type}:${event.channel}`;
    case "channel-pressure": return `${event.type}:${event.channel}`;
  }
}
