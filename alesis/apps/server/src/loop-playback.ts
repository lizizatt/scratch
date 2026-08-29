import type { AudioOutput } from "@alesis/audio";
import type { MidiEvent } from "@alesis/engine";
import type { EngineSnapshot, QuantizationMode, Take } from "@alesis/protocol";

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
  private recordingCycle: number | null = null;
  private playbackCycle: number | null = null;
  private playbackPosition = -1;
  private activeNotes = new Map<string, { takeId: string; channel: number; note: number }>();
  private activeBends = new Map<string, { takeId: string; channel: number; value: number }>();
  private takeChannels = new Map<string, number>();

  constructor(private readonly output: AudioOutput) {}

  record(event: MidiEvent, snapshot: EngineSnapshot): void {
    if (snapshot.transport.state !== "playing") return;
    if (this.recordingCycle !== snapshot.transport.cycle) {
      this.currentRecording = [];
      this.recordingCycle = snapshot.transport.cycle;
    }
    this.currentRecording.push({ position: snapshot.transport.progress, event: structuredClone(event) });
    const noteKey = "note" in event ? `${event.channel}:${event.note}` : null;
    if (event.type === "note-on" && event.velocity > 0) this.heldRecordingNotes.set(noteKey!, structuredClone(event));
    if (noteKey && (event.type === "note-off" || (event.type === "note-on" && event.velocity === 0))) this.heldRecordingNotes.delete(noteKey);
  }

  update(snapshot: EngineSnapshot): void {
    if (snapshot.transport.state !== "playing") {
      this.releaseAllNotes();
      this.playbackCycle = null;
      this.playbackPosition = -1;
      if (snapshot.transport.state === "stopped") {
        this.currentRecording = [];
        this.heldRecordingNotes.clear();
        this.recordingCycle = null;
      }
      return;
    }

    if (this.recordingCycle === null) this.recordingCycle = snapshot.transport.cycle;
    if (snapshot.transport.cycle !== this.recordingCycle) {
      for (const note of this.heldRecordingNotes.values()) {
        this.currentRecording.push({ position: 1, event: { type: "note-off", channel: note.channel, note: note.note } });
      }
      if (snapshot.capture.staged) {
        const totalBeats = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
        const rawRecording = structuredClone(this.currentRecording);
        this.rawRecordings.set(snapshot.capture.staged.id, rawRecording);
        this.recordings.set(snapshot.capture.staged.id, quantizeRecording(rawRecording, snapshot.capture.quantization, totalBeats));
        this.appliedQuantization.set(snapshot.capture.staged.id, snapshot.capture.quantization);
      }
      this.currentRecording = [...this.heldRecordingNotes.values()].map((event) => ({ position: 0, event: structuredClone(event) }));
      this.recordingCycle = snapshot.transport.cycle;
    }

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
    this.recordingCycle = null;
    this.playbackCycle = null;
    this.playbackPosition = -1;
    this.retainedDeletedTakeId = null;
  }

  storageStats(): { recordings: number; rawRecordings: number; channels: number } {
    return { recordings: this.recordings.size, rawRecordings: this.rawRecordings.size, channels: this.takeChannels.size };
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
    this.output.dispatchMidi(remapped);
    if (remapped.type === "note-on" && remapped.velocity > 0) {
      this.activeNotes.set(`${takeId}:${event.channel}:${remapped.note}`, { takeId, channel, note: remapped.note });
    } else if (remapped.type === "note-off" || (remapped.type === "note-on" && remapped.velocity === 0)) {
      this.activeNotes.delete(`${takeId}:${event.channel}:${remapped.note}`);
    } else if (remapped.type === "pitch-bend") {
      const key = `${takeId}:${event.channel}`;
      if (remapped.value === 0) this.activeBends.delete(key);
      else this.activeBends.set(key, { takeId, channel: remapped.channel, value: remapped.value });
    }
  }

  private releaseInactiveNotes(audibleTakeIds: Set<string>): void {
    for (const [key, note] of this.activeNotes) {
      if (audibleTakeIds.has(note.takeId)) continue;
      this.output.dispatchMidi({ type: "note-off", channel: note.channel, note: note.note });
      this.activeNotes.delete(key);
    }
    for (const [key, bend] of this.activeBends) {
      if (audibleTakeIds.has(bend.takeId)) continue;
      this.activeBends.delete(key);
      const remaining = [...this.activeBends.values()].find((candidate) => candidate.channel === bend.channel && audibleTakeIds.has(candidate.takeId));
      this.output.dispatchMidi({ type: "pitch-bend", channel: bend.channel, value: remaining?.value ?? 0 });
    }
  }

  private releaseAllNotes(): void {
    for (const note of this.activeNotes.values()) {
      this.output.dispatchMidi({ type: "note-off", channel: note.channel, note: note.note });
    }
    this.activeNotes.clear();
    for (const channel of new Set([...this.activeBends.values()].map(({ channel }) => channel))) {
      this.output.dispatchMidi({ type: "pitch-bend", channel, value: 0 });
    }
    this.activeBends.clear();
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
  const deduplicated = new Map<string, RecordedMidiEvent & { order: number }>();
  recording.forEach(({ position, event }, order) => {
    const bin = Math.round(position * gridSize) % gridSize;
    const quantized = bin / gridSize;
    const key = `${bin}:${eventIdentity(event)}`;
    deduplicated.set(key, { position: quantized, event: structuredClone(event), order });
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
  return quantized
    .sort((left, right) => left.position - right.position || left.order - right.order)
    .map(({ position, event }) => ({ position, event }));
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
