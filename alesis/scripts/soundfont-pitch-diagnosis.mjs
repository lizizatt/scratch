import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAMPLE_RATE = 48_000;
const A4_HZ = 440;

const options = parseArgs(process.argv.slice(2));
if (options.presets.length === 0) {
  console.error(`Usage: node scripts/soundfont-pitch-diagnosis.mjs --preset "label|/path/to/font.sf2|bank|program" [--notes 57,69,81] [--selection both|midi|select] [--chorus both|off|on]`);
  process.exit(2);
}

for (const preset of options.presets) {
  if (!existsSync(preset.path)) throw new Error(`SoundFont not found for ${preset.label}: ${preset.path}`);
}
await validatePresetCatalog(options.presets);

console.log("Estimator validation:");
for (const expectedHz of [220, 440, 880]) {
  const samples = sineStereo(expectedHz, SAMPLE_RATE, 1.2);
  const hz = robustPitchEstimate(samples, SAMPLE_RATE, expectedHz);
  console.log(JSON.stringify({ expectedHz, measuredHz: round(hz), cents: round(centsFrom(hz, expectedHz), 3) }));
}

const rows = [];
for (const preset of options.presets) {
  for (const selection of options.selections) {
    for (const chorus of options.choruses) {
      for (const note of options.notes) {
        const rendered = await renderPreset({ preset, note, selection, chorus, gain: options.gain });
        const expectedHz = A4_HZ * 2 ** ((note - 69) / 12);
        const hz = robustPitchEstimate(rendered.samples, rendered.sampleRate, expectedHz);
        rows.push({
          label: preset.label,
          file: preset.path.split("/").at(-1),
          bank: preset.bank,
          program: preset.program,
          selection,
          chorus,
          note,
          sampleRate: rendered.sampleRate,
          expectedHz: round(expectedHz),
          measuredHz: round(hz),
          cents: round(centsFrom(hz, expectedHz), 2),
        });
      }
    }
  }
}

console.table(rows);

