import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("../scripts/soundfont-pitch-diagnosis.mjs", import.meta.url));
const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })));
  temporaryDirectories.clear();
});

describe("SoundFont pitch diagnosis CLI", () => {
  it("rejects nonnumeric preset fields before rendering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alesis-pitch-cli-test-"));
    temporaryDirectories.add(directory);
    const soundFont = join(directory, "fixture.sf2");
    await writeFile(soundFont, "fixture");

    const result = await runScript(["--preset", `bad|${soundFont}|not-a-bank|6`]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Invalid --preset bank");
    expect(result.stdout).not.toContain("Estimator validation");
  });

  it("rejects presets that are absent from the SoundFont catalog before rendering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alesis-pitch-cli-test-"));
    temporaryDirectories.add(directory);
    const soundFont = join(directory, "fixture.sf2");
    await writeFile(soundFont, "fixture");
    const fakeFluidSynth = await createFakeFluidSynth(directory, "000-000 Voice 0\\n000-011 Voice 11\\n");

    const result = await runScript(["--preset", `Miku|${soundFont}|0|127`], fakeFluidSynth.env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Preset not found for Miku: bank 0, program 127");
    expect(result.stdout).not.toContain("Estimator validation");
  });

  it("renders existing 14-bit SoundFont banks through MIDI bank-select bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alesis-pitch-cli-test-"));
    temporaryDirectories.add(directory);
    const soundFont = join(directory, "fixture.sf2");
    await writeFile(soundFont, "fixture");
    const fakeFluidSynth = await createFakeFluidSynth(directory, "1200-056 Trumpet\\n");

    const result = await runScript(["--preset", `Trumpet|${soundFont}|1200|56`, "--notes", "69", "--selection", "midi", "--chorus", "off"], fakeFluidSynth.env);
    const calls = (await readFile(fakeFluidSynth.logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const renderCall = calls.find((call) => call.mode === "render");

    expect(result.code, result.stderr).toBe(0);
    expect(renderCall.args).toContain("synth.midi-bank-select=mma");
    expect(renderCall.midiHex).toContain("00b00009");
    expect(renderCall.midiHex).toContain("00b02030");
    expect(renderCall.midiHex).toContain("00c038");
  });
});

async function createFakeFluidSynth(directory: string, catalog: string): Promise<{ env: NodeJS.ProcessEnv; logPath: string }> {
  const binDirectory = join(directory, "bin");
  const commandPath = join(binDirectory, "fluidsynth");
  const logPath = join(directory, "fluidsynth.log");
  await mkdir(binDirectory);
  await writeFile(commandPath, `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const logPath = process.env.ALESIS_FAKE_FLUIDSYNTH_LOG;
const catalog = process.env.ALESIS_FAKE_FLUIDSYNTH_CATALOG ?? "";
let stdin = "";
process.stdin.on("data", (chunk) => { stdin += String(chunk); });
process.stdin.on("end", () => {
  if (stdin.includes("inst 1")) {
    if (logPath) appendFileSync(logPath, JSON.stringify({ mode: "catalog", args }) + "\\n");
    process.stdout.write(catalog.replaceAll("\\\\n", "\\n"));
    return;
  }

  const wavPath = args[args.indexOf("-F") + 1];
  const midiPath = args.at(-1);
  if (!wavPath || !midiPath) process.exit(64);
  const midi = readFileSync(midiPath);
  if (logPath) appendFileSync(logPath, JSON.stringify({ mode: "render", args, midiHex: midi.toString("hex") }) + "\\n");
  writeFileSync(wavPath, sineWav(440, 48000, 1.2));
});

function sineWav(frequency, sampleRate, seconds) {
  const frames = Math.round(sampleRate * seconds);
  const data = Buffer.alloc(frames * 4);
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.round(Math.sin(2 * Math.PI * frequency * frame / sampleRate) * 16000);
    data.writeInt16LE(sample, frame * 4);
    data.writeInt16LE(sample, frame * 4 + 2);
  }
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}
`);
  await chmod(commandPath, 0o755);
  return {
    env: {
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      ALESIS_FAKE_FLUIDSYNTH_CATALOG: catalog,
      ALESIS_FAKE_FLUIDSYNTH_LOG: logPath,
    },
    logPath,
  };
}

function runScript(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => resolve({ code: null, stdout, stderr: error.message }));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}
