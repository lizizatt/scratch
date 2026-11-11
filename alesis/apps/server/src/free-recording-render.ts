import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp, rename, rm, stat } from "node:fs/promises";
import { once } from "node:events";
import { setPriority, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { NeonPressureSynth, type NeonPressureParameters } from "@alesis/audio";
import { eventFromRecord, journalToMidi, readJournal, scanJournal, type FreeRecordingMeta } from "./free-recording-format.js";

const run = promisify(execFile);
const SAMPLE_RATE = 48_000;
/** Neon has no tail of its own; FluidSynth adds about two seconds after the last event by itself. */
const NEON_TAIL_MS = 1_500;
const FLUIDSYNTH_TAIL_MS = 2_000;
const STALL_MS = 120_000;
const NEON_BLOCK_FRAMES = 2_400;

export interface FreeRenderRequest {
  journalPath: string;
  mp3Path: string;
  meta: FreeRecordingMeta;
  soundFontPath?: string | undefined;
  percussionSoundFontPath?: string | undefined;
  signal: AbortSignal;
  onProgress(fraction: number): void;
}

/**
 * Streams the performance through FluidSynth (or Neon) straight into the MP3 encoder over FIFOs, so
 * neither a WAV nor the audio itself ever sits on disk or in memory, however long the recording is.
 */
export async function renderFreeRecording(request: FreeRenderRequest): Promise<number> {
  const { journalPath, mp3Path, meta, signal } = request;
  const scan = await scanJournal(journalPath);
  if (scan.noteCount === 0) throw new Error("No notes were played, so there is nothing to render");
  const playedMs = Math.max(meta.durationMs, scan.durationMs);
  const durationMs = playedMs + (meta.synth.id === "subtractive" ? NEON_TAIL_MS : FLUIDSYNTH_TAIL_MS);
  const work = await mkdtemp(join(tmpdir(), "alesis-free-"));
  const children = new Set<ChildProcess>();
  const partPath = `${mp3Path}.part`;
  const state: { failure: Error | null } = { failure: null };
  const abort = (error: Error): void => {
    state.failure ??= error;
    for (const child of children) child.kill("SIGKILL");
  };
  const onAbort = (): void => abort(new Error("Render canceled"));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    const producers: Array<{ fifo: string; done: Promise<void> }> = [];
    const addPart = async (name: string, produce: (fifo: string) => Promise<void>): Promise<void> => {
      const fifo = join(work, `${name}.pcm`);
      await run("mkfifo", [fifo]);
      const done = produce(fifo);
      done.catch((error: unknown) => abort(error instanceof Error ? error : new Error(String(error))));
      producers.push({ fifo, done });
    };
    const spawnTracked = (command: string, args: string[], stdout: "ignore" | "pipe"): ChildProcess => {
      const child = spawn(command, args, { stdio: ["ignore", stdout, "pipe"] });
      children.add(child);
      try { if (child.pid) setPriority(child.pid, 10); } catch { /* Lowering priority is best effort. */ }
      return child;
    };
    const exited = (child: ChildProcess, label: string): Promise<void> => new Promise((resolve, reject) => {
      let stderr = "";
      child.stderr?.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-2_000); });
      child.once("error", reject);
      child.once("close", (code) => {
        children.delete(child);
        if (code === 0) resolve();
        else reject(state.failure ?? new Error(`${label} exited ${code}: ${stderr.trim().split("\n").at(-1) ?? ""}`));
      });
    });
    const soundFontPart = async (name: string, channels: "melodic" | "percussion", font: string): Promise<void> => {
      if (!existsSync(font)) throw new Error(`SoundFont is no longer installed: ${font}`);
      const midi = join(work, `${name}.mid`);
      await journalToMidi(journalPath, midi, meta, channels);
      await addPart(name, async (fifo) => {
        await exited(spawnTracked("fluidsynth", fluidSynthArguments(meta.synth.params, font, midi, fifo), "ignore"), "fluidsynth");
      });
    };
    if (scan.melodicChannels.size > 0) {
      if (meta.synth.id === "subtractive") {
        await addPart("neon", (fifo) => renderNeon(fifo, journalPath, meta, playedMs + NEON_TAIL_MS, signal));
      } else {
        const font = request.soundFontPath ?? meta.synth.soundFont?.path;
        if (!font) throw new Error("This recording has no SoundFont to render with");
        await soundFontPart("melodic", "melodic", font);
      }
    }
    if (scan.hasPercussion) {
      const font = request.percussionSoundFontPath ?? request.soundFontPath ?? meta.synth.soundFont?.path;
      if (!font) throw new Error("No percussion SoundFont is installed to render drum hits");
      await soundFontPart("percussion", "percussion", font);
    }
    const ffmpeg = spawnTracked("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats",
      ...producers.flatMap(({ fifo }) => ["-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "2", "-i", fifo]),
      ...producers.length > 1 ? ["-filter_complex", `amix=inputs=${producers.length}:duration=longest:normalize=0`] : [],
      "-codec:a", "libmp3lame", "-q:a", "2", "-write_xing", "1", "-f", "mp3", "-y", partPath,
    ], "pipe");
    let lastProgress = Date.now();
    let buffered = "";
    ffmpeg.stdout?.on("data", (chunk) => {
      lastProgress = Date.now();
      buffered = `${buffered}${String(chunk)}`.slice(-1_000);
      const microseconds = [...buffered.matchAll(/out_time_us=(\d+)/g)].at(-1)?.[1];
      if (microseconds) request.onProgress(Math.min(1, Number(microseconds) / 1_000 / durationMs));
    });
    const watchdog = setInterval(() => {
      if (Date.now() - lastProgress > STALL_MS) abort(new Error("Render stalled with no progress for two minutes"));
    }, 10_000);
    try {
      await exited(ffmpeg, "ffmpeg");
      await Promise.all(producers.map(({ done }) => done));
    } finally { clearInterval(watchdog); }
    if (state.failure) throw state.failure;
    signal.throwIfAborted();
    await rename(partPath, mp3Path);
    request.onProgress(1);
    return (await stat(mp3Path)).size;
  } catch (error) {
    abort(error instanceof Error ? error : new Error(String(error)));
    await rm(partPath, { force: true });
    throw signal.aborted ? new Error("Render canceled") : state.failure ?? error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    for (const child of children) child.kill("SIGKILL");
    await rm(work, { recursive: true, force: true });
  }
}

