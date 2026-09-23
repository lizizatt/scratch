import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const outputArgument = process.argv[2];
if (!outputArgument) throw new Error("Usage: node scripts/generate-sample-fixtures.mjs <explicit-output-directory>");
const outputDirectory = resolve(outputArgument);
mkdirSync(outputDirectory, { recursive: true });

for (let index = 0; index < 10; index += 1) {
  const frequency = 180 + index * 65;
  const output = join(outputDirectory, `Synthetic Tone ${String(index + 1).padStart(2, "0")}.mp3`);
  const result = spawnSync("ffmpeg", [
    "-nostdin", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=0.45`,
    "-codec:a", "libmp3lame", "-q:a", "5", "-y", output,
  ], { stdio: "inherit" });
  if (result.error) throw new Error(`Unable to start ffmpeg: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`ffmpeg failed to generate fixture at ${frequency} Hz (exit ${result.status})`);
}

console.log(`Generated 10 synthetic MP3 tone fixtures in ${outputDirectory}`);
