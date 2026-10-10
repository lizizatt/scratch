import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import { SAMPLE_MAX_FILE_BYTES, SAMPLE_PAGE_SIZE, SampleLibrary, SampleMixer, SamplePlayer } from "./samples.js";
import { stereoFloatToDualMonoS16 } from "./index.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const encoderList = hasFfmpeg ? spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }) : null;
const canGenerateMp3 = Boolean(encoderList?.status === 0 && `${encoderList.stdout}${encoderList.stderr}`.includes("libmp3lame"));

it("keeps sample IDs stable when a colliding filename sorts before an existing file", async () => {
  const root = mkdtempSync(join(tmpdir(), "alesis-stable-sample-"));
  const library = new SampleLibrary(root);
  try {
    writeFileSync(join(root, "a-b.mp3"), "fixture");
    const id = (await library.scan())[0]!.id;
    writeFileSync(join(root, "a b.mp3"), "fixture");
    const catalog = await library.scan();
    expect(catalog.find(({ name }) => name === "a-b")!.id).toBe(id);
    expect(new Set(catalog.map(({ id }) => id)).size).toBe(2);
  } finally {
    await library.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function fixtureSample(id: string, values: number[]): { id: string; name: string; samples: Float32Array } {
  return { id, name: id, samples: new Float32Array(values) };
}

class ReferenceSampleMixer {
  private page: Array<{ id: string; name: string; samples: Float32Array } | null> = Array(SAMPLE_PAGE_SIZE).fill(null);
  private readonly voices: Array<{ sample: NonNullable<ReferenceSampleMixer["page"][number]>; gain: number; startedAt: number; frame: number }> = [];
  private sequence = 0;

  constructor(private readonly maxVoices: number) {}

  get activeVoiceCount(): number {
    return this.voices.length;
  }

  setPage(samples: readonly ({ id: string; name: string; samples: Float32Array } | null)[]): void {
    this.page = Array.from({ length: SAMPLE_PAGE_SIZE }, (_, index) => samples[index] ?? null);
    this.panic();
  }

  trigger(pad: number, velocity: number): void {
    if (!Number.isFinite(pad) || !Number.isInteger(pad) || pad < 0 || pad >= SAMPLE_PAGE_SIZE) return;
    if (!Number.isFinite(velocity) || velocity <= 0) return;
    const sample = this.page[pad];
    if (!sample || sample.samples.length < 2) return;
    if (this.voices.length >= this.maxVoices) {
      let oldestIndex = 0;
      for (let index = 1; index < this.voices.length; index += 1) {
        if (this.voices[index]!.startedAt < this.voices[oldestIndex]!.startedAt) oldestIndex = index;
      }
      this.voices.splice(oldestIndex, 1);
    }
    this.voices.push({ sample, gain: Math.max(0, Math.min(1, velocity / 127)), startedAt: this.sequence++, frame: 0 });
  }

  render(frameCount: number): Float32Array {
    const output = new Float32Array(frameCount * 2);
    for (let frame = 0; frame < frameCount; frame += 1) {
      let left = 0;
      let right = 0;
      for (let index = this.voices.length - 1; index >= 0; index -= 1) {
        const voice = this.voices[index]!;
        const offset = voice.frame * 2;
        if (offset + 1 >= voice.sample.samples.length) {
          this.voices.splice(index, 1);
          continue;
        }
        const sampleLeft = voice.sample.samples[offset]!;
        const sampleRight = voice.sample.samples[offset + 1]!;
        left += (Number.isFinite(sampleLeft) ? Math.max(-1, Math.min(1, sampleLeft)) : 0) * voice.gain;
        right += (Number.isFinite(sampleRight) ? Math.max(-1, Math.min(1, sampleRight)) : 0) * voice.gain;
        voice.frame += 1;
      }
      output[frame * 2] = Math.max(-1, Math.min(1, left));
      output[frame * 2 + 1] = Math.max(-1, Math.min(1, right));
    }
    return output;
  }

  panic(): void {
    this.voices.length = 0;
  }
}

function fixtureChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => true),
  });
}