function fluidSynthArguments(params: Record<string, number>, font: string, midi: string, fifo: string): string[] {
  return [
    "-q", "-ni", "-F", fifo, "-T", "raw", "-r", String(SAMPLE_RATE), "-o", "audio.file.format=s16",
    "-o", `synth.gain=${params.gain ?? 0.72}`,
    "-o", `synth.chorus.active=${(params["chorus-send"] ?? 0) > 0 ? 1 : 0}`,
    "-o", "synth.chorus.level=0.3",
    "-o", `synth.chorus.speed=${params["chorus-rate"] ?? 0.3}`,
    "-o", `synth.chorus.depth=${params["chorus-depth"] ?? 8}`,
    "-o", `synth.chorus.nr=${Math.round(params["chorus-voices"] ?? 3)}`,
    "-o", `synth.reverb.active=${(params["reverb-send"] ?? 0) > 0 ? 1 : 0}`,
    "-o", "synth.reverb.level=0.3",
    "-o", `synth.reverb.room-size=${params["reverb-room"] ?? 0.2}`,
    "-o", `synth.reverb.damp=${params["reverb-damping"] ?? 0}`,
    "-o", `synth.reverb.width=${params["reverb-width"] ?? 0.5}`,
    font, midi,
  ];
}

/** Renders on the host's own thread in small slices so live playing keeps its timing. */
async function renderNeon(fifo: string, journalPath: string, meta: FreeRecordingMeta, durationMs: number, signal: AbortSignal): Promise<void> {
  const synth = new NeonPressureSynth(SAMPLE_RATE, meta.synth.params as unknown as Partial<NeonPressureParameters>);
  const out = createWriteStream(fifo);
  const failed = new Promise<never>((_, reject) => out.once("error", reject));
  failed.catch(() => {});
  const write = async (chunk: Buffer): Promise<void> => {
    if (!out.write(chunk)) await Promise.race([once(out, "drain"), failed]);
  };
  let frame = 0;
  const renderTo = async (target: number): Promise<void> => {
    while (frame < target) {
      signal.throwIfAborted();
      const count = Math.min(NEON_BLOCK_FRAMES, target - frame);
      const block = synth.render(count);
      const pcm = Buffer.allocUnsafe(block.length * 2);
      for (let index = 0; index < block.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, block[index]!));
        pcm.writeInt16LE(Math.round(sample < 0 ? sample * 32_768 : sample * 32_767), index * 2);
      }
      await write(pcm);
      frame += count;
      await sleep(2);
    }
  };
  try {
    for await (const record of readJournal(journalPath)) {
      const event = eventFromRecord(record);
      if (!event || event.channel === 9) continue;
      await renderTo(Math.round(record.ms * SAMPLE_RATE / 1000));
      synth.dispatchMidi(event);
    }
    await renderTo(Math.round(durationMs * SAMPLE_RATE / 1000));
    out.end();
    await Promise.race([once(out, "close"), failed]);
  } catch (error) {
    out.destroy();
    throw error;
  }
}