function parseArgs(args) {
  const parsed = { presets: [], notes: [57, 69, 81], selections: ["midi", "select"], choruses: ["off", "on"], gain: 0.72 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--preset" && value) {
      index += 1;
      const [label, path, bank, program] = value.split("|");
      if (!label || !path || bank === undefined || program === undefined) throw new Error(`Invalid --preset: ${value}`);
      parsed.presets.push({
        label,
        path,
        bank: parseInteger("--preset bank", bank, 0, 16_383),
        program: parseInteger("--preset program", program, 0, 127),
      });
    } else if (arg === "--notes" && value) {
      index += 1;
      parsed.notes = value.split(",").map((note) => parseInteger("--notes", note, 0, 127));
    } else if (arg === "--selection" && value) {
      index += 1;
      parsed.selections = expandChoice(value, ["midi", "select"]);
    } else if (arg === "--chorus" && value) {
      index += 1;
      parsed.choruses = expandChoice(value, ["off", "on"]);
    } else if (arg === "--gain" && value) {
      index += 1;
      parsed.gain = parseFiniteNumber("--gain", value, 0, Number.POSITIVE_INFINITY);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function validatePresetCatalog(presets) {
  const catalogs = new Map();
  for (const preset of presets) {
    let catalog = catalogs.get(preset.path);
    if (!catalog) {
      catalog = await discoverPresetCatalog(preset.path);
      catalogs.set(preset.path, catalog);
    }
    if (!catalog.some((entry) => entry.bank === preset.bank && entry.program === preset.program)) {
      const available = catalog.length > 0
        ? catalog.slice(0, 12).map(({ bank, program, name }) => `${bank}:${program} ${name}`).join(", ")
        : "none";
      throw new Error(`Preset not found for ${preset.label}: bank ${preset.bank}, program ${preset.program}. Available presets: ${available}`);
    }
  }
}

async function discoverPresetCatalog(path) {
  const { stdout, stderr } = await runWithOutput("fluidsynth", ["-a", "file", "-o", "audio.file.name=/dev/null", path], "inst 1\nquit\n");
  return parsePresetCatalog(`${stdout}\n${stderr}`);
}

function parsePresetCatalog(output) {
  return output.split("\n").flatMap((line) => {
    const match = line.match(/^(\d+)-(\d+)\s+(.+?)\s*$/);
    if (!match) return [];
    const bank = Number(match[1]);
    const program = Number(match[2]);
    if (bank > 16_383 || program > 127) return [];
    return [{ bank, program, name: match[3] }];
  });
}

function parseInteger(name, value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`Invalid ${name}: ${value}`);
  return parsed;
}

function parseFiniteNumber(name, value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(`Invalid ${name}: ${value}`);
  return parsed;
}

function expandChoice(value, choices) {
  if (value === "both") return choices;
  if (choices.includes(value)) return [value];
  throw new Error(`Expected one of ${["both", ...choices].join(", ")}, got ${value}`);
}

async function renderPreset({ preset, note, selection, chorus, gain }) {
  const directory = await mkdtemp(join(tmpdir(), "alesis-pitch-"));
  const midiPath = join(directory, "note.mid");
  const configPath = join(directory, "select.cfg");
  const wavPath = join(directory, "render.wav");
  try {
    await writeFile(midiPath, midiFixture(selection === "midi" ? preset.bank : null, selection === "midi" ? preset.program : null, note));
    const args = [
      "-ni",
      "-F", wavPath,
      "-r", String(SAMPLE_RATE),
      "-o", "audio.file.format=s16",
      "-o", `synth.gain=${gain}`,
      "-o", "synth.midi-bank-select=mma",
      "-o", `synth.chorus.active=${chorus === "on" ? 1 : 0}`,
      "-o", "synth.reverb.active=0",
    ];
    if (selection === "select") {
      await writeFile(configPath, `select 0 1 ${preset.bank} ${preset.program}\n`);
      args.push("-f", configPath);
    }
    args.push(preset.path, midiPath);
    await run("fluidsynth", args);
    return decodeWav(await readFile(wavPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function sineStereo(frequency, sampleRate, seconds) {
  const frames = Math.round(sampleRate * seconds);
  const samples = new Float32Array(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.sin(2 * Math.PI * frequency * frame / sampleRate) * 0.7;
    samples[frame * 2] = value;
    samples[frame * 2 + 1] = value;
  }
  return samples;
}

function midiFixture(bank, program, note) {
  const events = [
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
  ];
  if (bank !== null) {
    const roundedBank = Math.round(bank);
    events.push(0x00, 0xb0, 0x00, Math.floor(roundedBank / 128));
    events.push(0x00, 0xb0, 0x20, roundedBank % 128);
  }
  if (program !== null) events.push(0x00, 0xc0, Math.round(program));
  events.push(
    0x00, 0x90, Math.round(note), 110,
    0x83, 0x60, 0x80, Math.round(note), 0x00,
    0x87, 0x40, 0xff, 0x2f, 0x00,
  );
  const track = Buffer.from(events);
  const header = Buffer.alloc(14);
  header.write("MThd", 0, "ascii");
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(1, 10);
  header.writeUInt16BE(480, 12);
  const trackHeader = Buffer.alloc(8);
  trackHeader.write("MTrk", 0, "ascii");
  trackHeader.writeUInt32BE(track.length, 4);
  return Buffer.concat([header, trackHeader, track]);
}

function decodeWav(wav) {
  let offset = 12;
  let format = 0;
  let bitsPerSample = 0;
  let channels = 0;
  let sampleRate = 0;
  let data = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const chunk = wav.subarray(offset + 8, offset + 8 + size);
    if (id === "fmt ") {
      format = chunk.readUInt16LE(0);
      channels = chunk.readUInt16LE(2);
      sampleRate = chunk.readUInt32LE(4);
      bitsPerSample = chunk.readUInt16LE(14);
    } else if (id === "data") {
      data = chunk;
    }
    offset += 8 + size + (size % 2);
  }
  if (!data || format !== 1 || bitsPerSample !== 16 || channels !== 2) throw new Error(`Unsupported WAV format: format=${format}, channels=${channels}, bits=${bitsPerSample}`);
  const samples = new Float32Array(data.length / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = data.readInt16LE(index * 2) / 32_768;
  return { samples, sampleRate };
}

function robustPitchEstimate(samples, sampleRate, expectedHz) {
  const mono = toMono(samples);
  const start = Math.round(0.2 * sampleRate);
  const stop = Math.round(0.95 * sampleRate);
  const windowSize = 4_096;
  const hop = 1_024;
  const pitches = [];
  for (let offset = start; offset + windowSize < stop; offset += hop) {
    const window = mono.subarray(offset, offset + windowSize);
    const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
    const centered = new Float32Array(window.length);
    for (let index = 0; index < window.length; index += 1) centered[index] = window[index] - mean;
    const estimate = estimatePitchHzAutocorrelation(centered, sampleRate, searchRange(expectedHz));
    if (estimate) pitches.push(estimate);
  }
  if (pitches.length === 0) return NaN;
  const center = median(pitches);
  const deviations = pitches.map((value) => Math.abs(value - center));
  const mad = median(deviations) || 1;
  const filtered = pitches.filter((value) => Math.abs(value - center) <= 2.5 * mad);
  return median(filtered.length > 0 ? filtered : pitches);
}

function searchRange(expectedHz) {
  return { minHz: Math.max(40, expectedHz * 0.7), maxHz: Math.min(2_000, expectedHz * 1.3) };
}

function estimatePitchHzAutocorrelation(samples, sampleRate, { minHz, maxHz }) {
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.ceil(sampleRate / minHz);
  let bestLag = -1;
  let bestCorrelation = -1;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const correlation = lagCorrelation(samples, lag);
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestCorrelation < 0.6) return null;
  const prev = bestLag - 1;
  const next = bestLag + 1;
  if (prev < minLag || next > maxLag) return sampleRate / bestLag;
  const c0 = lagCorrelation(samples, prev);
  const c1 = lagCorrelation(samples, bestLag);
  const c2 = lagCorrelation(samples, next);
  const denom = c0 - 2 * c1 + c2;
  const shift = Math.abs(denom) <= Number.EPSILON ? 0 : (c0 - c2) / (2 * denom);
  return sampleRate / (bestLag + Math.max(-0.5, Math.min(0.5, shift)));
}

function lagCorrelation(samples, lag) {
  let dot = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index + lag < samples.length; index += 1) {
    const left = samples[index];
    const right = samples[index + lag];
    dot += left * right;
    leftEnergy += left * left;
    rightEnergy += right * right;
  }
  const normalizer = Math.sqrt(leftEnergy * rightEnergy);
  return normalizer <= Number.EPSILON ? 0 : dot / normalizer;
}

function toMono(samples) {
  const mono = new Float32Array(samples.length / 2);
  for (let frame = 0; frame < mono.length; frame += 1) mono[frame] = (samples[frame * 2] + samples[frame * 2 + 1]) / 2;
  return mono;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function centsFrom(hz, expectedHz) {
  return 1_200 * Math.log2(hz / expectedHz);
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => { errorOutput += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${errorOutput.trim()}`)));
  });
}

function runWithOutput(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)));
    child.stdin.end(input);
  });
}