function estimatePositiveCrossingFrequency(samples: Float32Array, startSeconds: number, endSeconds: number): number {
  const startFrame = Math.floor(startSeconds * 48_000);
  const endFrame = Math.min(Math.floor(endSeconds * 48_000), samples.length / 2);
  let crossings = 0;
  for (let frame = startFrame + 1; frame < endFrame; frame += 1) {
    if (samples[(frame - 1) * 2]! <= 0 && samples[frame * 2]! > 0) crossings += 1;
  }
  return crossings / ((endFrame - startFrame) / 48_000);
}

function signalRms(samples: Float32Array): number {
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  return Math.sqrt(sumSquares / samples.length);
}

describe("SampleMixer", () => {
  it("mixes interleaved stereo samples with velocity gain and supports retriggering", () => {
    const mixer = new SampleMixer();
    mixer.setPage([fixtureSample("kick", [0.2, -0.4, 0.4, 0.6]), null]);
    mixer.trigger(0, 64);
    const first = mixer.render(1);
    expect(first[0]!).toBeCloseTo(0.2 * 64 / 127, 6);
    expect(first[1]!).toBeCloseTo(-0.4 * 64 / 127, 6);

    mixer.trigger(0, 127);
    const retriggered = mixer.render(1);
    expect(retriggered[0]!).toBeCloseTo(0.4 * 64 / 127 + 0.2, 6);
    expect(retriggered[1]!).toBeCloseTo(0.6 * 64 / 127 - 0.4, 6);
  });

  it("silences voices on panic and when switching pages", () => {
    const mixer = new SampleMixer();
    const constant = fixtureSample("one", [0.5, -0.5, 0.5, -0.5]);
    mixer.setPage([constant]);
    mixer.trigger(0, 127);
    expect(mixer.render(1)).toEqual(new Float32Array([0.5, -0.5]));
    mixer.trigger(0, 127);
    mixer.panic();
    expect(mixer.render(2)).toEqual(new Float32Array(4));
    mixer.trigger(0, 127);
    mixer.setPage([fixtureSample("two", [0.25, 0.25])]);
    expect(mixer.activeVoiceCount).toBe(0);
    expect(mixer.render(1)).toEqual(new Float32Array(2));
  });

  it("steals the oldest voice when polyphony is full and clamps non-finite PCM", () => {
    const mixer = new SampleMixer(2);
    mixer.setPage([
      fixtureSample("oldest", [0.9, 0.9, 0.9, 0.9]),
      fixtureSample("middle", [0.2, 0.2, 0.2, 0.2]),
      fixtureSample("newest", [0.3, 0.3, 0.3, 0.3]),
      fixtureSample("bad", [Number.NaN, Number.POSITIVE_INFINITY]),
    ]);
    mixer.trigger(0, 127);
    mixer.trigger(1, 127);
    mixer.render(1);
    mixer.trigger(2, 127);
    expect(mixer.activeVoiceCount).toBe(2);
    expect(mixer.render(1)).toEqual(new Float32Array([0.5, 0.5]));
    mixer.panic();
    mixer.trigger(3, 127);
    expect(mixer.render(1)).toEqual(new Float32Array([0, 0]));
  });

  it("matches the original mixer exactly across variable blocks, pathological PCM, expiry, steals, and panic", () => {
    let seed = 0x1234abcd;
    const pages = Array.from({ length: 3 }, (_, pageIndex) => Array.from({ length: SAMPLE_PAGE_SIZE }, (_, pad) => {
      const lengths = [3, 47, 971, 4_001, 17, 1_503, 29, 20_003];
      const samples = new Float32Array(lengths[pad]!);
      for (let index = 0; index < samples.length; index += 1) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        const value = (seed / 0x1_0000_0000) * 2 - 1;
        samples[index] = index % 127 === 0 ? Number.NaN : index % 31 === 0 ? value * 3 : value;
      }
      if (pad === 0) samples[1] = Number.POSITIVE_INFINITY;
      return { id: `${pageIndex}-${pad}`, name: `${pageIndex}-${pad}`, samples };
    }));
    const originals = pages.flat().map(({ samples }) => samples.slice());
    const mixer = new SampleMixer(5);
    const reference = new ReferenceSampleMixer(5);
    mixer.setPage(pages[0]!);
    reference.setPage(pages[0]!);

    const blockSizes = [0, 1, 2, 7, 31, 480, 511, 13, 2_048];
    for (let step = 0; step < 180; step += 1) {
      if (step > 0 && step % 41 === 0) {
        const page = pages[(step / 41) % pages.length]!;
        mixer.setPage(page);
        reference.setPage(page);
      } else if (step % 37 === 0) {
        mixer.panic();
        reference.panic();
      } else if (step % 3 !== 0) {
        const pad = (step * 5 + 3) % SAMPLE_PAGE_SIZE;
        const velocity = [1, 32, 64, 127, 254][step % 5]!;
        mixer.trigger(pad, velocity);
        reference.trigger(pad, velocity);
      } else {
        const frames = blockSizes[step % blockSizes.length]!;
        expect(mixer.render(frames)).toEqual(reference.render(frames));
      }
      expect(mixer.activeVoiceCount).toBe(reference.activeVoiceCount);
    }
    expect(pages.flat().every(({ samples }, index) => samples.every((value, sampleIndex) => Object.is(value, originals[index]![sampleIndex])))).toBe(true);
  });

  it("preserves voice expiry at block boundaries", () => {
    const mixer = new SampleMixer();
    mixer.setPage([fixtureSample("one-frame", [0.25, -0.25])]);
    mixer.trigger(0, 127);
    expect(mixer.render(1)).toEqual(new Float32Array([0.25, -0.25]));
    expect(mixer.activeVoiceCount).toBe(1);
    expect(mixer.render(1)).toEqual(new Float32Array([0, 0]));
    expect(mixer.activeVoiceCount).toBe(0);
  });

  it("fades every retrigger of one pad to zero without changing another pad", () => {
    const mixer = new SampleMixer();
    mixer.setPage([
      fixtureSample("held", Array(600).fill(0.2).flatMap(() => [0.2, 0.2])),
      fixtureSample("other", Array(600).fill(0.25).flatMap(() => [0.25, 0.25])),
    ]);
    mixer.trigger(0, 127);
    mixer.render(12);
    mixer.trigger(0, 127);
    mixer.trigger(1, 127);

    expect(mixer.release(0)).toBe(true);
    expect(mixer.release(0)).toBe(false);
    const fade = mixer.render(240);
    expect(fade[0]).toBeCloseTo(0.2 + 0.2 + 0.25, 6);
    expect(fade.at(-2)).toBeCloseTo(0.25, 6);
    expect(fade.at(-1)).toBeCloseTo(0.25, 6);
    expect(mixer.activeVoiceCount).toBe(1);
    expect(mixer.render(1)).toEqual(new Float32Array([0.25, 0.25]));
  });

  it("keeps a newly triggered voice full-level while an earlier trigger fades", () => {
    const mixer = new SampleMixer();
    mixer.setPage([fixtureSample("pad", Array(400).fill(0.5).flatMap(() => [0.5, 0.5]))]);
    mixer.trigger(0, 127);
    mixer.render(4);
    mixer.release(0);
    const startOfFade = mixer.render(40);
    mixer.trigger(0, 127);
    const retriggered = mixer.render(1);

    expect(startOfFade[0]).toBeCloseTo(0.5, 6);
    expect(retriggered[0]).toBeGreaterThan(0.9);
    expect(mixer.activeVoiceCount).toBe(2);
  });

  it("ignores invalid releases and clears fade state on panic and page changes", () => {
    const mixer = new SampleMixer();
    mixer.setPage([fixtureSample("one", Array(300).fill(0.4).flatMap(() => [0.4, 0.4]))]);
    expect(mixer.release(-1)).toBe(false);
    expect(mixer.release(8)).toBe(false);
    expect(mixer.release(Number.NaN)).toBe(false);
    mixer.trigger(0, 127);
    expect(mixer.release(0)).toBe(true);
    mixer.panic();
    mixer.trigger(0, 127);
    expect(mixer.render(1)).toEqual(new Float32Array([0.4, 0.4]));
    mixer.release(0);
    mixer.setPage([fixtureSample("two", [0.2, 0.2])]);
    mixer.trigger(0, 127);
    expect(mixer.render(1)).toEqual(new Float32Array([0.2, 0.2]));
  });
});

