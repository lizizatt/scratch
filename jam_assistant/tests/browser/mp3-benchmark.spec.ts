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

test("recognizes the primary labels in a generated MP3 progression", async ({ page }) => {
  const mp3 = await readFile(
    fileURLToPath(new URL("../fixtures/midi/four-chord-cycle.mp3", import.meta.url)),
  );
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => window.runMp3Benchmark(Uint8Array.from(bytes)),
    [...mp3],
  );

  expect(Object.keys(result.chordVotes)).toEqual(
    expect.arrayContaining([
      "9:minor",
      "5:major",
      "0:major",
      "7:major",
    ]),
  );
});

test("recognizes every supported quality in the quality-tour MP3", async ({ page }) => {
  const mp3 = await readFile(
    fileURLToPath(new URL("../fixtures/midi/quality-tour.mp3", import.meta.url)),
  );
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => window.runMp3Benchmark(Uint8Array.from(bytes)),
    [...mp3],
  );

  expect(Object.keys(result.chordVotes)).toEqual(
    expect.arrayContaining([
      "0:major",
      "0:minor",
      "0:dominant7",
      "0:major7",
      "0:minor7",
      "0:diminished",
      "0:suspended4",
    ]),
  );
});

test("shows every quality from the quality-tour MP3 in the file timeline", async ({ page }) => {
  const fixturePath = fileURLToPath(
    new URL("../fixtures/midi/quality-tour.mp3", import.meta.url),
  );
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixturePath);

  for (const label of ["C", "Cm", "C7", "Cmaj7", "Cm7", "Cdim", "Csus4"]) {
    await expect(
      page.getByRole("button", { name: `Seek to ${label}`, exact: true }),
    ).not.toHaveCount(0, { timeout: 20_000 });
  }
});

test("decodes an externally annotated progression recording", async ({ page }) => {
  const mp3 = await readFile(
    fileURLToPath(
      new URL(
        "../fixtures/external/jonah-dempcy-david-levin-improv-jam.mp3",
        import.meta.url,
      ),
    ),
  );
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => window.runMp3Benchmark(Uint8Array.from(bytes)),
    [...mp3],
  );

  expect(result.durationSeconds).toBeGreaterThan(100);
  expect(Object.keys(result.chordVotes)).toEqual(
    expect.arrayContaining(["0:minor7", "8:major", "7:dominant7"]),
  );
});

test("loads a generated MP3 progression through file analysis", async ({ page }) => {
  const fixturePath = fileURLToPath(
    new URL("../fixtures/midi/four-chord-cycle.mp3", import.meta.url),
  );
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixturePath);

  for (const label of ["Am", "F", "C", "G"]) {
    await expect(
      page.getByRole("button", { name: `Seek to ${label}`, exact: true }),
    ).not.toHaveCount(0, { timeout: 20_000 });
  }
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
  await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(25);
  await expect(page.locator(".fret-labels")).not.toContainText("OPEN");
  await expect(page.locator(".fret-cell > span")).toHaveCount(150);
  await expect(page.locator(".fret-cell > span").filter({ hasText: /.+/ })).toHaveCount(150);
  await expect(page.locator(".role-root").first()).toBeVisible();
  await expect(page.locator(".role-chord-tone").first()).toBeVisible();
  await expect(page.locator(".role-root span").first()).toHaveCSS("border", /4px solid rgb\(255, 138, 61\)/);
  await expect(page.locator(".role-chord-tone span").first()).toHaveCSS("border", /4px solid rgb\(255, 228, 92\)/);
  await expect(page.locator(".role-root span").first()).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator(".role-root span").first()).toHaveCSS("text-shadow", /rgb\(0, 0, 0\)/);
  await expect(page.locator("#scale")).toHaveCount(0);

  const firstFretX = (await page.locator(".fret-row").first().locator(".fret-cell").first().boundingBox())?.x;
  const firstFretWidth = (await page.locator(".fret-row").first().locator(".fret-cell").first().boundingBox())?.width ?? 0;
  const lastFretWidth = (await page.locator(".fret-row").first().locator(".fret-cell").last().boundingBox())?.width ?? 0;
  expect(firstFretWidth).toBeCloseTo(lastFretWidth, 0);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(16);
  expect((await page.locator(".fret-row").first().locator(".fret-cell").first().boundingBox())?.x).toBeCloseTo(firstFretX ?? 0, 0);
  await page.getByRole("button", { name: "Next fret", exact: true }).click();
  await expect(page.locator(".fret-labels span:not(.string-label)")).toHaveText(
    Array.from({ length: 16 }, (_, index) => String(index + 1)),
  );
  await expect(page.getByText("1–16 / 24")).toBeVisible();
  const zoomedFirstFretWidth = (await page.locator(".fret-row").first().locator(".fret-cell").first().boundingBox())?.width ?? 0;
  const zoomedLastFretWidth = (await page.locator(".fret-row").first().locator(".fret-cell").last().boundingBox())?.width ?? 0;
  expect(zoomedFirstFretWidth).toBeGreaterThan(zoomedLastFretWidth * 1.5);
  expect(zoomedFirstFretWidth).toBeLessThan(zoomedLastFretWidth * 2);
  await page.getByRole("button", { name: "Previous fret", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(25);

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
  await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(25);
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
  await expect(page.locator(".fretboard .fret-cell")).toHaveCount(150);
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
