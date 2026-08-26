import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

type InstrumentExpectation = {
  readonly label: string;
  readonly modeLabel: string;
  readonly ariaLabel: string;
  readonly rowCount: number;
  readonly visibleCells: number;
  readonly openNote?: string;
  readonly fullRange?: string;
  readonly walkedNote?: string;
  readonly mode?: "fretted" | "piano";
};

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/c-major.wav", import.meta.url),
);

const INSTRUMENTS: readonly InstrumentExpectation[] = [
  {
    label: "guitar",
    modeLabel: "Guitar",
    ariaLabel: "Guitar fretboard visualization",
    rowCount: 6,
    visibleCells: 25,
    openNote: "E4",
    fullRange: "0–24 / 24",
    walkedNote: "F4",
  },
  {
    label: "piano",
    modeLabel: "Piano",
    ariaLabel: "Piano keyboard visualization",
    rowCount: 1,
    visibleCells: 25,
    mode: "piano",
  },
  {
    label: "bass",
    modeLabel: "Bass guitar",
    ariaLabel: "Bass guitar fretboard visualization",
    rowCount: 4,
    visibleCells: 25,
    openNote: "G2",
    fullRange: "0–24 / 24",
    walkedNote: "G#2",
  },
  {
    label: "ukulele",
    modeLabel: "Ukulele",
    ariaLabel: "Ukulele fretboard visualization",
    rowCount: 4,
    visibleCells: 25,
    openNote: "A4",
    fullRange: "0–24 / 24",
    walkedNote: "A#4",
  },
  {
    label: "cello",
    modeLabel: "Cello",
    ariaLabel: "Cello fretboard visualization",
    rowCount: 4,
    visibleCells: 25,
    openNote: "A3",
    fullRange: "0–24 / 24",
    walkedNote: "A#3",
  },
];

