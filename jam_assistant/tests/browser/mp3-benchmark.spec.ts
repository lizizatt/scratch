import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("decodes and analyzes MP3 faster than real time", async ({ page }) => {
  const mp3 = await readFile(
    fileURLToPath(new URL("../fixtures/c-major.mp3", import.meta.url)),
  );
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => window.runMp3Benchmark(Uint8Array.from(bytes)),
    [...mp3],
  );
  expect(result.stableChord).toEqual({ rootPitchClass: 0, quality: "major" });
  expect(result.realtimeFactor).toBeGreaterThanOrEqual(10);
  expect(result.decodeMilliseconds).toBeGreaterThanOrEqual(0);
  expect(result.analysisMilliseconds).toBeGreaterThan(0);

  const artifacts = fileURLToPath(new URL("../../artifacts", import.meta.url));
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    fileURLToPath(
      new URL("../../artifacts/browser-mp3-benchmark.json", import.meta.url),
    ),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2)}\n`,
  );
});
