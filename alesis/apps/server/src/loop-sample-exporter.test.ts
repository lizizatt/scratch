import { existsSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SampleLibrary } from "@alesis/audio";
import { SimulatedHostEngine } from "@alesis/engine";
import type { EngineSnapshot, Take } from "@alesis/protocol";
import { parseMidi } from "midi-file";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedMidiEvent } from "./loop-playback.js";
import { exportLoopSample, makeDrumRecording } from "./loop-sample-exporter.js";
import { recordingToMidi } from "./mp3-exporter.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, link: vi.fn(actual.link), rm: vi.fn(actual.rm) };
});

const noteRecording: RecordedMidiEvent[] = [
  { position: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 112 } },
  { position: 0.99, event: { type: "note-off", channel: 0, note: 60 } },
];

function testTake(id: string, overrides: Partial<Take> = {}): Take {
  return { id, cycle: 0, level: 0.8, muted: false, waveform: [], ...overrides };
}

async function playingSnapshot(): Promise<EngineSnapshot> {
  const engine = new SimulatedHostEngine();
  await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
  await engine.execute({ type: "play" });
  const snapshot = engine.snapshot();
  snapshot.synth.selectedId = "subtractive";
  snapshot.synth.parameterValues = { attack: 0.01, release: 0.2, cutoff: 6_300, resonance: 0.2 };
  return snapshot;
}

async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "alesis-loop-sample-test-"));
}

