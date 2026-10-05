import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function main() {
const [font, directory, ...args] = process.argv.slice(2);
if (!font || !directory || args.some((arg) => !["--all", "--expect-one-shot"].includes(arg))) {
  throw new Error("Usage: node scripts/check-miku-sustain.mjs font.sf2 output-directory [--all] [--expect-one-shot]");
}
await mkdir(directory, { recursive: true });
const notes = args.includes("--all") ? Array.from({ length: 47 }, (_, i) => i + 48) : [48, 60, 72, 84, 94];
const oneShot = args.includes("--expect-one-shot");
function variable(value) {
  const bytes = [value & 127];
  while ((value >>= 7)) bytes.unshift((value & 127) | 128);
  return bytes;
}
function midi(note) {
  const events = Buffer.from([
    0, 0xff, 0x51, 3, 7, 0xa1, 0x20, // 120 BPM, 480 ticks/quarter
    0, 0xb0, 0, 0, 0, 0xb0, 32, 0, 0, 0xc0, 0,
    0, 0x90, note, 100,
    ...variable(5760), 0x80, note, 0, // Release after six seconds.
    ...variable(960), 0xff, 0x2f, 0,
  ]);
  const header = Buffer.from("4d546864000000060000000101e04d54726b00000000", "hex");
  header.writeUInt32BE(events.length, 18);
  return Buffer.concat([header, events]);
}
function decode(buffer) {
  let pcm, rate, channels;
  for (let p = 12; p + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(p + 4), id = buffer.toString("ascii", p, p + 4);
    if (id === "fmt ") {
      if (buffer.readUInt16LE(p + 8) !== 1 || buffer.readUInt16LE(p + 22) !== 16) throw new Error("Expected PCM16 WAV");
      channels = buffer.readUInt16LE(p + 10); rate = buffer.readUInt32LE(p + 12);
    }
    if (id === "data") pcm = buffer.subarray(p + 8, p + 8 + size);
    p += 8 + size + size % 2;
  }
  if (!pcm || !rate || !channels || pcm.length < 7 * rate * channels * 2) throw new Error("Missing or truncated audio");
  function rms(start, end) {
    let energy = 0, count = 0;
    for (let i = Math.round(start * rate) * channels; i < Math.round(end * rate) * channels; i++) {
      energy += (pcm.readInt16LE(i * 2) / 32768) ** 2; count++;
    }
    return Math.sqrt(energy / count);
  }
  let peak = 0;
  for (let p = 0; p < pcm.length; p += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(p)) / 32768);
  return { rms, peak };
}
const rows = [];
for (const note of notes) {
  const mid = join(directory, `note-${note}.mid`), wav = join(directory, `note-${note}.wav`);
  await writeFile(mid, midi(note));
  const result = spawnSync("fluidsynth", ["-ni", "-F", resolve(wav), "-r", "48000", "-o", "audio.file.format=s16",
    "-o", "synth.gain=0.5", "-o", "synth.reverb.active=0", "-o", "synth.chorus.active=0", resolve(font), resolve(mid)],
  { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0 || /preset not found|failed to load/i.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error(`FluidSynth failed: ${result.error ?? result.stderr ?? result.stdout}`);
  }
  const audio = decode(await readFile(wav));
  rows.push({ note, ...assessAudio(audio, oneShot) });
}
console.table(rows);
await writeFile(join(directory, "results.json"), JSON.stringify({ font: resolve(font), oneShot, rows }, null, 2));
if (rows.some((row) => !row.passed)) process.exitCode = 1;
}

export function assessAudio(audio, oneShot = false) {
  const attack = audio.rms(0.1, 0.4), held = audio.rms(4, 6), released = audio.rms(6.5, 7);
  const endHeld = audio.rms(5.98, 6);
  const windows = Array.from({ length: 53 }, (_, i) => audio.rms(0.7 + i * 0.1, 0.8 + i * 0.1));
  const minimumHeld = Math.min(...windows), maximumHeld = Math.max(...windows);
  const passed = attack > 0.0001 && released < 0.0001 && audio.peak < 0.99 && (oneShot
    ? held < 0.0001
    : held > attack * 0.25 && endHeld > attack * 0.2 && minimumHeld > attack * 0.2 && minimumHeld > maximumHeld * 0.5);
  return { attack, held, endHeld, released, minimumHeld, maximumHeld, peak: audio.peak, passed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
