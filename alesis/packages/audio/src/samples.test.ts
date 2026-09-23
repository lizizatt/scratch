import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import { SAMPLE_MAX_FILE_BYTES, SAMPLE_PAGE_SIZE, SampleLibrary, SampleMixer, SamplePlayer } from "./samples.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const encoderList = hasFfmpeg ? spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }) : null;
const canGenerateMp3 = Boolean(encoderList?.status === 0 && `${encoderList.stdout}${encoderList.stderr}`.includes("libmp3lame"));

function fixtureSample(id: string, values: number[]): { id: string; name: string; samples: Float32Array } {
  return { id, name: id, samples: new Float32Array(values) };
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
});
