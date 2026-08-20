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

  await expect(page.locator(".chord-symbol")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".chord-symbol")).toContainText("C");
  await expect(page.locator(".chord-details strong").nth(1)).toHaveText("Major");
  await expect(page.locator(".role-root")).toHaveCount(6);
  await expect(page.locator(".role-chord-tone")).toHaveCount(15);

  await page.locator("#scale").selectOption("major");
  await expect(page.locator(".role-scale-tone").first()).toBeVisible();
  const playAudio = page.getByLabel("Play audio");
  await playAudio.check();
  await expect(playAudio).toBeChecked();
  await expect(page.locator("audio")).toHaveJSProperty("muted", false);
  const playTimeline = page.getByRole("button", { name: "Play timeline" });
  await playTimeline.click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", false);
  await page.getByRole("button", { name: "Pause timeline" }).click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", true);
  await playAudio.uncheck();
  await expect(page.locator("audio")).toHaveJSProperty("muted", true);
});

test("shows chord names and seeks when a marker is clicked", async ({ page }) => {
  const fixturePath = fileURLToPath(
    new URL("../fixtures/c-major-d-minor.wav", import.meta.url),
  );
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixturePath);

  const markers = page.locator(".chord-marker");
  await expect.poll(() => markers.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect(markers.nth(0)).toContainText("C");
  const dMinorMarker = page.getByRole("button", { name: "Seek to Dm" });
  await expect(dMinorMarker).toBeVisible();
  await dMinorMarker.click();
  await expect(page.locator(".chord-symbol")).toHaveText("Dm");
});

test("keeps the fretboard surface usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator('input[type="file"]')).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../fixtures/c-major.wav", import.meta.url)));
  await expect(page.getByLabel("Guitar fretboard visualization")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel("Analysis timeline")).toBeEnabled();
});

test("starts and stops microphone mode without a playback timeline", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Microphone" }).click();
  await expect(page.getByText("Listening")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Analysis timeline")).toHaveCount(0);
  await expect(page.getByLabel("Guitar fretboard visualization")).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Microphone stopped")).toBeVisible();
});
