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

test("loads a file into the chord display and fretboard", async ({ page }) => {
  const fixturePath = fileURLToPath(
    new URL("../fixtures/c-major.wav", import.meta.url),
  );
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixturePath);

  await expect(page.getByText("Analysis ready")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".chord-symbol")).toContainText("C");
  await expect(page.locator(".chord-details strong").nth(1)).toHaveText("Major");
  await expect(page.locator(".role-root")).toHaveCount(6);
  await expect(page.locator(".role-chord-tone")).toHaveCount(15);

  await page.locator("#scale").selectOption("major");
  await expect(page.locator(".role-scale-tone").first()).toBeVisible();
});

test("keeps the fretboard surface usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Playable map" })).toBeVisible();
  await expect(page.getByLabel("Guitar fretboard visualization")).toBeVisible();
  await expect(page.getByLabel("Analysis timeline")).toBeDisabled();
});
