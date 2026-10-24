import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import WebSocket from "ws";
import { PROTOCOL_VERSION, type EditableNote, type EngineCommand, type EngineSnapshot } from "../../packages/protocol/src/index.js";

interface Result { snapshot: EngineSnapshot; takeNotes?: { version: number; notes: EditableNote[] } }

async function control(baseURL: string, command?: EngineCommand): Promise<Result> {
  const socket = new WebSocket(`${baseURL.replace("http", "ws")}/control`);
  return new Promise((resolve, reject) => {
    let snapshot: EngineSnapshot;
    let sent = false;
    const id = randomUUID();
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("Control timeout")); }, 10_000);
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "snapshot") {
        snapshot = message.snapshot;
        if (!command) { clearTimeout(timer); socket.close(); resolve({ snapshot }); }
        else if (!sent) { sent = true; socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: id, command })); }
      }
      if (message.type === "command-result" && message.commandId === id) {
        clearTimeout(timer); socket.close();
        if (message.accepted) resolve({ snapshot, takeNotes: message.takeNotes });
        else reject(new Error(message.error));
      }
    });
  });
}

let original: EngineSnapshot;
let originalSamples: Set<string>;
test.beforeEach(async ({ page, baseURL }) => {
  const root = process.env.ALESIS_E2E_SAMPLE_LIBRARY_DIR!;
  expect((await stat(join(root, ".alesis-playwright-owned"))).isFile()).toBe(true);
  originalSamples = new Set(await readdir(root));
  original = (await control(baseURL!)).snapshot;
  for (const command of [
    { type: "stop" },
    { type: "configure", settings: { bpm: 240, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false, metronomeEnabled: false, minimumVelocity: 1, maximumVelocity: 127 }, clearAudio: true },
    { type: "select-synth", synthId: "subtractive" },
    { type: "configure-arpeggiator", settings: { enabled: false, latch: false } },
    { type: "configure-drums", settings: { enabled: false } },
    { type: "set-overdub", enabled: false },
    { type: "set-quantization", mode: "off" },
  ] satisfies EngineCommand[]) await control(baseURL!, command);
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
});
test.afterEach(async ({ baseURL }) => {
  const root = process.env.ALESIS_E2E_SAMPLE_LIBRARY_DIR!;
  for (const name of await readdir(root)) {
    if (!originalSamples.has(name) && name.endsWith(".mp3")) await rm(join(root, name));
  }
  for (const command of [
    { type: "stop" },
    { type: "configure", settings: original.settings, clearAudio: true },
    { type: "select-synth", synthId: original.synth.selectedId },
    { type: "configure-arpeggiator", settings: original.arpeggiator },
    { type: "configure-drums", settings: original.drums },
    { type: "set-overdub", enabled: original.capture.overdub },
    { type: "set-loop-start", position: original.capture.loopStart },
    { type: "set-quantization", mode: original.capture.quantization },
    { type: "refresh-samples" },
  ] satisfies EngineCommand[]) await control(baseURL!, command);
});

/** Records the demo performance, promotes it and opens its editor from the loop window. */
async function openPromotedTake(page: Page, baseURL: string) {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote staged take", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Promote staged take", exact: true }).click();
  await expect.poll(async () => (await control(baseURL)).snapshot.promoted.length).toBe(1);
  const takeId = (await control(baseURL)).snapshot.promoted[0]!.id;
  await page.getByRole("button", { name: "Edit take 1", exact: true }).click();
  await expect(page.getByRole("region", { name: "Take editor" })).toBeVisible();
  await expect(page.locator(".roll-note").first()).toBeVisible();
  return takeId;
}

const notesOf = async (baseURL: string, takeId: string) => (await control(baseURL, { type: "get-take-notes", takeId })).takeNotes!.notes;
async function center(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

test("a take opens in its editor from the loop window and Back returns to it", async ({ page, baseURL }, info) => {
  await openPromotedTake(page, baseURL!);
  const back = page.getByRole("button", { name: "Back", exact: true });
  const box = (await back.boundingBox())!;
  expect(box.x).toBeLessThan(120);
  expect(box.y).toBeLessThan(120);
  await page.screenshot({ path: `artifacts/ui-qa/take-editor-${info.project.name}.png` });
  await back.click();
  await expect(page.getByRole("region", { name: "Looper" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Take editor" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Promoted takes" })).toBeVisible();
});

test("the staged take and the previous staged take open in the editor", async ({ page }) => {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote previous staged take", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Edit staged take", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Staged take" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Edit previous staged take", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Previous staged take" })).toBeVisible();
});

test("dragging a note moves it in time and pitch, snapping to the chosen grid", async ({ page, baseURL }) => {
  const takeId = await openPromotedTake(page, baseURL!);
  const before = await notesOf(baseURL!, takeId);
  const first = before[0]!;
  await page.getByLabel("Snap to grid").selectOption("1/4");
  const { x, y } = await center(page.locator(".roll-note").first());
  const direction = first.start > 0.5 ? -1 : 1;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + direction * 60, y - 16 * 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await notesOf(baseURL!, takeId)).some((entry) => entry.note === first.note + 2)).toBe(true);
  const after = await notesOf(baseURL!, takeId);
  const moved = after.find((entry) => entry.note === first.note + 2)!;
  // 4 beats at 1/4 snap: every start is a multiple of a quarter of the loop.
  expect(moved.start * 4).toBeCloseTo(Math.round(moved.start * 4), 6);
  expect(moved.start).not.toBe(first.start);
  expect(moved.velocity).toBe(first.velocity);
  expect(after).toHaveLength(before.length);
});

