import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { cpus, platform, release } from "node:os";
import { SampleMixer, SamplePlayer } from "../packages/audio/src/samples.js";
import { stereoFloatToDualMonoS16 } from "../packages/audio/src/index.js";

// Synthetic PCM only: no ALSA device, sample library, audio settings, or speaker output is touched.
// The paced sink measures producer timing/underruns; it cannot establish an audible speaker symptom.
// --baseline reproduces the old fixed 480-frame / 10 ms pump; --duration-ms=N sets run time (default 10000).
const SAMPLE_RATE = 48_000;
const CALLBACK_MS = 10;
const CONSUMER_TICK_MS = 5;
const DEFAULT_DURATION_MS = 10_000;
const args = process.argv.slice(2);
const baseline = args.includes("--baseline");
const durationArgument = args.find((arg) => arg.startsWith("--duration-ms="));
const durationMs = durationArgument ? Number(durationArgument.slice("--duration-ms=".length)) : DEFAULT_DURATION_MS;
if (!Number.isSafeInteger(durationMs) || durationMs < 100 || durationMs > 300_000) {
  throw new RangeError("--duration-ms must be an integer from 100 through 300000");
}

class PacedInput extends Writable {
  queuedFrames = 0;
  maxQueuedFrames = 0;
  consumedFrames = 0;
  suppliedFrames = 0;
  underrunFrames = 0;
  private demandFrames = 0;
  onPcmWrite: (() => void) | null = null;

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.onPcmWrite?.();
    const frames = chunk.length / 4;
    this.suppliedFrames += frames;
    this.queuedFrames += frames;
    this.maxQueuedFrames = Math.max(this.maxQueuedFrames, this.queuedFrames);
    callback();
  }

  consumeToElapsed(elapsedMs: number): void {
    const targetFrames = Math.floor(elapsedMs * SAMPLE_RATE / 1_000);
    const requestedFrames = targetFrames - this.demandFrames;
    if (requestedFrames <= 0) return;
    this.demandFrames = targetFrames;
    const consumedFrames = Math.min(requestedFrames, this.queuedFrames);
    this.queuedFrames -= consumedFrames;
    this.consumedFrames += consumedFrames;
    this.underrunFrames += requestedFrames - consumedFrames;
  }
}

class SimulatedAplay extends EventEmitter {
  readonly stdin = new PacedInput();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor() {
    super();
    this.stdin.once("finish", () => {
      this.exitCode = 0;
      setImmediate(() => this.emit("exit", 0, null));
    });
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.exitCode === null && this.signalCode === null) {
      this.signalCode = signal;
      setImmediate(() => this.emit("exit", null, signal));
    }
    return true;
  }
}

const child = new SimulatedAplay();
const mixer = new SampleMixer(32);
const sampleFrames = SAMPLE_RATE * 30;
const samples = new Float32Array(sampleFrames * 2);
for (let frame = 0; frame < sampleFrames; frame += 1) {
  const value = 0.08 * Math.sin(2 * Math.PI * 440 * frame / SAMPLE_RATE);
  samples[frame * 2] = value;
  samples[frame * 2 + 1] = value;
}
mixer.setPage([{ id: "benchmark-tone", name: "benchmark-tone", samples }]);
mixer.trigger(0, 127);
const writeTimes: number[] = [];

const player = baseline
  ? null
  : new SamplePlayer("no-device-is-opened", {
      spawnProcess: (() => child) as unknown as typeof import("node:child_process").spawn,
    });
player?.setPage([{ id: "benchmark-tone", name: "benchmark-tone", samples }]);
player?.trigger(0, 127);
let producerTimer: NodeJS.Timeout | null = null;
let consumerTimer: NodeJS.Timeout | null = null;
let begin: number | null = null;
child.stdin.onPcmWrite = () => {
  if (begin === null) return;
  const elapsedMs = performance.now() - begin;
  child.stdin.consumeToElapsed(elapsedMs);
  writeTimes.push(elapsedMs);
};

async function run(): Promise<void> {
  if (player) {
    const starting = player.start();
    child.emit("spawn");
    await starting;
  } else {
    child.stdin.write(stereoFloatToDualMonoS16(mixer.render(20 * SAMPLE_RATE / 1_000)));
  }

  const runStartedAt = performance.now();
  begin = runStartedAt;
  if (!player) {
    producerTimer = setInterval(() => {
      child.stdin.write(stereoFloatToDualMonoS16(mixer.render(SAMPLE_RATE * CALLBACK_MS / 1_000)));
    }, CALLBACK_MS);
  }

  consumerTimer = setInterval(() => {
    child.stdin.consumeToElapsed(performance.now() - runStartedAt);
  }, CONSUMER_TICK_MS);
  const cpuStart = process.cpuUsage();
  const initialSuppliedFrames = child.stdin.suppliedFrames;
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
  if (consumerTimer) clearInterval(consumerTimer);
  if (producerTimer) clearInterval(producerTimer);
  child.stdin.consumeToElapsed(performance.now() - runStartedAt);
  if (player) await player.close();
  else {
    child.stdin.end();
    child.exitCode = 0;
  }
  const cpu = process.cpuUsage(cpuStart);
  const elapsedMs = performance.now() - runStartedAt;
  const intervals = writeTimes.slice(1).map((time, index) => time - writeTimes[index]!);
  const sortedIntervals = [...intervals].sort((left, right) => left - right);
  const percentile = (fraction: number): number => sortedIntervals[Math.min(sortedIntervals.length - 1, Math.floor(sortedIntervals.length * fraction))] ?? 0;
  const cpuMs = (cpu.user + cpu.system) / 1_000;

  console.log(`Mode: ${baseline ? "baseline (fixed 480-frame write every 10 ms)" : "fixed (SamplePlayer)"}`);
  console.log(`Node ${process.version}; ${platform()} ${release()}; ${cpus()[0]?.model ?? "unknown CPU"}`);
  console.log(`Duration: ${elapsedMs.toFixed(1)} ms; sink is an in-process paced consumer (no ALSA device opened)`);
  console.log("metric,value");
  console.log(`frames_supplied,${child.stdin.suppliedFrames}`);
  console.log(`frames_consumed,${child.stdin.consumedFrames}`);
  console.log(`underrun_frames,${child.stdin.underrunFrames}`);
  console.log(`max_queued_frames,${child.stdin.maxQueuedFrames}`);
  console.log(`max_queued_ms,${(child.stdin.maxQueuedFrames * 1_000 / SAMPLE_RATE).toFixed(2)}`);
  console.log(`write_callbacks,${writeTimes.length}`);
  console.log(`write_interval_p50_ms,${percentile(0.5).toFixed(3)}`);
  console.log(`write_interval_p95_ms,${percentile(0.95).toFixed(3)}`);
  console.log(`write_interval_max_ms,${(Math.max(...intervals, 0)).toFixed(3)}`);
  console.log(`process_cpu_ms,${cpuMs.toFixed(2)}`);
  const renderedFrames = child.stdin.suppliedFrames - initialSuppliedFrames;
  console.log(`cpu_ms_per_48000_frames,${(cpuMs * SAMPLE_RATE / Math.max(1, renderedFrames)).toFixed(2)}`);
  console.log(`process_cpu_percent,${(100 * cpuMs / elapsedMs).toFixed(2)}`);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
