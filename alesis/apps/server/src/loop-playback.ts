import type { AudioOutput } from "@alesis/audio";
import type { MidiEvent } from "@alesis/engine";
import type { EngineSnapshot, Take } from "@alesis/protocol";

interface RecordedMidiEvent {
  position: number;
  event: MidiEvent;
}

interface AudibleTake {
  take: Take;
  channel: number;
}

const playbackChannels = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

export class MidiLoopScheduler {
  private recordings = new Map<string, RecordedMidiEvent[]>();
  private currentRecording: RecordedMidiEvent[] = [];
  private heldRecordingNotes = new Map<string, Extract<MidiEvent, { type: "note-on" }>>();
  private recordingCycle: number | null = null;
  private playbackCycle: number | null = null;
  private playbackPosition = -1;
  private activeNotes = new Map<string, { takeId: string; channel: number; note: number }>();
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
      if (snapshot.capture.staged) this.recordings.set(snapshot.capture.staged.id, this.currentRecording);
      this.currentRecording = [...this.heldRecordingNotes.values()].map((event) => ({ position: 0, event: structuredClone(event) }));
      this.recordingCycle = snapshot.transport.cycle;
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
    }
  }

  private releaseInactiveNotes(audibleTakeIds: Set<string>): void {
    for (const [key, note] of this.activeNotes) {
      if (audibleTakeIds.has(note.takeId)) continue;
      this.output.dispatchMidi({ type: "note-off", channel: note.channel, note: note.note });
      this.activeNotes.delete(key);
    }
  }

  private releaseAllNotes(): void {
    for (const note of this.activeNotes.values()) {
      this.output.dispatchMidi({ type: "note-off", channel: note.channel, note: note.note });
    }
    this.activeNotes.clear();
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
}

export function remapMidiEvent(event: MidiEvent, channel: number, level: number): MidiEvent {
  if (event.type === "note-on") {
    return { ...event, channel, velocity: Math.max(0, Math.min(127, Math.round(event.velocity * level))) };
  }
  return { ...event, channel };
}
