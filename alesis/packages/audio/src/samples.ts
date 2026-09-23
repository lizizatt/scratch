import { spawn } from "node:child_process";
import { realpath, readdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import { alsaPlaybackArguments, fluidSynthStdio, stereoFloatToDualMonoS16 } from "./index.js";

export interface SampleDescriptor {
  id: string;
  name: string;
  path: string;
}

export interface DecodedSample {
  id: string;
  name: string;
  samples: Float32Array;
}

export interface SampleLibraryOptions {
  maxDurationSeconds?: number;
  maxPageBytes?: number;
}

export const SAMPLE_PAGE_SIZE = 8;
export const SAMPLE_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const SAMPLE_MAX_DURATION_SECONDS = 30;
export const SAMPLE_MAX_PAGE_BYTES = 64 * 1024 * 1024;
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FLOAT_BYTES = 4;
const FFMPEG_TIMEOUT_MS = 30_000;

export class SampleLibrary {
  private sampleDescriptors: SampleDescriptor[] = [];
  private scanned = false;
  private rootPath: string | null = null;
  private readonly decoderAbort = new AbortController();
  private readonly activeDecodes = new Set<Promise<Float32Array>>();
  private closed = false;
  private readonly maxDurationSeconds: number;
  private readonly maxPageBytes: number;

  constructor(private readonly root: string, options: SampleLibraryOptions = {}) {
    this.maxDurationSeconds = options.maxDurationSeconds ?? SAMPLE_MAX_DURATION_SECONDS;
    this.maxPageBytes = options.maxPageBytes ?? SAMPLE_MAX_PAGE_BYTES;
    if (!Number.isFinite(this.maxDurationSeconds) || this.maxDurationSeconds <= 0 || this.maxDurationSeconds > SAMPLE_MAX_DURATION_SECONDS) {
      throw new RangeError(`maxDurationSeconds must be greater than 0 and at most ${SAMPLE_MAX_DURATION_SECONDS}`);
    }
    if (!Number.isSafeInteger(this.maxPageBytes) || this.maxPageBytes <= 0 || this.maxPageBytes > 256 * 1024 * 1024) {
      throw new RangeError("maxPageBytes must be a positive integer no greater than 256 MiB");
    }
  }

  async scan(): Promise<SampleDescriptor[]> {
    try {
      this.rootPath = await realpath(this.root);
    } catch (error) {
      if (isMissing(error)) {
        this.rootPath = null;
        this.sampleDescriptors = [];
        this.scanned = true;
        return [];
      }
      throw new Error(`Unable to scan sample directory: ${errorMessage(error)}`);
    }

    const files = await collectMp3Files(this.rootPath);
    const usedIds = new Set<string>();
    this.sampleDescriptors = files.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0)
      .map(({ path, relativePath }) => {
        const withoutExtension = relativePath.slice(0, -extname(relativePath).length);
        const baseId = withoutExtension.replaceAll(sep, "/").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sample";
        let id = baseId;
        let suffix = 2;
        while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
        usedIds.add(id);
        const filename = basename(path);
        return { id, name: filename.slice(0, -extname(filename).length), path };
      });
    this.scanned = true;
    return this.descriptors.map((descriptor) => ({ ...descriptor }));
  }

  get descriptors(): readonly SampleDescriptor[] {
    return this.sampleDescriptors.map((descriptor) => ({ ...descriptor }));
  }

  async loadPage(pageIndex: number): Promise<Array<DecodedSample | null>> {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new RangeError("pageIndex must be a non-negative integer");
    if (this.closed) throw new Error("Sample library is closed");
    if (!this.scanned) await this.scan();
    const page = this.sampleDescriptors.slice(pageIndex * SAMPLE_PAGE_SIZE, (pageIndex + 1) * SAMPLE_PAGE_SIZE);
    const result: Array<DecodedSample | null> = Array(SAMPLE_PAGE_SIZE).fill(null);
    if (!page.length || !this.rootPath) return result;

    let pageBytes = 0;
    const files: Array<{ descriptor: SampleDescriptor }> = [];
    for (const descriptor of page) {
      const safePath = await resolveInsideRoot(this.rootPath, descriptor.path);
      const metadata = await stat(safePath);
      if (!metadata.isFile()) throw new Error(`Sample is not a regular file: ${descriptor.name}`);
      if (metadata.size > SAMPLE_MAX_FILE_BYTES) throw new Error(`Sample file exceeds ${SAMPLE_MAX_FILE_BYTES} byte limit: ${descriptor.name}`);
      pageBytes += metadata.size;
      if (pageBytes > this.maxPageBytes) throw new Error(`Sample page exceeds ${this.maxPageBytes} byte limit`);
      files.push({ descriptor });
    }

    let decodedPageBytes = 0;
    for (let index = 0; index < files.length; index += 1) {
      if (this.closed) throw new Error("Sample library is closed");
      const { descriptor } = files[index]!;
      const remainingBytes = this.maxPageBytes - decodedPageBytes;
      if (remainingBytes <= 0) throw new Error(`Decoded sample page exceeds ${this.maxPageBytes} byte limit`);
      const decoding = decodeMp3(descriptor.path, descriptor.name, this.maxDurationSeconds, remainingBytes, this.decoderAbort.signal);
      this.activeDecodes.add(decoding);
      try {
        const samples = await decoding;
        decodedPageBytes += samples.byteLength;
        result[index] = { id: descriptor.id, name: descriptor.name, samples };
      } finally {
        this.activeDecodes.delete(decoding);
      }
    }
    return result;
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.decoderAbort.abort();
    }
    await Promise.allSettled([...this.activeDecodes]);
  }
}