test("right-dragging a note shows and changes its velocity regardless of the configured impact range", async ({ page, baseURL }) => {
  await control(baseURL!, { type: "configure", settings: { minimumVelocity: 60, maximumVelocity: 70 } });
  const takeId = await openPromotedTake(page, baseURL!);
  const before = (await notesOf(baseURL!, takeId))[0]!;
  const note = page.locator(".roll-note").first();
  const { x, y } = await center(note);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x, y + 90, { steps: 6 });
  await expect(page.getByRole("status").filter({ hasText: /^Velocity \d+$/ })).toBeVisible();
  await page.mouse.up({ button: "right" });
  await expect(page.locator(".velocity-tooltip")).toHaveCount(0);
  await expect.poll(async () => (await notesOf(baseURL!, takeId))[0]!.velocity).toBeLessThan(before.velocity);
  const lowered = (await notesOf(baseURL!, takeId))[0]!;
  expect(lowered.velocity).toBeGreaterThanOrEqual(1);
  expect(lowered.start).toBe(before.start);
  expect(lowered.note).toBe(before.note);
  // The configured range only shapes live playing.
  expect(lowered.velocity).toBeLessThan(60);
  expect((await control(baseURL!)).snapshot.settings).toMatchObject({ minimumVelocity: 60, maximumVelocity: 70 });
});

test("the velocity tool edits velocity with a plain drag for touch screens", async ({ page, baseURL }) => {
  const takeId = await openPromotedTake(page, baseURL!);
  const before = (await notesOf(baseURL!, takeId))[0]!;
  await page.getByRole("button", { name: "Velocity", exact: true }).click();
  const { x, y } = await center(page.locator(".roll-note").first());
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 20, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await notesOf(baseURL!, takeId))[0]!.velocity).toBeLessThan(before.velocity);
  expect((await notesOf(baseURL!, takeId))[0]!.start).toBe(before.start);
});

test("Quantize snaps notes to the grid, Undo restores them and Delete removes the selection", async ({ page, baseURL }) => {
  const takeId = await openPromotedTake(page, baseURL!);
  await page.getByLabel("Snap to grid").selectOption("off");
  const original = await notesOf(baseURL!, takeId);
  const note = page.locator(".roll-note").first();
  const { x, y } = await center(note);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 23, y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify((await notesOf(baseURL!, takeId)).map(({ start }) => start))).not.toBe(JSON.stringify(original.map(({ start }) => start)));

  await page.getByLabel("Snap to grid").selectOption("1/16");
  // The dragged note stays selected, so Quantize applies to it; clearing the selection widens it to every note.
  await expect(page.getByRole("button", { name: "Quantize selected", exact: true })).toBeVisible();
  await page.locator(".roll-grid").click({ position: { x: 3, y: 3 } });
  await page.getByRole("button", { name: "Quantize all", exact: true }).click();
  await expect.poll(async () => (await notesOf(baseURL!, takeId)).every(({ start }) => Math.abs(start * 16 - Math.round(start * 16)) < 1e-6)).toBe(true);

  await page.getByRole("button", { name: "Undo edit" }).click();
  await expect.poll(async () => (await notesOf(baseURL!, takeId)).every(({ start }) => Math.abs(start * 16 - Math.round(start * 16)) < 1e-6)).toBe(false);

  const count = (await notesOf(baseURL!, takeId)).length;
  await page.locator(".roll-note").first().click();
  await page.getByRole("button", { name: "Delete selected notes" }).click();
  await expect.poll(async () => (await notesOf(baseURL!, takeId)).length).toBe(count - 1);
  expect((await control(baseURL!)).snapshot.promoted[0]!.waveform.length).toBeGreaterThan(0);
});

test("a stale editor is refused rather than overwriting a newer edit", async ({ page, baseURL }) => {
  const takeId = await openPromotedTake(page, baseURL!);
  const { takeNotes } = await control(baseURL!, { type: "get-take-notes", takeId });
  await control(baseURL!, { type: "set-take-notes", takeId, version: takeNotes!.version, notes: takeNotes!.notes });
  await expect(control(baseURL!, { type: "set-take-notes", takeId, version: takeNotes!.version, notes: [] })).rejects.toThrow(/changed/);
  await page.getByLabel("Snap to grid").selectOption("off");
  const { x, y } = await center(page.locator(".roll-note").first());
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByRole("alert")).toContainText(/changed since it was opened/);
  await expect(page.locator(".roll-note").first()).toBeVisible();
});

test("impact velocity sliders set the range and push each other instead of inverting it", async ({ page, baseURL }, info) => {
  await page.getByRole("button", { name: "Options", exact: true }).click();
  const min = page.getByLabel("Minimum impact velocity");
  const max = page.getByLabel("Maximum impact velocity");
  await expect(min).toHaveValue("1");
  await expect(max).toHaveValue("127");
  await max.fill("90");
  await expect.poll(async () => (await control(baseURL!)).snapshot.settings.maximumVelocity).toBe(90);
  await min.fill("100");
  await expect.poll(async () => (await control(baseURL!)).snapshot.settings).toMatchObject({ minimumVelocity: 100, maximumVelocity: 100 });
  await max.fill("40");
  await expect.poll(async () => (await control(baseURL!)).snapshot.settings).toMatchObject({ minimumVelocity: 40, maximumVelocity: 40 });
  await expect(min).toHaveValue("40");
  await page.screenshot({ path: `artifacts/ui-qa/impact-options-${info.project.name}.png` });
});
