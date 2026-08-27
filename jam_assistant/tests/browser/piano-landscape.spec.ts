import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const FIXTURE_PATH = fileURLToPath(new URL("../fixtures/c-major.wav", import.meta.url));

test("renders the landscape piano keyboard and spectrum history", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
  await expect(page.locator(".chord-symbol")).toHaveText("C", { timeout: 10_000 });
  await page.getByLabel("Instrument display mode").selectOption("piano");
  await page.setViewportSize({ width: 800, height: 450 });

  await expect(page.locator(".piano-landscape")).toBeVisible();
  await expect(page.locator(".chord-panel")).toBeHidden();
  await expect(page.locator(".landscape-status")).toBeHidden();
  await expect(page.locator(".landscape-piano-key")).toHaveCount(72);
  await expect(page.locator('.landscape-piano-key[data-midi="36"]')).toBeVisible();
  await expect(page.locator('.landscape-piano-key[data-midi="107"]')).toBeVisible();
  await expect(page.locator(".piano-roll")).toBeVisible();
  await expect(page.locator(".piano-roll")).toHaveAttribute("aria-label", "Ten second piano spectrum history");
  await expect(page.locator(".piano-roll-cursor")).toHaveAttribute("x1", "800");
  await expect(page.locator(".piano-roll-note").first()).toBeVisible();
  const rollNoteXs = await page.locator(".piano-roll-note").evaluateAll((notes) => notes.map((note) => Number(note.getAttribute("x"))));
  expect(rollNoteXs.some((x) => x > 795 && x < 805)).toBe(true);
  await expect(page.locator(".piano-roll")).toHaveScreenshot("piano-roll-landscape.png", {
    animations: "disabled",
    caret: "hide",
  });

  await page.getByRole("button", { name: "Sheet music" }).click();
  await expect(page.locator(".piano-sheet")).toBeVisible();
  await expect(page.locator(".piano-roll")).toBeHidden();
  await expect(page.locator(".piano-sheet")).toHaveAttribute("aria-label", "Real-time piano sheet music");
  await expect(page.locator(".staff-line")).toHaveCount(10);
  await expect(page.locator(".sheet-cursor")).toHaveAttribute("x1", "800");
  await expect(page.locator(".sheet-note").first()).toBeVisible();

  await expect(page.locator(".piano-sheet")).toHaveScreenshot("piano-sheet-landscape.png", {
    animations: "disabled",
    caret: "hide",
  });
});
