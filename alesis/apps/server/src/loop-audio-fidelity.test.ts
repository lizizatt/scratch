import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeMidi, type MidiEvent as FileEvent } from "midi-file";
import { NeonPressureSynth, SilentAudioOutput, SimulatedLoopOutput, type AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import type { EngineSnapshot } from "@alesis/protocol";
import { MidiLoopScheduler } from "./loop-playback.js";
import { applyVelocityCurve, PerformanceRouter } from "./performance-router.js";
import { renderLoopArtifact, type LoopArtifact } from "./loop-render.js";
import { cycleRenderEvents, cycleRenderSchedule } from "./cycle-render-schedule.js";

// Agreed seam: host MIDI -> routed capture -> production replay deliveries/export.
// No audio device, wall-clock scheduling, or physical latency is exercised here.
const run = promisify(execFile);
const rate = 48_000;
const cycle = 2;
const frames = rate * cycle;
const font = process.env.ALESIS_TEST_SOUNDFONT ?? join(homedir(), "Downloads/STH.sf2");
const neon = { attack: 0.004, release: 0.04, cutoff: 6300, resonance: 0.2, drive: 0, "lfo-rate": 0 };
type Delivery = { at: number; event: MidiEvent };
type Mode = "subtractive" | "soundfont";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "alesis-audio-fidelity-"));
  cleanup.push(() => rm(path, { force: true, recursive: true }));
  return path;
}

