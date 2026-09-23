import { expect, test } from "@playwright/test";
import { rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const exportDirectories = new Set<string>();

test.afterEach(async () => {
  await Promise.all([...exportDirectories].map((directory) => rm(directory, { recursive: true, force: true })));
  exportDirectories.clear();
});

test("runs the application bundle advertised by the current server", async ({ page, request }) => {
  await page.goto("/");
  const loadedScript = await page.locator('script[type="module"]').getAttribute("src");
  const currentHtml = await (await request.get("/", { headers: { "cache-control": "no-cache" } })).text();

  expect(loadedScript).not.toBeNull();
  expect(currentHtml).toContain(`src="${loadedScript}"`);
});

test("connects every selected pane to the host without viewport overflow", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();

  await page.getByRole("button", { name: "Options" }).click();
  await expect(page.getByRole("region", { name: "Options" })).toBeVisible();
  await expect(page.getByLabel("Input device")).toHaveValue("software-vortex");
  const keyResponse = page.getByLabel("Key response");
  await expect(keyResponse).toHaveValue("strong");
  await keyResponse.selectOption("linear");
  await expect(keyResponse).toHaveValue("linear");
  await keyResponse.selectOption("strong");
  await expect(keyResponse).toHaveValue("strong");
  const beatCount = Number(await page.getByLabel("Beats per measure").inputValue()) * Number(await page.getByLabel("Loop measures").inputValue());

  await page.getByRole("button", { name: "Synth" }).click();
  await page.getByLabel("Synthesizer").selectOption("subtractive");
  await expect(page.locator(".parameter")).toHaveCount(6);
  await page.getByLabel("Synthesizer").selectOption("soundfont");
  const soundFont = page.getByLabel("SoundFont", { exact: true });
  await expect(soundFont).toHaveValue("sth-sf2");
  await expect(page.getByLabel("SoundFont preset")).toHaveValue("0:0");
  await expect(page.getByLabel("SoundFont preset").locator("option", { hasText: "S3 MiniBoss Piano" })).toHaveCount(1);
  await expect(soundFont.locator("option", { hasText: "FluidR3_GM" })).toHaveCount(1);
  await page.getByRole("button", { name: "Refresh SoundFonts" }).click();
  await expect(soundFont).toHaveValue("sth-sf2");
  await expect(page.locator(".synth-module > .parameter")).toHaveCount(1);
  await expect(page.locator(".effects-controls")).not.toBeVisible();
  await page.getByRole("region", { name: "Reverb effect" }).getByText("Shape", { exact: true }).click();
  await expect(page.locator(".effects-controls")).toBeVisible();
  await expect(page.locator(".effects-controls .parameter")).toHaveCount(2);
  await page.getByText("Arpeggiator", { exact: true }).click();
  await page.getByLabel("Arpeggiator mode").selectOption("up-to-root-then-down");
  await expect(page.getByLabel("Arpeggiator mode")).toHaveValue("up-to-root-then-down");
  await page.getByLabel("Arpeggiator rate").selectOption("1/16");
  await expect(page.getByLabel("Arpeggiator rate")).toHaveValue("1/16");
  await page.getByLabel("Arpeggiator octaves").fill("2");
  await expect(page.getByLabel("Arpeggiator octaves")).toHaveValue("2");
  const latch = page.getByLabel("Arpeggiator latch");
  if (await latch.isChecked()) await latch.click();
  await latch.click();
  await expect(latch).toBeChecked();
  const enabled = page.getByLabel("Arpeggiator enabled");
  if (await enabled.isChecked()) await enabled.click();
  await enabled.click();
  await expect(enabled).toBeChecked();
  await page.getByText("Drums", { exact: true }).click();
  await page.getByLabel("Drum pattern").selectOption("breakbeat");
  await expect(page.getByLabel("Drum pattern")).toHaveValue("breakbeat");
  const drumsEnabled = page.getByLabel("Drums enabled");
  if (await drumsEnabled.isChecked()) await drumsEnabled.click();
  await drumsEnabled.click();
  await expect(drumsEnabled).toBeChecked();

  await page.getByRole("button", { name: "Loops" }).click();
  await expect(page.getByRole("region", { name: "Looper" })).toBeVisible();
  const quantization = page.getByLabel("Staged quantization");
  await expect(quantization.locator("option")).toHaveCount(5);
  await quantization.selectOption("1/16");
  await expect(quantization).toHaveValue("1/16");
  const waveforms = page.locator(".waveform");
  await expect(waveforms).toHaveCount(3);
  await expect(waveforms.first().locator(".beat-grid i")).toHaveCount(Math.max(0, beatCount - 1));
  await expect(waveforms.nth(1).locator(".beat-grid i")).toHaveCount(Math.max(0, beatCount - 1));
  await expect(waveforms.nth(2).locator(".beat-grid i")).toHaveCount(Math.max(0, beatCount - 1));
  const unmuteMetronome = page.getByRole("button", { name: "Unmute metronome" });
  if (await unmuteMetronome.isVisible()) await unmuteMetronome.click();
  const muteMetronome = page.getByRole("button", { name: "Mute metronome" });
  await expect(muteMetronome).toHaveAttribute("aria-pressed", "true");
  await muteMetronome.click();
  await expect(unmuteMetronome).toHaveAttribute("aria-pressed", "false");
  await unmuteMetronome.click();
  await expect(muteMetronome).toHaveAttribute("aria-pressed", "true");

  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.width);
  expect(dimensions.scrollHeight).toBe(dimensions.height);
  expect(pageErrors).toEqual([]);
});