describe("loop sample exporter", () => {
  beforeEach(() => {
    vi.mocked(fsPromises.link).mockClear();
    vi.mocked(fsPromises.rm).mockClear();
  });

  it("selects audible staged and promoted takes, respecting mute, level, and staged-audible state", async () => {
    const root = await temporaryRoot();
    try {
      const snapshot = await playingSnapshot();
      snapshot.capture.staged = testTake("staged");
      snapshot.capture.stagedAudible = true;
      snapshot.promoted = [
        testTake("muted", { muted: true }),
        testTake("zero-level", { level: 0 }),
        testTake("promoted"),
      ];
      const result = await exportLoopSample({
        name: "Selected Takes",
        snapshot,
        recordings: new Map([["staged", noteRecording], ["muted", noteRecording], ["zero-level", noteRecording], ["promoted", noteRecording]]),
        sampleRoot: root,
      });

      expect(result.filename).toMatch(/^Selected Takes-[0-9a-f-]{36}\.mp3$/);
      expect((await stat(result.path)).size).toBeGreaterThan(1_000);
      expect(result.durationSeconds).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("omits staged and takes while staged audio is disabled or monitor-only, but allows drums", async () => {
    const root = await temporaryRoot();
    try {
      const snapshot = await playingSnapshot();
      snapshot.capture.staged = testTake("staged");
      snapshot.capture.stagedAudible = false;
      snapshot.promoted = [testTake("promoted", { muted: true })];
      await expect(exportLoopSample({ name: "Silent", snapshot, recordings: new Map(), sampleRoot: root })).rejects.toThrow("No audible note material");

      snapshot.monitorOnly = true;
      snapshot.drums.enabled = true;
      snapshot.drums.volume = 1;
      await expect(exportLoopSample({ name: "Drums Need Font", snapshot, recordings: new Map(), sampleRoot: root }))
        .rejects.toThrow("Drum pattern export requires a percussion SoundFont");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders deterministic drum steps using the selected kit even in monitor-only mode", async () => {
    const snapshot = await playingSnapshot();
    snapshot.monitorOnly = true;
    snapshot.drums.enabled = true;
    snapshot.drums.pattern = "backbeat";
    snapshot.drums.volume = 0.8;
    snapshot.pads.drumKits = [
      { id: "kit-3", bank: 128, program: 3, name: "Kit Three" },
      { id: "kit-7", bank: 128, program: 7, name: "Kit Seven" },
    ];
    snapshot.pads.selectedDrumKitId = "kit-7";

    const recording = makeDrumRecording(snapshot);
    const midi = parseMidi(recordingToMidi(recording, testTake("drums"), snapshot));
    const drumEvents = midi.tracks.find((track) => track.some((event) => "channel" in event && event.channel === 9))!;

    expect(recording.some(({ event }) => event.type === "note-on" && event.channel === 9)).toBe(true);
    expect(drumEvents.find((event) => event.type === "programChange")).toMatchObject({ channel: 9, programNumber: 7 });
  });

  it("uses live 80 ms drum gates while keeping step positions and clipping note-offs to the cycle", async () => {
    const snapshot = await playingSnapshot();
    snapshot.drums.enabled = true;
    snapshot.drums.pattern = "backbeat";
    snapshot.drums.volume = 1;
    snapshot.settings.loopMeasures = 2;

    const recording = makeDrumRecording(snapshot);
    const noteOn = recording.find(({ event }) => event.type === "note-on" && event.note === 36 && event.velocity === 127)!;
    const noteOff = recording.find(({ event, position }) => event.type === "note-off" && event.note === 36 && position > noteOn.position)!;
    const cycleSeconds = 60 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;

    expect(noteOn.position).toBe(0);
    expect(noteOff.position - noteOn.position).toBeCloseTo(0.08 / cycleSeconds);
    expect(recording.some(({ event, position }) => event.type === "note-on" && event.note === 36 && position === 7 / 32)).toBe(true);

    snapshot.settings.bpm = 480;
    const fastCycleRecording = makeDrumRecording(snapshot);
    const lastHit = fastCycleRecording.find(({ event, position }) => event.type === "note-on" && event.note === 36 && position === 30 / 32)!;
    const lastNoteOff = fastCycleRecording.find(({ event, position }) => event.type === "note-off" && event.note === 36 && position > lastHit.position)!;
    expect(lastNoteOff.position).toBe(1);
  });

  it("returns a committed file with a warning when staged-file cleanup fails", async () => {
    const root = await temporaryRoot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fsPromises.rm).mockRejectedValueOnce(new Error("cleanup failed"));
    try {
      const snapshot = await playingSnapshot();
      snapshot.settings.bpm = 240;
      snapshot.promoted = [testTake("cleanup")];
      const result = await exportLoopSample({
        name: "Cleanup Warning",
        snapshot,
        recordings: new Map([["cleanup", noteRecording]]),
        sampleRoot: root,
      });

      expect((await stat(result.path)).isFile()).toBe(true);
      expect(result.warning).toBe("Temporary loop sample cleanup failed");
      expect(warn).toHaveBeenCalledWith("Unable to clean up temporary loop sample export directory");
    } finally {
      warn.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("preserves a publish error when temporary cleanup also fails", async () => {
    const root = await temporaryRoot();
    const publishError = Object.assign(new Error("publish failed"), { code: "EACCES" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fsPromises.link).mockRejectedValueOnce(publishError);
    vi.mocked(fsPromises.rm).mockRejectedValueOnce(new Error("cleanup failed"));
    try {
      const snapshot = await playingSnapshot();
      snapshot.settings.bpm = 240;
      snapshot.promoted = [testTake("publish")];

      await expect(exportLoopSample({
        name: "Publish Failure",
        snapshot,
        recordings: new Map([["publish", noteRecording]]),
        sampleRoot: root,
      })).rejects.toBe(publishError);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects missing eligible recordings, stopped transport, overlong cycles, and unsafe names", async () => {
    const root = await temporaryRoot();
    try {
      const snapshot = await playingSnapshot();
      snapshot.promoted = [testTake("needed")];
      await expect(exportLoopSample({ name: "Missing", snapshot, recordings: new Map(), sampleRoot: root }))
        .rejects.toThrow("Missing recording for audible take: needed");

      snapshot.transport.state = "stopped";
      await expect(exportLoopSample({ name: "Stopped", snapshot, recordings: new Map(), sampleRoot: root }))
        .rejects.toThrow("transport to be playing");
      snapshot.transport.state = "playing";
      snapshot.settings.bpm = 30;
      snapshot.settings.beatsPerMeasure = 16;
      snapshot.settings.loopMeasures = 4;
      await expect(exportLoopSample({ name: "Too Long", snapshot, recordings: new Map([["needed", noteRecording]]), sampleRoot: root }))
        .rejects.toThrow("at most 30 seconds");
      await expect(exportLoopSample({ name: "../escape", snapshot, recordings: new Map(), sampleRoot: root })).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("clones snapshot and recordings synchronously and safely publishes concurrent same-name exports", async () => {
    const root = await temporaryRoot();
    try {
      const snapshot = await playingSnapshot();
      snapshot.promoted = [testTake("copy")];
      const recordings = new Map([["copy", structuredClone(noteRecording)]]);
      const first = exportLoopSample({ name: "Concurrent", snapshot, recordings, sampleRoot: root });
      snapshot.transport.state = "stopped";
      snapshot.promoted[0]!.level = 0;
      recordings.clear();
      const second = exportLoopSample({
        name: "Concurrent",
        snapshot: await playingSnapshotWithTake(),
        recordings: new Map([["copy", noteRecording]]),
        sampleRoot: root,
      });
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult.filename).not.toBe(secondResult.filename);
      expect(firstResult.path).not.toBe(secondResult.path);
      expect((await stat(firstResult.path)).isFile()).toBe(true);
      expect((await stat(secondResult.path)).isFile()).toBe(true);
      expect(await readdir(root)).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("round-trips an exact 30-second Neon MP3 through SampleLibrary with audible decoded PCM", async () => {
    const root = await temporaryRoot();
    const library = new SampleLibrary(root);
    try {
      const snapshot = await playingSnapshot();
      snapshot.settings.bpm = 32;
      snapshot.settings.beatsPerMeasure = 4;
      snapshot.settings.loopMeasures = 4;
      snapshot.promoted = [testTake("boundary", { level: 0.9 })];
      const result = await exportLoopSample({
        name: "Thirty Seconds",
        snapshot,
        recordings: new Map([["boundary", noteRecording]]),
        sampleRoot: root,
      });

      expect(result.durationSeconds).toBe(30);
      expect(result.filename).toBe(result.path.split("/").at(-1));
      expect(existsSync(result.path)).toBe(true);
      expect((await stat(result.path)).size).toBeLessThan(32 * 1024 * 1024);
      const descriptors = await library.scan();
      expect(descriptors).toHaveLength(1);
      const decoded = (await library.loadPage(0))[0];
      expect(decoded).not.toBeNull();
      expect(decoded!.samples.length).toBe(30 * 48_000 * 2);
      expect(decoded!.samples.some((sample) => Math.abs(sample) > 0.001)).toBe(true);
    } finally {
      await library.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});

async function playingSnapshotWithTake(): Promise<EngineSnapshot> {
  const snapshot = await playingSnapshot();
  snapshot.promoted = [testTake("copy")];
  return snapshot;
}