async function loadAnalyzedFixture(page: Page) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
  await expect(page.locator(".chord-symbol")).toHaveText("C", { timeout: 10_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function verifyInstrumentMode(page: Page, instrument: InstrumentExpectation, screenshotName: string) {
  await page.getByLabel("Instrument display mode").selectOption({ label: instrument.modeLabel });
  await expect(page.getByLabel("Instrument display mode")).toHaveValue(instrument.label);
  await expect(page.locator("#fretboard-title")).toContainText(instrument.modeLabel);
  await expect(page.getByLabel(instrument.ariaLabel)).toBeVisible();
  await expect(page.locator(".fret-row")).toHaveCount(instrument.rowCount);
  await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(instrument.visibleCells);
  if (instrument.mode === "piano") {
    await expect(page.locator(".fretboard-navigation output")).toHaveText("0–24 / 36");
    await expect(page.getByLabel("Zoom out")).toBeEnabled();
    await expect(page.getByLabel("Zoom in")).toBeEnabled();
    await expect(page.locator(".piano-key")).toHaveCount(25);
    await expect(page.locator(".piano-key > span")).toHaveCount(25);
    await expect(page.locator(".piano-labels")).toHaveCount(0);
    await expect(page.locator(".piano-row > .string-label")).toHaveCount(0);
    await expect(page.locator(".piano-key > span").first()).toHaveCSS("border-radius", "0px");
    await expect(page.locator(".piano-key > span").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator(".piano-key.role-root").first()).toHaveCSS("border-top", /0px none/);
    await expect(page.locator(".piano-key.role-root").first()).toHaveCSS("border-bottom", /0px none/);
    await expect(page.locator(".piano-key.role-chord-tone").first()).toHaveCSS("border-bottom", /0px none/);
    const rootBottomHighlight = await page.locator(".piano-key.role-root").first().evaluate((key) => getComputedStyle(key, "::after").borderBottom);
    expect(rootBottomHighlight).toMatch(/4px solid rgb\(255, 138, 61\)/);
    const chordBottomHighlight = await page.locator(".piano-key.role-chord-tone").first().evaluate((key) => getComputedStyle(key, "::after").borderBottom);
    expect(chordBottomHighlight).toMatch(/4px solid rgb\(255, 228, 92\)/);
    const nonChordBlackBottomHighlight = await page.locator(".piano-black.role-none").first().evaluate((key) => getComputedStyle(key, "::after").borderBottom);
    expect(nonChordBlackBottomHighlight).toMatch(/2px solid rgb\(23, 69, 38\)/);
    await expect(page.locator(".piano-key > span").first()).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(page.locator(".piano-key > span").first()).toHaveCSS("text-shadow", /rgb\(0, 0, 0\)/);
    const whiteKey = await page.locator(".piano-white").first().boundingBox();
    const blackKey = await page.locator(".piano-black").first().boundingBox();
    expect(blackKey?.width ?? 0).toBeCloseTo((whiteKey?.width ?? 0) * 0.75, 0);
    expect(blackKey?.height ?? 0).toBeCloseTo((whiteKey?.height ?? 0) * 0.75, 0);
    expect(blackKey?.y ?? 0).toBeCloseTo(whiteKey?.y ?? 0, 0);
    expect(blackKey?.x ?? 0).toBeGreaterThan((whiteKey?.x ?? 0) + (whiteKey?.width ?? 0) * 0.5);
    await expect(page.locator(".piano-white").first()).toHaveCSS("z-index", "1");
    await expect(page.locator(".piano-black").first()).toHaveCSS("z-index", "2");
    await expect(page.locator(".piano-black").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const blackBacking = await page.locator(".piano-black").first().evaluate((key) => getComputedStyle(key, "::before").backgroundColor);
    expect(blackBacking).toBe("rgb(0, 0, 0)");
    const blackBackingFilter = await page.locator(".piano-black").first().evaluate((key) => getComputedStyle(key, "::before").filter);
    expect(blackBackingFilter).toBe("blur(1px)");
    const blackBackingShadow = await page.locator(".piano-black").first().evaluate((key) => getComputedStyle(key, "::before").boxShadow);
    expect(blackBackingShadow).toContain("rgba(0, 0, 0, 0.8)");
    const blackBackingBottom = await page.locator(".piano-black").first().evaluate((key) => Number.parseFloat(getComputedStyle(key, "::before").bottom));
    expect(blackBackingBottom).toBeLessThan(0);
    expect(blackBackingBottom).toBeGreaterThan(-10);
    await expect(page.locator(".piano-key.role-root").first()).toHaveAttribute("data-opacity", expect.stringMatching(/^(?!0\.000$)/));
    await expect(page.locator(".piano-key.role-root").first()).toHaveCSS("border-top", /0px none/);
    const rootActivation = await page.locator(".piano-key.role-root").first().evaluate((key) => getComputedStyle(key, "::after").backgroundColor);
    expect(rootActivation).toMatch(/67, 255, 120/);
    await page.locator(".options-menu summary").click();
    const noteFontSize = page.getByRole("slider", { name: "Note font size" });
    await expect(noteFontSize).toHaveValue("7");
    await noteFontSize.fill("11");
    await expect(page.locator(".piano-key > span").first()).toHaveCSS("font-size", "11px");
    await noteFontSize.fill("7");
    await page.locator(".options-menu summary").click();
    await page.getByLabel("Zoom out").click();
    await expect(page.locator(".fretboard-navigation output")).toHaveText("0–36 / 36");
    await expect(page.locator(".piano-key")).toHaveCount(37);
    await expect(page.getByLabel("Zoom out")).toBeDisabled();
    await page.getByLabel("Zoom in").click();
    await expect(page.locator(".fretboard-navigation output")).toHaveText("0–24 / 36");
    await page.getByLabel("Zoom in").click();
    await expect(page.locator(".fretboard-navigation output")).toHaveText("0–12 / 36");
    await expect(page.locator(".piano-key")).toHaveCount(13);
    await expect(page.getByLabel("Next fret")).toBeEnabled();
    await page.getByLabel("Next fret").click();
    await expect(page.locator(".fretboard-navigation output")).toHaveText("1–13 / 36");
    await page.getByLabel("Previous fret").click();
    await expect(page.locator(".fretboard-navigation output")).toHaveText("0–12 / 36");
    await page.getByLabel("Zoom out").click();
    await expect(page.locator(".fretboard-navigation output")).toHaveText("0–24 / 36");
  }
  if (instrument.openNote !== undefined) {
    await expect(page.locator(".fretboard-navigation output")).toHaveText(instrument.fullRange ?? "");
    await expect(page.getByLabel("Previous fret")).toBeDisabled();
    await expect(page.getByLabel("Next fret")).toBeDisabled();
    await expect(page.getByLabel("Zoom in")).toBeEnabled();
    await expect(page.locator(".fret-labels span").nth(1)).toHaveText("0");
    await expect(page.locator(".fret-row").first().locator(".fret-cell").first()).toHaveAttribute("title", expect.stringContaining(instrument.openNote));
    await page.getByLabel("Zoom in").click();
    await expect(page.locator(".fretboard-navigation output")).toHaveText("0–15 / 24");
    await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(16);
    await expect(page.getByLabel("Next fret")).toBeEnabled();
    await page.getByLabel("Next fret").click();
    await expect(page.locator(".fretboard-navigation output")).toHaveText("1–16 / 24");
    await expect(page.locator(".fret-row").first().locator(".fret-cell").first()).toHaveAttribute("title", expect.stringContaining(instrument.walkedNote ?? ""));
    await page.getByLabel("Previous fret").click();
    await expect(page.locator(".fretboard-navigation output")).toHaveText("0–15 / 24");
    await page.getByLabel("Zoom out").click();
    await expect(page.locator(".fretboard-navigation output")).toHaveText(instrument.fullRange ?? "");
    await expect(page.locator(".fret-row").first().locator(".fret-cell")).toHaveCount(instrument.visibleCells);
  }
  await expect(page.locator(".fretboard-scroll")).toHaveScreenshot(screenshotName, {
    animations: "disabled",
    caret: "hide",
  });
}

test("switches desktop instrument displays and matches screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await loadAnalyzedFixture(page);

  for (const instrument of INSTRUMENTS) {
    await verifyInstrumentMode(page, instrument, `${instrument.label}-desktop.png`);
  }
});

test("switches mobile instrument displays and matches screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadAnalyzedFixture(page);

  for (const instrument of INSTRUMENTS) {
    await verifyInstrumentMode(page, instrument, `${instrument.label}-mobile.png`);
  }
});