async function collectMp3Files(rootPath: string): Promise<Array<{ path: string; relativePath: string }>> {
  const found: Array<{ path: string; relativePath: string }> = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(candidate);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (extname(entry.name).toLowerCase() !== ".mp3") continue;
      try {
        const path = await realpath(candidate);
        if (!isInside(rootPath, path) || !(await stat(path)).isFile()) continue;
        found.push({ path, relativePath: relative(rootPath, candidate) });
      } catch (error) {
        if (!isMissing(error)) throw new Error(`Unable to inspect sample ${entry.name}: ${errorMessage(error)}`);
      }
    }
  };
  await visit(rootPath);
  return found;
}

async function resolveInsideRoot(rootPath: string, path: string): Promise<string> {
  const canonical = await realpath(path);
  if (!isInside(rootPath, canonical)) throw new Error("Sample path resolves outside the sample directory");
  return canonical;
}

function isInside(rootPath: string, path: string): boolean {
  const rel = relative(rootPath, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function decodeMp3(path: string, name: string, maxDurationSeconds: number, maxOutputBytes: number, signal: AbortSignal): Promise<Float32Array> {
  const expectedMaxBytes = Math.ceil(maxDurationSeconds * SAMPLE_RATE) * CHANNELS * FLOAT_BYTES;
  const outputLimit = Math.min(Math.ceil((maxDurationSeconds + 1) * SAMPLE_RATE) * CHANNELS * FLOAT_BYTES, maxOutputBytes);
  const pageByteLimited = maxOutputBytes < Math.ceil((maxDurationSeconds + 1) * SAMPLE_RATE) * CHANNELS * FLOAT_BYTES;
  const decodeSeconds = maxDurationSeconds + 1;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("ffmpeg", [
      "-nostdin", "-v", "error", "-i", path,
      "-map", "0:a:0", "-vn", "-sn", "-dn",
      "-t", String(decodeSeconds), "-ac", String(CHANNELS), "-ar", String(SAMPLE_RATE),
      "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let outputLimitExceeded = false;
    let stopReading = false;
    let childError: Error | null = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      stopReading = true;
      child.kill("SIGKILL");
    }, FFMPEG_TIMEOUT_MS);
    const onAbort = (): void => {
      cancelled = true;
      stopReading = true;
      child.kill("SIGKILL");
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(new Error(message));
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled || stopReading) return;
      outputBytes += chunk.length;
      if (outputBytes > outputLimit) {
        outputLimitExceeded = true;
        stopReading = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (settled || stopReading) return;
      stderr = `${stderr}${String(chunk)}`.slice(-8_192);
    });
    child.once("error", (error) => {
      childError = error;
      stopReading = true;
      child.kill("SIGKILL");
    });
    child.once("spawn", () => {
      if (stopReading) child.kill("SIGKILL");
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      if (cancelled) return fail(`Sample decoding cancelled: ${name}`);
      if (timedOut) return fail(`Timed out decoding sample ${name} after ${FFMPEG_TIMEOUT_MS} ms`);
      if (outputLimitExceeded) {
        return fail(pageByteLimited
          ? `Decoded sample exceeds remaining page byte limit: ${name}`
          : `Decoded sample exceeds bounded output limit: ${name}`);
      }
      if (childError) return fail(`Unable to decode sample ${name}: ${childError.message}`);
      if (code !== 0) return fail(`Unable to decode sample ${name} (ffmpeg ${signal ?? `exit ${code}`}): ${stderr.trim() || "invalid or unsupported MP3"}`);
      if (outputBytes === 0) return fail(`Sample contains no decodable audio: ${name}`);
      if (outputBytes % (CHANNELS * FLOAT_BYTES) !== 0) return fail(`Decoded sample has incomplete stereo PCM frames: ${name}`);
      if (outputBytes > expectedMaxBytes) return fail(`Sample exceeds ${maxDurationSeconds} second duration limit: ${name}`);
      const pcm = Buffer.concat(chunks, outputBytes);
      const samples = new Float32Array(outputBytes / FLOAT_BYTES);
      for (let offset = 0; offset < samples.length; offset += 1) {
        const value = pcm.readFloatLE(offset * FLOAT_BYTES);
        samples[offset] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
      }
      settled = true;
      cleanup();
      resolvePromise(samples);
    });
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface SampleVoice {
  readonly sample: DecodedSample;
  readonly gain: number;
  readonly startedAt: number;
  frame: number;
}

export class SampleMixer {
  private page: readonly (DecodedSample | null)[] = Array(SAMPLE_PAGE_SIZE).fill(null);
  private readonly voices: SampleVoice[] = [];
  private sequence = 0;

  constructor(readonly maxVoices = 32) {
    if (!Number.isSafeInteger(maxVoices) || maxVoices < 1) throw new RangeError("maxVoices must be a positive integer");
  }

  get activeVoiceCount(): number {
    return this.voices.length;
  }

  setPage(samples: readonly (DecodedSample | null)[]): void {
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
    if (!Number.isSafeInteger(frameCount) || frameCount < 0) throw new RangeError("frameCount must be a non-negative integer");
    const output = new Float32Array(frameCount * CHANNELS);
    if (frameCount === 0 || this.voices.length === 0) return output;

    if (this.voices.length === 1) {
      const voice = this.voices[0]!;
      const samples = voice.sample.samples;
      const framesToRender = Math.min(frameCount, Math.floor(samples.length / CHANNELS) - voice.frame);
      for (let frame = 0; frame < framesToRender; frame += 1) {
        const offset = (voice.frame + frame) * CHANNELS;
        const sampleLeft = samples[offset]!;
        const sampleRight = samples[offset + 1]!;
        let left = 0;
        let right = 0;
        left += (Number.isFinite(sampleLeft) ? Math.max(-1, Math.min(1, sampleLeft)) : 0) * voice.gain;
        right += (Number.isFinite(sampleRight) ? Math.max(-1, Math.min(1, sampleRight)) : 0) * voice.gain;
        output[frame * CHANNELS] = Math.max(-1, Math.min(1, left));
        output[frame * CHANNELS + 1] = Math.max(-1, Math.min(1, right));
      }
      voice.frame += framesToRender;
      if (framesToRender < frameCount) this.voices.length = 0;
      return output;
    }

    for (let frame = 0; frame < frameCount; frame += 1) {
      let left = 0;
      let right = 0;
      for (let index = this.voices.length - 1; index >= 0; index -= 1) {
        const voice = this.voices[index]!;
        const offset = voice.frame * CHANNELS;
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
      output[frame * CHANNELS] = Math.max(-1, Math.min(1, left));
      output[frame * CHANNELS + 1] = Math.max(-1, Math.min(1, right));
    }
    return output;
  }

  panic(): void {
    this.voices.length = 0;
  }
}

export interface SamplePlayerOptions {
  onError?: (message: string) => void;
  spawnProcess?: typeof spawn;
}

export class SamplePlayer {
  private readonly mixer = new SampleMixer(32);
  private child: ChildProcess | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private starting: Promise<void> | null = null;
  private closing = false;

  constructor(private readonly pcm: string, private readonly options: SamplePlayerOptions = {}) {}

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.closing = false;
    const spawnProcess = this.options.spawnProcess ?? spawn;
    const child = spawnProcess("aplay", alsaPlaybackArguments(this.pcm), { stdio: fluidSynthStdio }) as ChildProcessWithoutNullStreams;
    this.child = child;
    child.stdout?.resume();
    child.stderr?.resume();
    let reportedFailure = false;
    let childTimer: ReturnType<typeof setInterval> | null = null;
    const report = (message: string): void => {
      if (reportedFailure) return;
      reportedFailure = true;
      this.options.onError?.(message);
    };
    const stopPump = (): void => {
      if (childTimer) clearInterval(childTimer);
      if (this.timer === childTimer) this.timer = null;
      childTimer = null;
    };
    child.stdin?.on("error", (error) => {
      stopPump();
      if (this.child === child) this.child = null;
      if (!this.closing) report(`Sample playback stream failed: ${error.message}`);
      child.kill("SIGTERM");
    });
    child.once("error", (error) => {
      stopPump();
      if (this.child === child) this.child = null;
      if (!this.closing) report(`Unable to start aplay: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      stopPump();
      if (this.child === child) this.child = null;
      if (!this.closing) report(`Sample playback exited (${signal ?? code ?? "unknown"})`);
    });
    this.starting = new Promise<void>((resolvePromise, rejectPromise) => {
      const onSpawn = (): void => {
        cleanup();
        if (this.child !== child || child.exitCode !== null || child.signalCode !== null) {
          rejectPromise(new Error("aplay exited while starting sample playback"));
          return;
        }
        childTimer = setInterval(() => {
          const input = child.stdin;
          if (this.child !== child || !input?.writable || input.writableLength > 48_000) return;
          input.write(stereoFloatToDualMonoS16(this.mixer.render(480)));
        }, 10);
        this.timer = childTimer;
        resolvePromise();
      };
      const onError = (error: Error): void => {
        cleanup();
        rejectPromise(error);
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        cleanup();
        rejectPromise(new Error(`aplay exited while starting sample playback (${signal ?? code ?? "unknown"})`));
      };
      const cleanup = (): void => {
        child.off("spawn", onSpawn);
        child.off("error", onError);
        child.off("exit", onExit);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
      child.once("exit", onExit);
    }).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  setPage(samples: readonly (DecodedSample | null)[]): void {
    this.mixer.setPage(samples);
  }

  trigger(pad: number, velocity: number): void {
    this.mixer.trigger(pad, velocity);
  }

  panic(): void {
    this.mixer.panic();
  }

  async close(): Promise<void> {
    this.closing = true;
    this.mixer.panic();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const child = this.child;
    this.child = null;
    if (this.starting) await this.starting.catch(() => {});
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.stdin?.end();
    if (await waitForChildExit(child, 500)) return;
    child.kill("SIGTERM");
    if (await waitForChildExit(child, 500)) return;
    child.kill("SIGKILL");
    await waitForChildExit(child, 500);
  }
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    const finish = (exited: boolean): void => {
      clearTimeout(timeout);
      child.off("exit", onExit);
      resolvePromise(exited);
    };
    const onExit = (): void => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}
