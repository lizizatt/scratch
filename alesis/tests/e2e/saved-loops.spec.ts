import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import WebSocket from "ws";
import { PROTOCOL_VERSION, type EngineCommand, type EngineSnapshot, type SavedLoopsStatus } from "../../packages/protocol/src/index.js";

interface Result { snapshot: EngineSnapshot; savedLoops: SavedLoopsStatus }

async function control(baseURL: string, command?: EngineCommand): Promise<Result> {
  const socket = new WebSocket(`${baseURL.replace("http", "ws")}/control`);
  return new Promise((resolve, reject) => {
    let latest: Result;
    let sent = false;
    const id = randomUUID();
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("Control timeout")); }, 10_000);
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "snapshot") {
        latest = { snapshot: message.snapshot, savedLoops: message.savedLoops };
        if (!command) { clearTimeout(timer); socket.close(); resolve(latest); }
        else if (!sent) { sent = true; socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: id, command })); }
      }
      if (message.type === "command-result" && message.commandId === id) {
        clearTimeout(timer); socket.close();
        if (message.accepted) resolve(latest);
        else reject(new Error(message.error));
      }
    });
  });
}

let original: EngineSnapshot["settings"];
async function reset(baseURL: string): Promise<void> {
  await control(baseURL, { type: "stop" });
  for (const { id } of (await control(baseURL)).savedLoops.items) await control(baseURL, { type: "delete-saved-loop", id });
  for (const { id } of (await control(baseURL)).snapshot.promoted) await control(baseURL, { type: "delete-take", takeId: id });
  await control(baseURL, { type: "delete-staged" });
  await control(baseURL, { type: "configure", settings: { bpm: 240, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false, metronomeEnabled: false }, clearAudio: true });
  await control(baseURL, { type: "set-overdub", enabled: false });
}
test.beforeEach(async ({ page, baseURL }) => {
  original = (await control(baseURL!)).snapshot.settings;
  await reset(baseURL!);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
});
test.afterEach(async ({ baseURL }) => {
  await reset(baseURL!);
  // Other specs clear audio only when the timing changes, so the original tempo must come back.
  await control(baseURL!, { type: "configure", settings: original, clearAudio: true });
});

async function promoteATake(page: Page, baseURL: string): Promise<void> {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote staged take", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Promote staged take", exact: true }).click();
  await expect.poll(async () => (await control(baseURL)).snapshot.promoted.length).toBe(1);
}
const panel = (page: Page) => page.locator(".saved-loops");

test("a loop can be saved under a name, closed out, and opened again to keep working", async ({ page, baseURL }, info) => {
  await promoteATake(page, baseURL!);
  await panel(page).locator("summary").click();
  const save = page.getByRole("button", { name: "Save loop", exact: true });
  await expect(save).toBeDisabled();
  await page.getByLabel("Name for this loop").fill("Verse idea");
  await save.click();
  await expect(page.getByRole("list", { name: "Saved loops" }).getByText("Verse idea")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Saved loop "Verse idea"/ })).toBeVisible();
  await expect(panel(page).locator("summary")).toContainText("(1)");
  await page.screenshot({ path: `artifacts/ui-qa/saved-loops-${info.project.name}.png` });

  await page.getByRole("button", { name: "Delete take 1", exact: true }).click();
  await expect.poll(async () => (await control(baseURL!)).snapshot.promoted.length).toBe(0);

  await page.getByRole("button", { name: "Open saved loop Verse idea", exact: true }).click();
  await expect.poll(async () => (await control(baseURL!)).snapshot.promoted.length).toBe(1);
  await expect(page.getByRole("button", { name: "Delete take 1", exact: true })).toBeVisible();
});

test("saving and opening are unavailable while playing, and a name must be valid", async ({ page, baseURL }) => {
  await promoteATake(page, baseURL!);
  await control(baseURL!, { type: "save-loop", name: "Existing" });
  await page.reload();
  await panel(page).locator("summary").click();
  const name = page.getByLabel("Name for this loop");
  await name.fill("bad/name");
  await expect(page.getByRole("button", { name: "Save loop", exact: true })).toBeDisabled();
  await name.fill("Fine name");
  await expect(page.getByRole("button", { name: "Save loop", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save loop", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Open saved loop Existing", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open saved loop Existing", exact: true })).toBeEnabled();
});

test("a saved loop can be deleted, and an export keeps its loop in the list", async ({ page, baseURL }) => {
  await promoteATake(page, baseURL!);
  const exported = `Exported ${randomUUID().slice(0, 8)}`;
  await control(baseURL!, { type: "export-mp3", name: exported });
  // The export folder lives inside the sample library, so its MP3s would show up as extra sample pads.
  await rm(join(process.env.ALESIS_EXPORT_DIR!, exported), { recursive: true, force: true });
  await page.reload();
  await panel(page).locator("summary").click();
  const list = page.getByRole("list", { name: "Saved loops" });
  await expect(list.getByText(exported)).toBeVisible();
  await page.getByRole("button", { name: `Delete saved loop ${exported}`, exact: true }).click();
  await expect(list.getByText(exported)).toHaveCount(0);
  expect((await control(baseURL!)).savedLoops.items).toEqual([]);
});

test("the saved loops list stays on screen at every viewport", async ({ page, baseURL }) => {
  await promoteATake(page, baseURL!);
  await control(baseURL!, { type: "save-loop", name: "A rather long loop name to test wrapping and clipping" });
  await page.reload();
  await panel(page).locator("summary").click();
  const viewport = page.viewportSize()!;
  for (const target of [page.getByLabel("Name for this loop"), page.getByRole("button", { name: /Open saved loop/ }), page.getByRole("button", { name: /Delete saved loop/ })]) {
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  }
});