test("scrolls the Synth pane to controls below a constrained viewport", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 320 });
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
  await page.getByRole("button", { name: "Synth" }).click();

  const pane = page.getByRole("region", { name: "Synth controls" });
  const arpeggiator = page.getByText("Arpeggiator", { exact: true });
  const before = await pane.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  expect(before.scrollTop).toBe(0);

  await pane.hover();
  await page.mouse.wheel(0, 1_000);
  await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await arpeggiator.scrollIntoViewIfNeeded();
  await expect(arpeggiator).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
});

test("keeps pad mode and navigation target independent and supports program selection and stepping", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
  await page.getByRole("button", { name: "Pads" }).click();
  await expect(page.getByRole("region", { name: "Pad controls" })).toBeVisible();

  const mode = page.getByLabel("Pad mode");
  const target = page.getByLabel("Pad navigation target");
  await mode.selectOption("samples");
  await target.selectOption("voices");
  await expect(mode).toHaveValue("samples");
  await target.selectOption("sample-pages");
  await expect(mode).toHaveValue("samples");
  await expect(target).toHaveValue("sample-pages");
  await mode.selectOption("drums");
  await expect(target).toHaveValue("sample-pages");

  await mode.selectOption("samples");
  await target.selectOption("voices");
  const entry = page.getByLabel("Current pad navigation entry");
  const position = page.getByLabel("Current pad navigation position");
  const count = Number((await position.textContent())?.split("/").at(-1)?.trim());
  if (count > 0) {
    const startingIndex = Number(await entry.inputValue());
    await page.getByRole("button", { name: "Next voice" }).click();
    await expect(entry).toHaveValue(String(count > 1 ? (startingIndex + 1) % count : startingIndex));
    await expect(position).toContainText("/");
    await entry.selectOption("0");
    await expect(entry).toHaveValue("0");
  } else {
    await expect(page.getByRole("button", { name: "Next voice" })).toBeDisabled();
  }

  await page.getByText("Vortex display, pad mapping & capture limits", { exact: true }).click();
  await expect(page.getByText(/Program Change Send On Load/)).toBeVisible();
  await expect(page.getByText(/cannot write that display/i)).toBeVisible();
  await expect(page.getByText(/not included in loop capture or MP3 exports/i)).toBeVisible();
});