function phrase(percussion: boolean): Delivery[] {
  const events: Delivery[] = [
    { at: 0.2, event: { type: "control-change", channel: 0, controller: 64, value: 127 } },
    { at: 0.25, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
    { at: 0.4, event: { type: "note-off", channel: 0, note: 60 } },
    { at: 0.6, event: { type: "pitch-bend", channel: 0, value: 0.5 } },
    { at: 0.8, event: { type: "control-change", channel: 0, controller: 64, value: 0 } },
    { at: 0.9, event: { type: "pitch-bend", channel: 0, value: 0 } },
    { at: 1.75, event: { type: "note-on", channel: 0, note: 67, velocity: 80 } },
    { at: 1.9, event: { type: "note-on", channel: 0, note: 67, velocity: 0 } },
  ];
  if (percussion) events.push(
    { at: 1, event: { type: "note-on", channel: 9, note: 42, velocity: 100 } },
    { at: 1.08, event: { type: "note-off", channel: 9, note: 42 } },
  );
  return events.sort((a, b) => a.at - b.at);
}

async function capture(mode: Mode, input: Delivery[]) {
  const engine = new SimulatedHostEngine();
  cleanup.push(() => engine.dispose());
  expect((await engine.execute({ type: "configure", settings: {
    bpm: 120, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false,
    velocityCurve: "linear", minimumVelocity: 1,
  } })).accepted).toBe(true);
  const output: AudioOutput = new SilentAudioOutput();
  const loops = new MidiLoopScheduler(output);
  const router = new PerformanceRouter();
  const heard: Delivery[] = [];
  await engine.execute({ type: "play" });
  let time = 0;
  for (const { at, event } of input) {
    engine.advance(at - time);
    time = at;
    const curved = applyVelocityCurve(event, engine.snapshot().settings.velocityCurve, 1);
    engine.dispatchMidi(curved);
    for (const routed of router.route(curved)) {
      engine.markCaptureActivity();
      loops.record(routed, engine.snapshot());
      // Mapped drum releases are deliberately suppressed at the production audio boundary.
      if (!(routed.channel === 9 && routed.type === "note-off")) heard.push({ at, event: routed });
    }
  }
  engine.advance(cycle + 0.01 - time);
  loops.update(engine.snapshot());
  await engine.execute({ type: "stop" });
  loops.update(engine.snapshot());
  const take = engine.snapshot().capture.staged!;
  expect(take).toBeTruthy();
  // Default take level is 0.8 velocity scaling, NOT a linear PCM gain. Pin unity.
  expect((await engine.execute({ type: "promote-staged" })).accepted).toBe(true);
  expect((await engine.execute({ type: "set-take-level", takeId: take.id, level: 1 })).accepted).toBe(true);
  const snapshot = engine.snapshot();
  snapshot.synth.selectedId = mode;
  snapshot.synth.parameterValues = mode === "subtractive" ? { ...neon } : { gain: 0.72, "reverb-send": 0, "chorus-send": 0 };
  snapshot.synth.soundFontPresets = [{ id: "0:0", name: "STH Piano", bank: 0, program: 0 }];
  snapshot.synth.selectedSoundFontPresetId = "0:0";
  snapshot.pads.drumKits = [{ id: "kit", name: "STH Standard", bank: 128, program: 0 }];
  snapshot.pads.selectedDrumKitId = "kit";
  snapshot.drums.enabled = false;
  const recordings = loops.exportRecordings([take.id]);
  expect(recordings.get(take.id)?.filter(({ event }) => event.type === "note-on" && event.velocity > 0)).toHaveLength(input.filter(({ event }) => event.type === "note-on" && event.velocity > 0).length);
  return { snapshot, recordings, loops, output, heard, soundFontPath: font, percussionSoundFontPath: font };
}

function replay(h: Awaited<ReturnType<typeof capture>>, startBeat: number, passes = 3): Delivery[] {
  const snapshot = structuredClone(h.snapshot);
  const result: Delivery[] = [];
  let at = 0;
  h.output.dispatchMidi = (event) => { result.push({ at, event: structuredClone(event) }); };
  snapshot.transport.state = "playing";
  snapshot.transport.origin = startBeat / 4;
  // Drive the public scheduler's actual next deadlines, not a second rotation algorithm.
  for (let pass = 0; pass < passes; pass++) {
    snapshot.transport.cycle = pass + 10;
    snapshot.transport.progress = 0;
    at = pass * cycle;
    h.loops.update(snapshot);
    for (let guard = 0; guard < 100; guard++) {
      const next = h.loops.nextPlaybackPosition(snapshot);
      if (next >= 1) break;
      snapshot.transport.progress = next;
      at = (pass + next) * cycle;
      h.loops.update(snapshot);
      if (guard === 99) throw new Error("Replay deadline did not advance");
    }
  }
  return result;
}

function mono(pcm: Buffer): Float64Array {
  return Float64Array.from({ length: pcm.length / 4 }, (_, frame) => (pcm.readInt16LE(frame * 4) + pcm.readInt16LE(frame * 4 + 2)) / 65536);
}
async function decode(path: string, root: string, name: string) {
  const raw = join(root, `${name}.pcm`);
  await run("ffmpeg", ["-nostdin", "-v", "error", "-i", path, "-f", "s16le", "-ar", String(rate), "-ac", "2", raw]);
  return readFile(raw);
}

// Independent adapter for actual delivered MIDI: no capture rotation, export MIDI
// writer, renderTakeWav, or renderNeonWav is used to manufacture the oracle.
async function renderDeliveries(mode: Mode, events: Delivery[], snapshot: EngineSnapshot, seconds: number): Promise<Float64Array> {
  if (mode === "subtractive") {
    const synth = new NeonPressureSynth(rate, snapshot.synth.parameterValues);
    const result = new Float64Array(Math.round(seconds * rate));
    let frame = 0;
    for (const { at, event } of [...events, { at: seconds, event: null }]) {
      const end = Math.round(at * rate);
      const block = synth.render(end - frame);
      for (let i = frame; i < end; i++) result[i] = (block[(i - frame) * 2]! + block[(i - frame) * 2 + 1]!) / 2;
      frame = end;
      if (event && event.channel !== 9) synth.dispatchMidi(event);
    }
    return result;
  }
  const root = await directory();
  const midi = join(root, "delivered.mid");
  const wav = join(root, "delivered.wav");
  const track: FileEvent[] = [{ deltaTime: 0, type: "setTempo", microsecondsPerBeat: 500000, meta: true }];
  const reverb = snapshot.synth.parameterValues["reverb-send"] ?? 0;
  for (const channel of new Set(events.map(({ event }) => event.channel))) {
    track.push({ deltaTime: 0, type: "programChange", channel, programNumber: 0 });
    for (const controllerType of [91, 93]) track.push({ deltaTime: 0, type: "controller", channel, controllerType, value: controllerType === 91 ? Math.round(reverb * 127) : 0 });
  }
  let tick = 0;
  for (const { at, event } of events) {
    const next = Math.round(at * 960);
    const deltaTime = next - tick;
    tick = next;
    if (event.type === "note-on") track.push({ deltaTime, type: "noteOn", channel: event.channel, noteNumber: event.note, velocity: event.velocity });
    else if (event.type === "note-off") track.push({ deltaTime, type: "noteOff", channel: event.channel, noteNumber: event.note, velocity: 0 });
    else if (event.type === "control-change") track.push({ deltaTime, type: "controller", channel: event.channel, controllerType: event.controller, value: event.value });
    else if (event.type === "pitch-bend") track.push({ deltaTime, type: "pitchBend", channel: event.channel, value: Math.round(event.value * 8192) });
    else throw new Error(`Unsupported fixture event ${event.type}`);
  }
  track.push({ deltaTime: Math.round(seconds * 960) - tick, type: "endOfTrack", meta: true });
  await writeFile(midi, Uint8Array.from(writeMidi({ header: { format: 0, numTracks: 1, ticksPerBeat: 480 }, tracks: [track] })));
  await run("fluidsynth", ["-ni", "-F", wav, "-r", String(rate), "-o", "audio.file.format=s16", "-o", "synth.gain=0.72", "-o", "synth.chorus.active=0", "-o", `synth.reverb.active=${reverb > 0 ? 1 : 0}`, "-o", "synth.reverb.level=0.3", "-o", "synth.reverb.room-size=0.2", "-o", "synth.reverb.damp=0", "-o", "synth.reverb.width=0.5", font, midi]);
  return mono(await decode(wav, root, "delivered")).slice(0, Math.round(seconds * rate));
}

function rms(pcm: Float64Array, from = 0, to = pcm.length / rate) {
  const start = Math.round(from * rate), end = Math.round(to * rate);
  let energy = 0;
  for (let i = start; i < end; i++) energy += pcm[i]! ** 2;
  return Math.sqrt(energy / (end - start));
}
function difference(a: Float64Array, b: Float64Array) {
  expect(a.length).toBe(b.length);
  let error = 0, energy = 0;
  for (let i = 0; i < a.length; i++) { error += (a[i]! - b[i]!) ** 2; energy += a[i]! ** 2; }
  return Math.sqrt(error / Math.max(energy, 1e-20));
}
function activeSpan(pcm: Float64Array, from: number, to: number) {
  // 5 ms RMS windows reject zero crossings and codec pre-ringing below -60 dBFS.
  const active: number[] = [];
  for (let at = from; at + 0.005 <= to + 1e-9; at += 0.005) if (rms(pcm, at, at + 0.005) > 0.001) active.push(at);
  return { start: active[0] ?? Infinity, end: (active.at(-1) ?? -Infinity) + 0.005 };
}
function seam(pcm: Float64Array) {
  let derivative = 0;
  for (let i = 1; i < pcm.length; i++) derivative += (pcm[i]! - pcm[i - 1]!) ** 2;
  let silent = 0, longest = 0;
  const edge = [...pcm.slice(-rate * 0.02), ...pcm.slice(0, rate * 0.02)];
  for (const sample of edge) { silent = Math.abs(sample) < 3 / 32768 ? silent + 1 : 0; longest = Math.max(longest, silent); }
  const step = Math.abs(pcm[0]! - pcm.at(-1)!);
  return { step, stepOverRms: step / rms(pcm), stepOverInterior: step / Math.max(Math.sqrt(derivative / (pcm.length - 1)), 1e-12), silentGapMs: longest / rate * 1000 };
}

async function artifact(h: Awaited<ReturnType<typeof capture>>, startBeat?: number, target: "sample" | "promoted" = "sample"): Promise<LoopArtifact> {
  const { snapshot, recordings, soundFontPath, percussionSoundFontPath } = h;
  const result = await renderLoopArtifact({ snapshot, recordings, soundFontPath, percussionSoundFontPath }, { target, startBeat }, new AbortController().signal);
  cleanup.push(() => result.release());
  return result;
}

async function assertEncodedRepeats(result: LoopArtifact) {
  const root = await directory();
  await writeFile(join(root, "saved.mp3"), result.encoded);
  const saved = await decode(join(root, "saved.mp3"), root, "saved");
  const output = new SimulatedLoopOutput();
  cleanup.push(() => output.close());
  await output.start(result.pcm, result.encoded, () => { throw new Error("Preview failure"); });
  const chunks: Buffer[] = [];
  let left = result.pcm.length / 4 * 3;
  for (let n = 0; left > 0; n++) {
    const count = Math.min(left, [1, 479, 2047, frames + 13, 127][n % 5]!);
    chunks.push(output.frames(count));
    left -= count;
  }
  const preview = Buffer.concat(chunks);
  for (let pass = 0; pass < 3; pass++) expect(preview.subarray(pass * saved.length, (pass + 1) * saved.length)).toEqual(saved);
}

describe("offline host/capture/replay/export audio fidelity (STH required)", () => {
  it.each([
    ["subtractive", 0], ["subtractive", 1], ["soundfont", 0], ["soundfont", 1],
  ] as const)("%s: start beat %s, three independently rendered replay passes and final preview", async (mode, startBeat) => {
    const h = await capture(mode, phrase(mode === "soundfont"));
    const live = await renderDeliveries(mode, h.heard, h.snapshot, cycle);
    const deliveries = replay(h, startBeat, 5);
    const continuous = await renderDeliveries(mode, deliveries, h.snapshot, cycle * 5);
    const first = await artifact(h, startBeat);
    const independent = await artifact(h, startBeat);
    const raw = mono(await readFile(join(first.directory, "cycle.pcm")));
    const decoded = mono(first.pcm);
    expect(first.durationSeconds).toBe(cycle);
    expect(decoded.length).toBe(frames);
    expect(difference(decoded, mono(independent.pcm))).toBeLessThan(0.0001);
    expect(difference(raw, mono(await readFile(join(independent.directory, "cycle.pcm"))))).toBeLessThan(0.0001);
    expect(difference(raw, decoded)).toBeLessThan(0.06);
    // Separate decode of the encoded artifact, not an expectation built from preview.pcm.
    const root = await directory();
    await writeFile(join(root, "saved.mp3"), first.encoded);
    const saved = await decode(join(root, "saved.mp3"), root, "saved");
    const output = new SimulatedLoopOutput();
    cleanup.push(() => output.close());
    await output.start(first.pcm, first.encoded, () => { throw new Error("Preview failure"); });
    const chunks: Buffer[] = [];
    let left = frames * 3;
    for (let n = 0; left > 0; n++) {
      const count = Math.min(left, [1, 479, 2047, frames + 13, 127][n % 5]!);
      chunks.push(output.frames(count));
      left -= count;
    }
    const preview = Buffer.concat(chunks);
    for (let pass = 0; pass < 3; pass++) expect(preview.subarray(pass * frames * 4, (pass + 1) * frames * 4)).toEqual(saved);
    const firstReplay = continuous.slice(frames * 2, frames * 3);
    // FluidSynth MIDI file rendering quantizes delivery to native blocks; no phase
    // alignment or fitted gain is allowed to conceal a shifted attack or gate.
    const firstError = difference(raw, firstReplay);
    expect(firstError).toBeLessThan(mode === "subtractive" ? 0.0003 : 0.02);
    if (startBeat === 0) expect(difference(live, continuous.slice(0, frames))).toBeLessThan(mode === "subtractive" ? 0.0003 : 0.02);
    const onset = startBeat === 0 ? 0.25 : 0;
    const release = startBeat === 0 ? 0.8 : 0.3;
    const spans = [];
    const passErrors = [];
    for (let pass = 0; pass < 3; pass++) {
      const pcm = continuous.slice((pass + 2) * frames, (pass + 3) * frames);
      passErrors.push(difference(raw, pcm));
      // INCLUDE_WRAPPED_TAILS compares a warmed artifact to a running synth,
      // not to cold first playback. No time alignment or fitted gain is applied.
      expect(passErrors.at(-1)).toBeLessThan(mode === "subtractive" ? 0.0003 : 0.02);
      const span = activeSpan(pcm, 0, release + 0.18);
      spans.push(span);
      expect(Math.abs(span.start - onset)).toBeLessThan(0.015);
      expect(span.end).toBeGreaterThan(release);
      expect(span.end).toBeLessThan(release + 0.16);
      expect(rms(pcm, release - 0.1, release - 0.02)).toBeGreaterThan(0.01);
      expect(rms(pcm, release + 0.16, release + 0.19)).toBeLessThan(0.001);
      for (let at = onset + 0.02; at < release - 0.01; at += 0.005) {
        expect(rms(pcm, at, at + 0.005), `held gate dropout in pass ${pass + 1} at ${at}s`).toBeGreaterThan(0.002);
      }
      const secondOnset = 1.75 - startBeat * 0.5;
      const secondRelease = 1.9 - startBeat * 0.5;
      const second = activeSpan(pcm, secondOnset - 0.03, secondRelease + 0.09);
      expect(Math.abs(second.start - secondOnset)).toBeLessThan(0.015);
      expect(second.end).toBeGreaterThan(secondRelease);
      expect(second.end).toBeLessThan(secondRelease + 0.08);
      if (mode === "soundfont") {
        const hatOnset = 1 - startBeat * 0.5;
        const hat = activeSpan(pcm, hatOnset - 0.04, hatOnset + 0.2);
        expect(Math.abs(hat.start - hatOnset)).toBeLessThan(0.015);
        expect(rms(pcm, hatOnset + 0.01, hatOnset + 0.03)).toBeGreaterThan(0.001);
      }
    }
    const previewSpan = activeSpan(decoded, 0, release + 0.18);
    expect(Math.abs(previewSpan.start - spans[0]!.start)).toBeLessThan(0.015);
    expect(Math.abs(previewSpan.end - spans[0]!.end)).toBeLessThan(0.02);
    if (startBeat === 1) {
      expect(rms(decoded, 1.95, 1.99)).toBeGreaterThan(0.01);
      expect(rms(decoded, 0.01, 0.05)).toBeGreaterThan(0.01);
      expect(seam(decoded).silentGapMs).toBeLessThan(1.5);
      expect(seam(decoded).stepOverRms).toBeLessThan(0.8);
      expect(seam(decoded).stepOverInterior).toBeLessThan(3);
    }
    console.info("AUDIO_FIDELITY", JSON.stringify({ mode, startBeat, firstError, passErrors, codecError: difference(raw, decoded), coldStartError: difference(raw, continuous.slice(0, frames)), spans, seam: seam(decoded) }));
  }, 120_000);

  it("detects an inserted 20 ms gap and a missing physical note-off in real Neon PCM", async () => {
    const input: Delivery[] = [
      { at: 0.1, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
      { at: 0.5, event: { type: "note-off", channel: 0, note: 60 } },
    ];
    const h = await capture("subtractive", input);
    const reference = await renderDeliveries("subtractive", replay(h, 0), h.snapshot, cycle * 3);
    const brokenGate = await renderDeliveries("subtractive", input.slice(0, 1), h.snapshot, cycle);
    const assertReleased = (pcm: Float64Array) => expect(rms(pcm, 0.6, 0.7)).toBeLessThan(0.001);
    assertReleased(reference);
    expect(() => assertReleased(brokenGate)).toThrow();
    const brokenGap = reference.slice();
    brokenGap.fill(0, Math.round(0.3 * rate), Math.round(0.32 * rate));
    const assertHeld = (pcm: Float64Array) => {
      for (let at = 0.2; at < 0.4; at += 0.005) expect(rms(pcm, at, at + 0.005)).toBeGreaterThan(0.01);
    };
    assertHeld(reference);
    expect(() => assertHeld(brokenGap)).toThrow();
  });

  it("includes the preceding near-end Neon release on the first and every exported pass", async () => {
    const h = await capture("subtractive", [
      { at: 1.8, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
      { at: 1.98, event: { type: "note-off", channel: 0, note: 60 } },
    ]);
    h.snapshot.synth.parameterValues.release = 0.2;
    const continuous = await renderDeliveries("subtractive", replay(h, 0), h.snapshot, cycle * 3);
    const result = await artifact(h, 0);
    await assertEncodedRepeats(result);
    const exported = mono(result.pcm);
    const nextPassTail = rms(continuous, 2.02, 2.1);
    const repeatedTail = rms(exported, 0.02, 0.1);
    console.info("AUDIO_WRAPPED_TAIL", JSON.stringify({ nextPassTail, repeatedTail, seam: seam(exported) }));
    expect(nextPassTail).toBeGreaterThan(0.02);
    expect(rms(continuous, 4.02, 4.1)).toBeCloseTo(nextPassTail, 6);
    expect(Math.abs(nextPassTail - repeatedTail)).toBeLessThan(0.001);
    expect(seam(exported).stepOverInterior).toBeLessThan(3);
  }, 30_000);

  it.each(["release", "reverb", "percussion", "neon-percussion"] as const)("includes real STH %s at the opening rather than cutting the preceding cycle", async (kind) => {
    const drums = kind.endsWith("percussion");
    const channel = drums ? 9 : 0;
    const note = drums ? 38 : 60;
    const h = await capture(kind === "neon-percussion" ? "subtractive" : "soundfont", [
      { at: 1.8, event: { type: "note-on", channel, note, velocity: 100 } },
      { at: kind === "release" ? 1.999 : 1.98, event: { type: "note-off", channel, note } },
    ]);
    if (kind === "reverb") h.snapshot.synth.parameterValues["reverb-send"] = 1;
    const continuous = await renderDeliveries("soundfont", replay(h, 0, 5), h.snapshot, cycle * 5);
    const result = await artifact(h, 0);
    await assertEncodedRepeats(result);
    const raw = mono(await readFile(join(result.directory, "cycle.pcm")));
    const exported = mono(result.pcm);
    const end = kind === "release" ? 0.004 : 0.1;
    const reference = rms(continuous, cycle * 2, cycle * 2 + end);
    console.info("STH_WRAPPED_TAIL", JSON.stringify({ kind, reference, raw: rms(raw, 0, end), decoded: rms(exported, 0, end) }));
    expect(reference).toBeGreaterThan(0.0002);
    expect(rms(raw, 0, end)).toBeGreaterThan(reference * 0.7);
    expect(rms(exported, 0, end)).toBeGreaterThan(reference * 0.6);
    expect(difference(raw, continuous.slice(frames * 2, frames * 3))).toBeLessThan(0.02);
    expect(difference(raw, continuous.slice(frames * 3, frames * 4))).toBeLessThan(0.02);
    expect(difference(raw, continuous.slice(frames * 4, frames * 5))).toBeLessThan(0.02);
    expect(result.durationSeconds).toBe(cycle);
  }, 120_000);

  it.each(["subtractive", "soundfont"] as const)("%s: boundary key/pedal release and shifted continuations follow actual scheduler order without extra attacks", async (mode) => {
    const h = await capture(mode, [
      { at: 0.15, event: { type: "note-on", channel: 0, note: 64, velocity: 90 } },
      { at: 0.3, event: { type: "control-change", channel: 0, controller: 64, value: 127 } },
      { at: 0.4, event: { type: "note-off", channel: 0, note: 64 } },
      { at: 0.6, event: { type: "control-change", channel: 0, controller: 64, value: 0 } },
      { at: 1.7, event: { type: "control-change", channel: 0, controller: 64, value: 127 } },
      { at: 1.8, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
      { at: 1.9, event: { type: "pitch-bend", channel: 0, value: 0.25 } },
    ]);
    if (mode === "subtractive") h.snapshot.synth.parameterValues.release = 0.2;
    const recording = h.recordings.get(h.snapshot.promoted[0]!.id)!;
    for (const startBeat of [0, 1]) {
      const deliveries = replay(h, startBeat, 5);
      // Previous probe leaves notes active: only compare from the settled third pass.
      const schedule = cycleRenderSchedule(recording, startBeat / 4, 1, cycle);
      const scheduled = [...cycleRenderEvents(schedule)].filter(({ frame }) => frame >= frames * 2 && frame < frames * 3);
      const actual = deliveries.filter(({ at }) => at >= cycle * 2 && at < cycle * 3);
      expect(scheduled).toEqual(actual.map(({ at, event }) => ({ frame: Math.round(at * rate), event })));
      const continuous = await renderDeliveries(mode, deliveries, h.snapshot, cycle * 5);
      const result = await artifact(h, startBeat);
      await assertEncodedRepeats(result);
      const raw = mono(await readFile(join(result.directory, "cycle.pcm")));
      for (let pass = 2; pass < 5; pass++) expect(difference(raw, continuous.slice(frames * pass, frames * (pass + 1)))).toBeLessThan(mode === "subtractive" ? 0.0003 : 0.02);
      // The default sample path and explicit promoted path use the same warm policy.
      if (startBeat === 0) {
        const defaultSample = await artifact(h);
        const promoted = await artifact(h, 0, "promoted");
        await assertEncodedRepeats(promoted);
        expect(defaultSample.durationSeconds).toBe(cycle);
        expect(defaultSample.pcm).toEqual(result.pcm);
        expect(promoted.durationSeconds).toBe(cycle);
        expect(rms(mono(promoted.pcm), 0.001, 0.004)).toBeGreaterThan(0.001);
      }
    }
  }, 120_000);
});
