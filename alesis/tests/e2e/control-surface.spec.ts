import { expect, test } from "@playwright/test";

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
  const beatCount = Number(await page.getByLabel("Beats per measure").inputValue()) * Number(await page.getByLabel("Loop measures").inputValue());

  await page.getByRole("button", { name: "Synth" }).click();
  await page.getByLabel("Synthesizer").selectOption("subtractive");
  await expect(page.locator(".parameter")).toHaveCount(6);
  await page.getByLabel("Synthesizer").selectOption("soundfont");
  const soundFont = page.getByLabel("SoundFont", { exact: true });
  await expect(soundFont).toHaveValue("hs-synthetic-electronic-sf2");
  await expect(soundFont.locator("option", { hasText: "FluidR3_GM" })).toHaveCount(1);
  await page.getByRole("button", { name: "Refresh SoundFonts" }).click();
  await expect(soundFont).toHaveValue("hs-synthetic-electronic-sf2");
  await expect(page.locator(".parameter")).toHaveCount(5);

  await page.getByRole("button", { name: "Loops" }).click();
  await expect(page.getByRole("region", { name: "Looper" })).toBeVisible();
  const waveforms = page.locator(".waveform");
  await expect(waveforms).toHaveCount(2);
  await expect(waveforms.first().locator(".beat-grid i")).toHaveCount(Math.max(0, beatCount - 1));
  await expect(waveforms.nth(1).locator(".beat-grid i")).toHaveCount(Math.max(0, beatCount - 1));
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

test("edits BPM locally and confirms only on commit", async ({ page }) => {
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
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote staged take" })).toBeEnabled({ timeout: 3_000 });
  await expect(page.locator(".current-capture svg .intensity-sample")).toHaveCount(96);
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
