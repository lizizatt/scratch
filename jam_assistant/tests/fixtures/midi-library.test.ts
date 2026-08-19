import { parseMidi } from "midi-file";
import {
  fixtureDurationBeats,
  fixtureLabels,
  MIDI_FIXTURES,
  midiNotesForChord,
  MIDI_TICKS_PER_BEAT,
} from "../../src/fixtures/midi-library";

describe("MIDI fixture library", () => {
  it("covers supported qualities, progression changes, and irregular durations", () => {
    expect(MIDI_FIXTURES).toHaveLength(4);
    expect(fixtureLabels(MIDI_FIXTURES[0]!)).toEqual([
      "C", "Cm", "C7", "Cmaj7", "Cm7", "Cdim", "Csus4",
    ]);
    expect(fixtureDurationBeats(MIDI_FIXTURES[3]!)).toBe(13);
    expect(midiNotesForChord(MIDI_FIXTURES[0]!.events[2]!)).toEqual([48, 52, 55, 58]);
  });

  it("uses durations and starts that are representable in MIDI ticks", () => {
    for (const fixture of MIDI_FIXTURES) {
      for (const event of fixture.events) {
        expect(Number.isInteger(event.startBeat * MIDI_TICKS_PER_BEAT)).toBe(true);
        expect(Number.isInteger(event.durationBeats * MIDI_TICKS_PER_BEAT)).toBe(true);
      }
    }
  });

  it("round-trips a generated MIDI file when the fixture command is run", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const path = new URL("./midi/quality-tour.mid", import.meta.url);
    if (!existsSync(path)) {
      return;
    }
    const midi = parseMidi(readFileSync(path));
    expect(midi.header.ticksPerBeat).toBe(MIDI_TICKS_PER_BEAT);
    expect(midi.tracks).toHaveLength(2);
    const noteEvents = midi.tracks[1]?.filter(
      (event) => event.type === "noteOn" || event.type === "noteOff",
    );
    expect(noteEvents?.some((event) => event.type === "noteOn")).toBe(true);
    expect(noteEvents?.some((event) => event.type === "noteOff")).toBe(true);
  });

  it("preserves each source event's note boundaries in generated MIDI", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    for (const fixture of MIDI_FIXTURES) {
      const path = new URL(`./midi/${fixture.id}.mid`, import.meta.url);
      if (!existsSync(path)) {
        return;
      }
      const midi = parseMidi(readFileSync(path));
      let tick = 0;
      const starts = new Map<number, number>();
      const ends = new Map<number, number>();
      for (const event of midi.tracks[1] ?? []) {
        tick += event.deltaTime;
        if (event.type === "noteOn") {
          starts.set(tick, (starts.get(tick) ?? 0) + 1);
        }
        if (event.type === "noteOff") {
          ends.set(tick, (ends.get(tick) ?? 0) + 1);
        }
      }
      for (const event of fixture.events) {
        const startTick = event.startBeat * MIDI_TICKS_PER_BEAT;
        const endTick =
          (event.startBeat + event.durationBeats) * MIDI_TICKS_PER_BEAT;
        expect(starts.get(startTick)).toBeGreaterThanOrEqual(3);
        expect(ends.get(endTick)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