describe("SampleLibrary", () => {
  it("returns an empty catalogue for a missing directory", async () => {
    const library = new SampleLibrary(join(tmpdir(), `alesis-missing-${Date.now()}`));
    await expect(library.scan()).resolves.toEqual([]);
    expect(library.descriptors).toEqual([]);
    await expect(library.loadPage(0)).resolves.toEqual(Array(SAMPLE_PAGE_SIZE).fill(null));
  });

  it("sorts filenames stably, recurses into directories, excludes outside symlinks and returns eight slots", async () => {
    const root = mkdtempSync(join(tmpdir(), "alesis-sample-library-"));
    const outside = mkdtempSync(join(tmpdir(), "alesis-outside-sample-"));
    try {
      for (const filename of ["z.mp3", "a.mp3", "c.mp3", "b.mp3", "f.mp3", "d.mp3", "e.mp3", "g.mp3", "h.mp3"]) {
        writeFileSync(join(root, filename), "not decoded by scan");
      }
      mkdirSync(join(root, "nested"));
      writeFileSync(join(root, "nested", "i.mp3"), "nested");
      const stagingDirectory = join(root, ".alesis-loop-sample-incomplete");
      mkdirSync(stagingDirectory);
      writeFileSync(join(stagingDirectory, "sample.part"), "partial export");
      mkdirSync(join(stagingDirectory, "nested"));
      writeFileSync(join(stagingDirectory, "nested", "corrupt.mp3"), "corrupt partial export");
      writeFileSync(join(outside, "escape.mp3"), "outside");
      symlinkSync(join(outside, "escape.mp3"), join(root, "escape.mp3"));

      const library = new SampleLibrary(root);
      const descriptors = await library.scan();
      expect(descriptors.map(({ name }) => name)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "z"]);
      expect(library.descriptors).toEqual(descriptors);
      const firstPage = await library.loadPage(99);
      expect(firstPage).toHaveLength(8);
      expect(firstPage.every((sample) => sample === null)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a page that exceeds its encoded-byte limit before launching a decoder", async () => {
    const root = mkdtempSync(join(tmpdir(), "alesis-sample-page-limit-"));
    try {
      writeFileSync(join(root, "large.mp3"), Buffer.alloc(16));
      const library = new SampleLibrary(root, { maxPageBytes: 8 });
      await library.scan();
      await expect(library.loadPage(0)).rejects.toThrow(/page exceeds 8 byte limit/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!canGenerateMp3)("rejects compressed input whose decoded PCM exceeds the page budget", async () => {
    const root = mkdtempSync(join(tmpdir(), "alesis-decoded-page-limit-"));
    const library = new SampleLibrary(root, { maxDurationSeconds: 1, maxPageBytes: 4_096 });
    try {
      const path = join(root, "small.mp3");
      const generated = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.25", "-codec:a", "libmp3lame", "-q:a", "5", path], { encoding: "utf8" });
      if (generated.status !== 0) throw new Error(generated.stderr || "Unable to generate MP3 page-limit sample");
      expect(statSync(path).size).toBeLessThan(4_096);
      await library.scan();
      await expect(library.loadPage(0)).rejects.toThrow(/exceeds remaining page byte limit/);
    } finally {
      await library.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects individual files above the hard file-size limit", async () => {
    const root = mkdtempSync(join(tmpdir(), "alesis-sample-file-limit-"));
    try {
      const path = join(root, "sparse.mp3");
      writeFileSync(path, "");
      truncateSync(path, SAMPLE_MAX_FILE_BYTES + 1);
      const library = new SampleLibrary(root);
      await library.scan();
      await expect(library.loadPage(0)).rejects.toThrow(/file exceeds 33554432 byte limit/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!canGenerateMp3)("decodes generated MP3 audio once into bounded 48 kHz interleaved stereo PCM", async () => {
    const root = mkdtempSync(join(tmpdir(), "alesis-sample-decode-"));
    try {
      const path = join(root, "tone.mp3");
      const generated = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-codec:a", "libmp3lame", "-q:a", "5", path], { encoding: "utf8" });
      if (generated.status !== 0) throw new Error(generated.stderr || "Unable to generate MP3 test sample");
      for (let index = 0; index < SAMPLE_PAGE_SIZE; index += 1) copyFileSync(path, join(root, `copy-${index}.mp3`));
      const library = new SampleLibrary(root, { maxDurationSeconds: 1 });
      const descriptors = await library.scan();
      const descriptor = descriptors.find(({ name }) => name === "tone");
      const page = await library.loadPage(0);
      const remainder = await library.loadPage(1);
      expect(descriptors).toHaveLength(9);
      expect(descriptor?.name).toBe("tone");
      expect(page).toHaveLength(8);
      expect(page.every((sample) => sample !== null)).toBe(true);
      expect(page.at(-1)?.name).toBe("copy-7");
      expect(remainder).toHaveLength(8);
      expect(remainder[0]?.name).toBe("tone");
      expect(remainder.slice(1).every((sample) => sample === null)).toBe(true);
      expect(page[0]?.samples.length).toBeGreaterThan(0);
      expect(page[0]!.samples.length).toBeLessThan(2 * 48_000 * 2);
      expect(Array.from(page[0]!.samples).every(Number.isFinite)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!canGenerateMp3)("preserves synthetic audio identity across library pages and mixer controls", async () => {
    const root = mkdtempSync(join(tmpdir(), "alesis-sample-pages-"));
    const frequencies = Array.from({ length: 10 }, (_, index) => 180 + index * 65);
    const generatedArgs = ["-nostdin", "-v", "error"];
    for (const frequency of frequencies) {
      generatedArgs.push("-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=0.25`);
    }
    for (let index = 0; index < frequencies.length; index += 1) {
      generatedArgs.push(
        "-map", `${index}:a:0`, "-codec:a", "libmp3lame", "-q:a", "5",
        join(root, `tone-${String(index).padStart(2, "0")}.mp3`),
      );
    }

    const library = new SampleLibrary(root, { maxDurationSeconds: 1 });
    try {
      const generated = spawnSync("ffmpeg", generatedArgs, { encoding: "utf8" });
      if (generated.status !== 0) throw new Error(generated.stderr || "Unable to generate synthetic MP3 samples");

      const descriptors = await library.scan();
      const firstPage = await library.loadPage(0);
      const lastPage = await library.loadPage(1);
      expect(descriptors).toHaveLength(10);
      expect(firstPage.map((sample) => sample?.name ?? null)).toEqual([
        "tone-00", "tone-01", "tone-02", "tone-03", "tone-04", "tone-05", "tone-06", "tone-07",
      ]);
      expect(lastPage.map((sample) => sample?.name ?? null)).toEqual(["tone-08", "tone-09", null, null, null, null, null, null]);

      const mixer = new SampleMixer();
      const renderPad = (pad: number, expectedFrequency: number): void => {
        mixer.trigger(pad, 127);
        const rendered = mixer.render(Math.floor(0.22 * 48_000));
        expect(signalRms(rendered)).toBeGreaterThan(0.01);
        const measuredFrequency = estimatePositiveCrossingFrequency(rendered, 0.05, 0.22);
        expect(Math.abs(measuredFrequency - expectedFrequency)).toBeLessThan(12);
        mixer.panic();
      };

      mixer.setPage(firstPage);
      renderPad(0, 180);
      renderPad(7, 635);

      mixer.trigger(0, 127);
      mixer.setPage(lastPage);
      expect(mixer.activeVoiceCount).toBe(0);
      expect(mixer.render(256)).toEqual(new Float32Array(512));
      renderPad(0, 700);
      renderPad(1, 765);

      mixer.trigger(2, 127);
      expect(mixer.render(256)).toEqual(new Float32Array(512));
      mixer.trigger(0, 127);
      mixer.panic();
      expect(mixer.render(256)).toEqual(new Float32Array(512));

      const assigned = await library.loadSlots([descriptors[9]!.id, descriptors[0]!.id, "missing", null, null, null, null, null]);
      expect(assigned.map((sample) => sample?.name ?? null)).toEqual(["tone-09", "tone-00", null, null, null, null, null, null]);
      mixer.setPage(assigned);
      renderPad(0, 765);
      renderPad(1, 180);
      rmSync(join(root, "tone-00.mp3"));
      symlinkSync("/dev/null", join(root, "tone-00.mp3"));
      const unavailable = await library.loadSlots([descriptors[0]!.id, descriptors[9]!.id, null, null, null, null, null, null]);
      expect(unavailable[0]).toBeNull();
      expect(unavailable[1]?.name).toBe("tone-09");
    } finally {
      await library.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!canGenerateMp3)("reports corrupt MP3s and samples exceeding the configured duration", async () => {
    const root = mkdtempSync(join(tmpdir(), "alesis-sample-invalid-"));
    try {
      writeFileSync(join(root, "broken.mp3"), "not an mp3");
      const corrupt = new SampleLibrary(root);
      await corrupt.scan();
      await expect(corrupt.loadPage(0)).rejects.toThrow(/Unable to decode sample broken|no decodable audio: broken/);

      rmSync(join(root, "broken.mp3"));
      const generated = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=0.25", "-codec:a", "libmp3lame", "-q:a", "5", join(root, "long.mp3")], { encoding: "utf8" });
      if (generated.status !== 0) throw new Error(generated.stderr || "Unable to generate duration test sample");
      const limited = new SampleLibrary(root, { maxDurationSeconds: 0.1 });
      await limited.scan();
      await expect(limited.loadPage(0)).rejects.toThrow(/duration limit/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("SamplePlayer", () => {
  it("sends owned preview PCM unchanged and stops its pump before killing the owned child", async () => {
    vi.useFakeTimers();
    const child = fixtureChild();
    const chunks: Buffer[] = [];
    child.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    const source = vi.fn((frames: number) => Buffer.alloc(frames * 4, Buffer.from([1, 2, 3, 4])));
    const player = new SamplePlayer("null", { spawnProcess: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn, renderPcm: source, stopImmediately: true });
    try {
      const starting = player.start(); child.emit("spawn"); await starting;
      await vi.advanceTimersByTimeAsync(30);
      expect(chunks.length).toBeGreaterThan(1);
      expect(Buffer.concat(chunks)).toEqual(Buffer.alloc(chunks.reduce((sum, chunk) => sum + chunk.length, 0), Buffer.from([1, 2, 3, 4])));
      const closing = player.close();
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      child.emit("exit", null, "SIGKILL"); await closing;
      const count = source.mock.calls.length;
      await vi.advanceTimersByTimeAsync(100);
      expect(source).toHaveBeenCalledTimes(count);
    } finally { child.exitCode = 0; await player.close(); vi.useRealTimers(); }
  });

  it("keeps a failed preview stream owned until its child exits", async () => {
    const child = fixtureChild();
    let closing: Promise<void> | undefined;
    let closed = false;
    const player = new SamplePlayer("null", { spawnProcess: vi.fn(() => child) as unknown as typeof import("node:child_process").spawn, stopImmediately: true, onError: () => { closing = player.close().then(() => { closed = true; }); } });
    try {
      const starting = player.start(); child.emit("spawn"); await starting;
      child.stdin.emit("error", new Error("lost output"));
      await Promise.resolve(); await Promise.resolve();
      expect(closed).toBe(false);
    } finally {
      child.exitCode = 1; child.emit("exit", 1, null);
      await closing; await player.close();
    }
    expect(closed).toBe(true);
  });

  it("keeps a replacement pump running when an old child exits late", async () => {
    vi.useFakeTimers();
    const first = fixtureChild();
    const replacement = fixtureChild();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(replacement) as unknown as (typeof import("node:child_process"))["spawn"];
    const player = new SamplePlayer("default", { spawnProcess });
    try {
      const firstStart = player.start();
      first.emit("spawn");
      await firstStart;
      first.stdin.emit("error", new Error("stream failed"));

      const replacementStart = player.start();
      replacement.emit("spawn");
      await replacementStart;
      const write = vi.spyOn(replacement.stdin, "write");
      first.emit("exit", 1, null);
      await vi.advanceTimersByTimeAsync(10);
      expect(write).toHaveBeenCalled();
    } finally {
      const closing = player.close();
      replacement.emit("exit", 0, null);
      await closing;
      vi.useRealTimers();
    }
  });

  it("keeps exact PCM flowing when 10 ms pump callbacks arrive every 11 ms", async () => {
    const callbacks: Array<() => void> = [];
    let requestedIntervalMs = 0;
    let monotonicMs = 0;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: (...args: unknown[]) => void, delay?: number) => {
      requestedIntervalMs = delay ?? 0;
      callbacks.push(() => callback());
      return {} as NodeJS.Timeout;
    }) as typeof globalThis.setInterval);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    const child = fixtureChild();
    const player = new SamplePlayer("default", {
      spawnProcess: vi.fn(() => child) as unknown as (typeof import("node:child_process"))["spawn"],
      monotonicNow: () => monotonicMs,
    });
    const pcmChunks: Buffer[] = [];
    let suppliedFrames = 0;
    let consumerQueueFrames = 0;
    let underrunFrames = 0;
    const toneFrames = 3 * 48_000;
    const tone = new Float32Array(toneFrames * 2);
    for (let frame = 0; frame < toneFrames; frame += 1) {
      const value = 0.08 * Math.sin(2 * Math.PI * 440 * frame / 48_000);
      tone[frame * 2] = value;
      tone[frame * 2 + 1] = value;
    }
    child.stdin.on("data", (chunk: Buffer) => {
      expect(chunk.length % 4).toBe(0);
      pcmChunks.push(Buffer.from(chunk));
      suppliedFrames += chunk.length / 4;
      consumerQueueFrames += chunk.length / 4;
    });
    player.setPage([{ id: "continuous-tone", name: "continuous-tone", samples: tone }]);
    player.trigger(0, 127);

    try {
      const starting = player.start();
      child.emit("spawn");
      await starting;
      expect(callbacks).toHaveLength(1);
      expect(requestedIntervalMs).toBe(10);
      expect(suppliedFrames).toBe(20 * 48);

      let elapsedMs = 0;
      const delayedCallbackMs = 11;
      for (let callback = 0; callback < 200; callback += 1) {
        elapsedMs += delayedCallbackMs;
        monotonicMs = elapsedMs;
        const demandFrames = Math.floor(elapsedMs * 48) - Math.floor((elapsedMs - delayedCallbackMs) * 48);
        const consumedFrames = Math.min(consumerQueueFrames, demandFrames);
        consumerQueueFrames -= consumedFrames;
        underrunFrames += demandFrames - consumedFrames;
        callbacks[0]!();
      }

      expect(elapsedMs).toBeGreaterThanOrEqual(2_000);
      expect(suppliedFrames).toBe(20 * 48 + elapsedMs * 48);
      expect(underrunFrames).toBe(0);
      expect(consumerQueueFrames).toBe(20 * 48);

      const reference = new SampleMixer();
      reference.setPage([{ id: "continuous-tone", name: "continuous-tone", samples: tone }]);
      reference.trigger(0, 127);
      const expectedPcm = stereoFloatToDualMonoS16(reference.render(suppliedFrames));
      expect(Buffer.concat(pcmChunks)).toEqual(expectedPcm);
    } finally {
      const closing = player.close();
      child.emit("exit", 0, null);
      await closing;
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it("rebases after a one-second stall without flooding the accepted downstream queue", async () => {
    const callbacks: Array<() => void> = [];
    let monotonicMs = 0;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: (...args: unknown[]) => void) => {
      callbacks.push(() => callback());
      return {} as NodeJS.Timeout;
    }) as typeof globalThis.setInterval);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    const child = fixtureChild();
    const pcmChunks: Buffer[] = [];
    let downstreamQueueFrames = 0;
    child.stdin.on("data", (chunk: Buffer) => {
      pcmChunks.push(Buffer.from(chunk));
      downstreamQueueFrames += chunk.length / 4;
    });
    const tone = new Float32Array(3 * 48_000 * 2);
    tone.fill(0.1);
    const player = new SamplePlayer("default", {
      spawnProcess: vi.fn(() => child) as unknown as (typeof import("node:child_process"))["spawn"],
      monotonicNow: () => monotonicMs,
    });
    let consumedThroughFrames = 0;
    let underrunFrames = 0;
    const consumeToNow = (): void => {
      const targetFrames = Math.floor(monotonicMs * 48);
      const demandFrames = targetFrames - consumedThroughFrames;
      consumedThroughFrames = targetFrames;
      const consumedFrames = Math.min(downstreamQueueFrames, demandFrames);
      downstreamQueueFrames -= consumedFrames;
      underrunFrames += demandFrames - consumedFrames;
    };

    player.setPage([fixtureSample("tone", Array.from(tone))]);
    player.trigger(0, 127);
    try {
      const starting = player.start();
      child.emit("spawn");
      await starting;
      expect(downstreamQueueFrames).toBe(960);
      expect(child.stdin.writableLength).toBe(0);

      monotonicMs = 1_000;
      consumeToNow();
      callbacks[0]!();
      expect(downstreamQueueFrames).toBe(960);
      expect(underrunFrames).toBe(48_000 - 960);

      for (let tick = 0; tick < 100; tick += 1) {
        monotonicMs += 10;
        consumeToNow();
        callbacks[0]!();
        expect(downstreamQueueFrames).toBe(960);
        expect(child.stdin.writableLength).toBe(0);
      }
      expect(underrunFrames).toBe(48_000 - 960);
      expect(downstreamQueueFrames).toBe(960);

      const suppliedFrames = pcmChunks.reduce((frames, chunk) => frames + chunk.length / 4, 0);
      const reference = new SampleMixer();
      reference.setPage([fixtureSample("tone", Array.from(tone))]);
      reference.trigger(0, 127);
      expect(Buffer.concat(pcmChunks)).toEqual(stereoFloatToDualMonoS16(reference.render(suppliedFrames)));
    } finally {
      const closing = player.close();
      child.emit("exit", 0, null);
      await closing;
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it("bounds catch-up writes and pauses while stdin reports backpressure", async () => {
    const callbacks: Array<() => void> = [];
    let monotonicMs = 0;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: (...args: unknown[]) => void) => {
      callbacks.push(() => callback());
      return {} as NodeJS.Timeout;
    }) as typeof globalThis.setInterval);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    const child = fixtureChild();
    child.stdin.on("data", () => {});
    const originalWrite = child.stdin.write.bind(child.stdin);
    const writes: Buffer[] = [];
    let returnFalse = true;
    const write = vi.spyOn(child.stdin, "write").mockImplementation(((chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk);
      writes.push(buffer);
      originalWrite(buffer);
      return !returnFalse;
    }) as typeof child.stdin.write);
    const player = new SamplePlayer("default", {
      spawnProcess: vi.fn(() => child) as unknown as (typeof import("node:child_process"))["spawn"],
      monotonicNow: () => monotonicMs,
    });

    try {
      const starting = player.start();
      child.emit("spawn");
      await starting;
      expect(writes).toHaveLength(1);
      expect(writes[0]!.length / 4).toBe(960);

      monotonicMs = 10_000;
      callbacks[0]!();
      monotonicMs = 20_000;
      callbacks[0]!();
      expect(writes).toHaveLength(1);

      returnFalse = false;
      child.stdin.emit("drain");
      expect(writes).toHaveLength(2);
      expect(writes[1]!.length / 4).toBe(960);

      monotonicMs += 10;
      callbacks[0]!();
      expect(writes).toHaveLength(3);
      expect(writes[2]!.length / 4).toBe(480);

      returnFalse = true;
      monotonicMs += 10;
      callbacks[0]!();
      expect(writes).toHaveLength(4);
      expect(writes[3]!.length / 4).toBe(480);
      monotonicMs += 1_000;
      callbacks[0]!();
      expect(writes).toHaveLength(4);

      returnFalse = false;
      child.stdin.emit("drain");
      expect(writes).toHaveLength(5);
      expect(writes[4]!.length / 4).toBe(960);
      returnFalse = true;
      monotonicMs += 10;
      callbacks[0]!();
      expect(writes).toHaveLength(6);
      expect(writes[5]!.length / 4).toBe(480);
      expect(writes.every((chunk) => chunk.length % 4 === 0 && chunk.length / 4 <= 960)).toBe(true);

      const closing = player.close();
      child.emit("exit", 0, null);
      await closing;
      expect(child.stdin.listenerCount("drain")).toBe(0);
      const writesAtClose = writes.length;
      monotonicMs += 10;
      callbacks[0]!();
      expect(writes).toHaveLength(writesAtClose);
    } finally {
      if (player) {
        const closing = player.close();
        child.emit("exit", 0, null);
        await closing;
      }
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      write.mockRestore();
    }
  });
});