test("refreshes sample pads, disables empty slots, and pages available libraries", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
  await page.getByRole("button", { name: "Pads" }).click();
  await page.getByLabel("Pad mode").selectOption("samples");
  await page.getByLabel("Pad navigation target").selectOption("sample-pages");
  await expect(page.locator(".sample-pad")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Refresh samples" })).toBeEnabled();
  await page.getByRole("button", { name: "Refresh samples" }).click();
  await expect(page.getByRole("button", { name: "Refresh samples" })).toBeEnabled();

  const entry = page.getByLabel("Current pad navigation entry");
  await expect.poll(async () => await page.locator(".sample-state[role='status']").count() > 0 || await page.locator(".sample-state[role='alert']").count() > 0).toBe(true);
  await expect(page.locator(".sample-pad")).toHaveCount(8);
  const pageCount = await entry.locator("option").count();
  if (await page.locator(".sample-state[role='alert']").count() > 0) {
    await expect(page.locator(".sample-state[role='alert']")).toContainText("Sample library error");
    await expect(page.locator(".sample-pad:disabled")).toHaveCount(8);
  } else if (pageCount === 1 && (await entry.locator("option").first().textContent()) === "No sample pages") {
    await expect(page.getByText(/No MP3 samples found/)).toBeVisible();
    for (let index = 1; index <= 8; index += 1) {
      const emptyPad = page.getByRole("button", { name: `Pad ${index} — Empty slot` });
      await expect(emptyPad).toBeDisabled();
    }
  } else {
    const firstPageEnabled = await page.locator(".sample-pad:enabled").count();
    if (firstPageEnabled > 0) {
      await page.locator(".sample-pad:enabled").first().click();
      await expect(page.locator(".error-line")).toHaveCount(0);
    }
    if (pageCount > 1) {
      await entry.selectOption("1");
      await expect(entry).toHaveValue("1");
      await expect(page.getByLabel("Current pad navigation position")).toContainText("Sample page 2");
      await expect(page.locator(".sample-state[role='status']")).toContainText(/samples loaded on this page/);
      if (await page.getByRole("button", { name: /Pad 1 — Synthetic Tone/ }).count() > 0) {
        await expect(page.locator(".sample-pad:enabled")).toHaveCount(2);
        await expect(page.locator(".sample-pad:disabled")).toHaveCount(6);
      }
      await page.getByRole("button", { name: "Next sample page" }).click();
      await expect(entry).toHaveValue("0");
      await expect(page.getByLabel("Current pad navigation position")).toContainText("Sample page 1");
    }
  }
  await expect(page.getByText(/SAMPLE_LIBRARY_DIR/)).toBeVisible();
});

test("edits BPM locally and confirms only on commit", async ({ page }, testInfo) => {
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs += 1;
    await dialog.accept();
  });
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Options" }).click();

  const countIn = page.getByLabel("Count-in");
  if (await countIn.isChecked()) await countIn.click();
  for (const [label, value] of [["BPM", "300"], ["Beats per measure", "1"], ["Loop measures", "1"]] as const) {
    const input = page.getByLabel(label);
    await input.fill(value);
    await input.press("Tab");
  }

  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByLabel("Staged quantization").selectOption("1/8");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote staged take" })).toBeEnabled({ timeout: 3_000 });
  await expect(page.getByRole("button", { name: "Promote previous staged take" })).toBeEnabled({ timeout: 3_000 });
  await page.getByRole("button", { name: "Promote previous staged take" }).click();
  await expect(page.getByRole("button", { name: "Promote previous staged take" })).toBeDisabled();
  await expect(page.locator(".take-row")).toHaveCount(1);
  await expect(page.locator(".current-capture svg .intensity-sample")).toHaveCount(96);
  const exportName = `E2E ${testInfo.project.name} ${process.pid}`;
  const exportDirectory = join(homedir(), "alesis_recordings", exportName);
  exportDirectories.add(exportDirectory);
  await rm(exportDirectory, { recursive: true, force: true });
  await page.getByRole("button", { name: "Save promoted tracks as MP3 files" }).click();
  const exportInput = page.getByLabel("Folder name");
  await exportInput.fill(exportName);
  expect(await exportInput.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`Saved 1 tracks and mix to ${exportDirectory}`, { timeout: 30_000 });
  expect((await stat(join(exportDirectory, "track-01.mp3"))).size).toBeGreaterThan(1_000);
  expect((await stat(join(exportDirectory, "mix.mp3"))).size).toBeGreaterThan(1_000);
  await page.getByRole("button", { name: "Options" }).click();

  const bpm = page.getByLabel("BPM");
  const baselineDialogs = dialogs;
  await bpm.focus();
  await bpm.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await bpm.press("2");
  await expect(bpm).toBeFocused();
  await expect(bpm).toHaveValue("2");
  expect(dialogs).toBe(baselineDialogs);

  await bpm.type("40");
  await expect(bpm).toBeFocused();
  await expect(bpm).toHaveValue("240");
  expect(dialogs).toBe(baselineDialogs);
  await bpm.press("Enter");

  await expect.poll(() => dialogs).toBe(baselineDialogs + 1);
  await expect(bpm).toHaveValue("240");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
  await page.waitForTimeout(300);
  await expect(bpm).toHaveValue("240");
});
