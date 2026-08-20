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
  await expect(page.locator(".fret-row")).toHaveCount(6);
  await expect(page.locator(".fret-row").first()).toHaveAttribute("data-string-index", "5");
  await expect(page.locator(".fret-row").last()).toHaveAttribute("data-string-index", "0");
  await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(24);
  await expect(page.locator(".fret-labels")).not.toContainText("OPEN");
  await expect(page.locator(".fret-cell > span")).toHaveCount(144);
  await expect(page.locator(".fret-cell > span").filter({ hasText: /.+/ })).toHaveCount(144);
  await expect(page.locator(".role-root").first()).toBeVisible();
  await expect(page.locator(".role-chord-tone").first()).toBeVisible();
  await expect(page.locator(".role-root span").first()).toHaveCSS("border-color", "rgb(255, 138, 61)");
  await expect(page.locator(".role-chord-tone span").first()).toHaveCSS("border-color", "rgb(255, 228, 92)");
  await expect(page.locator("#scale")).toHaveCount(0);

  const firstFretX = (await page.locator(".fret-row").first().locator(".fret-cell").first().boundingBox())?.x;
  const firstFretWidth = (await page.locator(".fret-row").first().locator(".fret-cell").first().boundingBox())?.width ?? 0;
  const lastFretWidth = (await page.locator(".fret-row").first().locator(".fret-cell").last().boundingBox())?.width ?? 0;
  expect(firstFretWidth).toBeGreaterThan(lastFretWidth * 2);
  expect(firstFretWidth).toBeLessThan(lastFretWidth * 2.6);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(16);
  expect((await page.locator(".fret-row").first().locator(".fret-cell").first().boundingBox())?.x).toBeCloseTo(firstFretX ?? 0, 0);
  await page.getByRole("button", { name: "Next fret", exact: true }).click();
  await expect(page.locator(".fret-labels span:not(.string-label)")).toHaveText(
    Array.from({ length: 16 }, (_, index) => String(index + 2)),
  );
  await expect(page.getByText("2–17 / 24")).toBeVisible();
  await page.getByRole("button", { name: "Previous fret", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(24);

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

test("latches the fretboard while the current chord continues changing", async ({ page }) => {
  const fixturePath = fileURLToPath(
    new URL("../fixtures/c-major-d-minor.wav", import.meta.url),
  );
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixturePath);

  await expect(page.locator(".chord-symbol")).toHaveText("C");
  const latch = page.getByRole("button", { name: "Latch" });
  const rootNotes = page.locator(".role-root");
  const rootTitles = await rootNotes.evaluateAll((notes) =>
    notes.map((note) => note.getAttribute("title")),
  );
  await latch.click();
  await expect(page.getByRole("button", { name: "Latched" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Seek to Dm" }).click();
  await expect(page.locator(".chord-symbol")).toHaveText("Dm");
  await expect.poll(() => rootNotes.evaluateAll((notes) =>
    notes.map((note) => note.getAttribute("title")),
  )).toEqual(rootTitles);

  await page.getByRole("button", { name: "Latched" }).click();
  await expect(page.getByRole("button", { name: "Latch" })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => rootNotes.evaluateAll((notes) =>
    notes.map((note) => note.getAttribute("title")),
  )).not.toEqual(rootTitles);
});

test("keeps the fretboard surface usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator('input[type="file"]')).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../fixtures/c-major.wav", import.meta.url)));
  await expect(page.getByLabel("Guitar fretboard visualization")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel("Analysis timeline")).toBeEnabled();
});

test("fills a mobile landscape viewport with the fretboard and compact status", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(
    fileURLToPath(new URL("../fixtures/c-major.wav", import.meta.url)),
  );
  await expect(page.locator(".chord-symbol")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(16);
  await page.setViewportSize({ width: 844, height: 390 });

  const panel = page.locator(".fretboard-panel");
  await expect(page.getByLabel("Guitar fretboard visualization")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".control-strip")).toBeHidden();
  await expect(page.locator(".analysis-grid")).toBeHidden();
  await expect(page.locator(".landscape-status")).toBeVisible();
  await expect(page.locator(".landscape-status strong")).toHaveText("C / --");
  await expect(page.locator(".fret-row")).toHaveCount(6);
  await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(24);
  await expect.poll(async () => {
    const box = await panel.boundingBox();
    return box === null ? null : [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
  }).toEqual([0, 0, 844, 390]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(16);
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

test("merges live microphone heat with chord outlines", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Microphone" }).click();
  await expect(page.getByText("Listening")).toBeVisible({ timeout: 10_000 });

  await expect(page.getByLabel("FFT window")).not.toBeVisible();
  await page.getByText("Options", { exact: true }).click();
  await expect(page.getByLabel("FFT window")).toHaveValue("2");
  await expect(page.getByLabel("Accumulation time")).toHaveValue("0.2");
  await expect(page.getByLabel("Fade time")).toHaveValue("0.2");
  await expect(page.getByRole("slider", { name: "Log response" })).toHaveValue("0.1");
  await page.getByLabel("FFT window").fill("1");
  await page.getByLabel("Accumulation time").fill("0.1");
  await page.getByLabel("Fade time").fill("10");
  await page.getByRole("slider", { name: "Log response" }).fill("1");
  await expect(page.getByText("43 ms")).toBeVisible();
  await expect(page.getByText("0.1 s")).toBeVisible();
  await expect(page.getByText("10.0 s")).toBeVisible();
  await expect(page.getByText("1.0", { exact: true })).toBeVisible();
  await expect(page.locator(".fretboard .fret-cell")).toHaveCount(144);
  await expect.poll(async () => {
    const strengths = await page.locator(".fretboard .fret-cell").evaluateAll(
      (cells) => cells.map((cell) => Number((cell as HTMLElement).dataset.strength ?? 0)),
    );
    return Math.max(...strengths);
  }, { timeout: 10_000 }).toBeGreaterThan(0.05);
  await expect.poll(async () => {
    const values = await page.locator(".fretboard .fret-cell").evaluateAll(
      (cells) => cells.map((cell) => ({
        strength: Number((cell as HTMLElement).dataset.strength ?? 0),
        opacity: Number((cell as HTMLElement).dataset.opacity ?? 0),
      })),
    );
    return values.some((value) => value.strength > 0 && value.opacity > value.strength);
  }).toBe(true);
});
