import { cpus, platform, release } from "node:os";
import { SampleMixer } from "../packages/audio/src/samples.js";

const FRAME_COUNT = 480;
const WARMUP_BATCHES = 3;
const WARMUP_BLOCKS = 60;
const MEASURED_BATCHES = 7;
const MEASURED_BLOCKS = 200;
const voiceCounts = [0, 1, 8, 32] as const;
const pcm = new Float32Array(2 * (WARMUP_BATCHES * WARMUP_BLOCKS + MEASURED_BATCHES * MEASURED_BLOCKS + 1) * FRAME_COUNT);
let seed = 0x1a2b3c4d;
for (let index = 0; index < pcm.length; index += 1) {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  const phase = (seed / 0x1_0000_0000) * 2 - 1;
  pcm[index] = index % 257 === 0 ? Number.NaN : index % 31 === 0 ? phase * 2 : phase;
}
const sample = { id: "benchmark", name: "benchmark", samples: pcm };

function makeMixer(activeVoices: number): SampleMixer {
  const mixer = new SampleMixer(32);
  mixer.setPage([sample]);
  for (let index = 0; index < activeVoices; index += 1) mixer.trigger(0, 127 - (index % 4));
  return mixer;
}

function runBatch(mixer: SampleMixer, blocks: number): { elapsedNs: number; checksum: number } {
  let output = new Float32Array(0);
  const start = process.hrtime.bigint();
  for (let block = 0; block < blocks; block += 1) output = mixer.render(FRAME_COUNT);
  const elapsedNs = Number(process.hrtime.bigint() - start);
  let checksum = 0;
  for (let index = 0; index < output.length; index += 1) checksum += output[index]!;
  return { elapsedNs, checksum };
}

function median(values: number[]): number {
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!;
}

const cpu = cpus()[0]?.model ?? "unknown CPU";
console.log(`Node ${process.version}; ${platform()} ${release()}; ${cpu}`);
console.log(`Benchmark: ${FRAME_COUNT}-frame blocks; ${WARMUP_BATCHES} warm-up batches × ${WARMUP_BLOCKS}; ${MEASURED_BATCHES} measured batches × ${MEASURED_BLOCKS}; median per block`);
console.log("voices,median_ms_per_block,median_ns_per_frame,checksum");
for (const count of voiceCounts) {
  const warmMixer = makeMixer(count);
  for (let batch = 0; batch < WARMUP_BATCHES; batch += 1) runBatch(warmMixer, WARMUP_BLOCKS);

  const durations: number[] = [];
  let checksum = 0;
  for (let batch = 0; batch < MEASURED_BATCHES; batch += 1) {
    const result = runBatch(makeMixer(count), MEASURED_BLOCKS);
    durations.push(result.elapsedNs / MEASURED_BLOCKS);
    checksum = result.checksum;
  }
  const medianNs = median(durations);
  console.log(`${count},${(medianNs / 1_000_000).toFixed(4)},${(medianNs / FRAME_COUNT).toFixed(1)},${checksum.toFixed(4)}`);
}
