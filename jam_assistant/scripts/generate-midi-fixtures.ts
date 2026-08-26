import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  writeMidi,
  type MidiData,
  type MidiEndOfTrackEvent,
  type MidiEvent,
  type MidiNoteOffEvent,
  type MidiNoteOnEvent,
  type MidiProgramChangeEvent,
  type MidiSetTempoEvent,
  type MidiTimeSignatureEvent,
} from "midi-file";
import {
  fixtureDurationBeats,
  MIDI_FIXTURES,
  MIDI_TICKS_PER_BEAT,
  midiNotesForChord,
  type MidiFixtureDefinition,
} from "../src/fixtures/midi-library";

const execFileAsync = promisify(execFile);
const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const outputDirectory = join(rootDirectory, "tests", "fixtures", "midi");
const manifestPath = join(outputDirectory, "manifest.json");
const soundFontPath = join(rootDirectory, "..", "soundfont_sm64.sf2");
await mkdir(outputDirectory, { recursive: true });

const manifest = [];
for (const fixture of MIDI_FIXTURES) {
  const midiPath = join(outputDirectory, `${fixture.id}.mid`);
  const wavPath = join(outputDirectory, `${fixture.id}.wav`);
  const mp3Path = join(outputDirectory, `${fixture.id}.mp3`);
  await writeFile(midiPath, Buffer.from(writeMidi(toMidiFile(fixture))));
  try {
    await execFileAsync("fluidsynth", [
      "-ni",
      "-R",
      "0",
      "-C",
      "0",
      soundFontPath,
      midiPath,
      "-F",
      wavPath,
      "-r",
      "44100",
    ]);
  } catch (error) {
    console.warn(`Could not render ${fixture.id}: ${String(error)}`);
  }
  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      wavPath,
      "-map_metadata",
      "-1",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      mp3Path,
    ]);
  } catch (error) {
    console.warn(`Could not encode ${fixture.id} as MP3: ${String(error)}`);
  }
  manifest.push({
    ...fixture,
    durationBeats: fixtureDurationBeats(fixture),
    durationSeconds: (fixtureDurationBeats(fixture) * 60) / fixture.tempoBpm,
    labels: fixture.events.map((event) => ({
      label: `${event.rootPitchClass}:${event.quality}`,
      startBeat: event.startBeat,
      durationBeats: event.durationBeats,
    })),
    midiFile: `${fixture.id}.mid`,
    wavFile: `${fixture.id}.wav`,
    mp3File: `${fixture.id}.mp3`,
  });
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${MIDI_FIXTURES.length} MIDI fixtures in ${outputDirectory}`);

function toMidiFile(fixture: MidiFixtureDefinition): MidiData {
  const tempoTrack: MidiEvent[] = [
    {
      deltaTime: 0,
      meta: true,
      type: "setTempo",
      microsecondsPerBeat: Math.round(60_000_000 / fixture.tempoBpm),
    } satisfies MidiSetTempoEvent,
    { deltaTime: 0, meta: true, type: "timeSignature", numerator: 4, denominator: 2, metronome: 24, thirtyseconds: 8 } satisfies MidiTimeSignatureEvent,
    { deltaTime: fixtureDurationBeats(fixture) * MIDI_TICKS_PER_BEAT, meta: true, type: "endOfTrack" } satisfies MidiEndOfTrackEvent,
  ];
  type AbsoluteNoteEvent = {
    readonly tick: number;
    readonly priority: number;
    readonly event: MidiNoteOnEvent | MidiNoteOffEvent;
  };
  const absoluteEvents: AbsoluteNoteEvent[] = fixture.events.flatMap((event) => {
    const startTick = event.startBeat * MIDI_TICKS_PER_BEAT;
    const endTick = (event.startBeat + event.durationBeats) * MIDI_TICKS_PER_BEAT;
    return midiNotesForChord(event).flatMap((noteNumber) => [
      { tick: startTick, priority: 1, event: { deltaTime: 0, channel: 0, type: "noteOn", noteNumber, velocity: 80 } satisfies MidiNoteOnEvent },
      { tick: endTick, priority: 0, event: { deltaTime: 0, channel: 0, type: "noteOff", noteNumber, velocity: 0 } satisfies MidiNoteOffEvent },
    ]);
  }).sort((left, right) => left.tick - right.tick || left.priority - right.priority);
  const noteTrack: MidiEvent[] = [
    { deltaTime: 0, channel: 0, type: "programChange", programNumber: 0 } satisfies MidiProgramChangeEvent,
    ...absoluteEvents.map((event, index, events) => ({
      ...event.event,
      deltaTime: event.tick - (index === 0 ? 0 : events[index - 1]?.tick ?? 0),
    })),
    { deltaTime: 0, meta: true, type: "endOfTrack" } satisfies MidiEndOfTrackEvent,
  ];
  return { header: { format: 1 as const, numTracks: 2, ticksPerBeat: MIDI_TICKS_PER_BEAT }, tracks: [tempoTrack, noteTrack] };
}
