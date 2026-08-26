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
