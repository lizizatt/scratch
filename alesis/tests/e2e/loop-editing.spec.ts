import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import WebSocket from "ws";
import { PROTOCOL_VERSION, parseLoopSession, type EngineCommand, type EngineSnapshot } from "../../packages/protocol/src/index.js";

async function control(baseURL: string, command?: EngineCommand): Promise<EngineSnapshot> {
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
        if (!command) { clearTimeout(timer); socket.close(); resolve(snapshot); }
        else if (!sent) { sent = true; socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: id, command })); }
      }
      if (message.type === "command-result" && message.commandId === id) {
        clearTimeout(timer); socket.close();
        if (message.accepted) resolve(snapshot);
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
  original = await control(baseURL!);
  for (const command of [
    { type: "stop" },
    { type: "configure", settings: { bpm: 240, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false, metronomeEnabled: false, minimumVelocity: 1 }, clearAudio: true },
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

async function reachable(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport();
  expect(await target.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
}

async function download(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save loop session", exact: true }).click();
  return readFile((await (await pending).path())!, "utf8");
}

test("overdub presents the staged take as current capture without displaced lanes", async ({ page, baseURL }, info) => {
  await expect(page.getByLabel("Loop start beat")).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote previous staged take", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const before = await control(baseURL!);
  await page.getByLabel("Overdub staged loop").click();
  await expect(page.getByLabel("Overdub staged loop")).toBeChecked();
  await expect(page.locator(".staged-capture, .previous-staged-capture")).toHaveCount(0);
  for (const target of [page.getByLabel("Staged quantization"), page.getByRole("button", { name: "Promote staged take", exact: true }), page.getByRole("button", { name: "Mute staged take", exact: true })]) await reachable(target);
  expect((await control(baseURL!)).capture.staged).toEqual(before.capture.staged);
  await expect(page.locator(".current-capture .waveform svg")).toBeVisible();
  await page.screenshot({ path: `artifacts/ui-qa/overdub-${info.project.name}.png` });
  await page.getByLabel("Overdub staged loop").click();
  await expect(page.locator(".previous-staged-capture")).toBeVisible();
  expect((await control(baseURL!)).capture.previousStaged).toEqual(before.capture.previousStaged);
});

test("stable overdub, marker and velocity floor survive browser reload and session restore", async ({ page, baseURL }, info) => {
  await page.getByLabel("Overdub staged loop").click();
  await expect(page.getByLabel("Overdub staged loop")).toBeChecked();
  await control(baseURL!, { type: "set-loop-start", position: 0.25 });
  await page.getByRole("button", { name: "Options", exact: true }).click();
  const floor = page.getByLabel("Minimum impact velocity");
  await reachable(floor);
  await expect(floor).toHaveValue("1");
  await floor.selectOption("72");
  await page.getByLabel("Metronome", { exact: true }).check();
  await page.getByLabel("Key response", { exact: true }).selectOption("responsive");
  await expect(floor).toHaveValue("72");
  await page.screenshot({ path: `artifacts/ui-qa/loop-options-${info.project.name}.png` });
  await page.getByRole("button", { name: "Loops", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote staged take", exact: true })).toBeEnabled();
  const staged = (await control(baseURL!)).capture.staged!;
  await expect.poll(async () => (await control(baseURL!)).capture.staged!.cycle).toBeGreaterThan(staged.cycle);
  expect((await control(baseURL!)).capture.staged!.id).toBe(staged.id);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Overdub staged loop")).toBeChecked();
  expect((await control(baseURL!)).capture.loopStart).toBe(0.25);
  const json = await download(page);
  const saved = parseLoopSession(json);
  expect(saved).toMatchObject({ overdub: true, loopStart: 0.25, sourceOrigin: 0, settings: { minimumVelocity: 72, velocityCurve: "responsive" } });
  expect(saved.staged!.rawRecording.some(({ event }) => event.type === "note-on" && event.velocity > 0)).toBe(true);
  const cache = JSON.parse(await readFile(process.env.ALESIS_SETTINGS_PATH!, "utf8"));
  expect(cache.settings.minimumVelocity).toBe(72);
  await page.getByLabel("Overdub staged loop").click();
  await expect(page.getByLabel("Overdub staged loop")).not.toBeChecked();
  await control(baseURL!, { type: "set-loop-start", position: 0 });
  await control(baseURL!, { type: "configure", settings: { minimumVelocity: 1 } });
  await page.getByLabel("Loop session JSON file").setInputFiles({ name: "saved.json", mimeType: "application/json", buffer: Buffer.from(json) });
  await page.getByRole("button", { name: "Replace completed takes", exact: true }).click();
  await expect(page.locator(".session-feedback")).toContainText("Loop session loaded");
  await expect(page.getByLabel("Overdub staged loop")).toBeChecked();
  expect((await control(baseURL!)).capture.loopStart).toBe(0.25);
  expect(parseLoopSession(await download(page)).staged!.rawRecording).toEqual(saved.staged!.rawRecording);
  await page.getByRole("button", { name: "Options", exact: true }).click();
  await expect(page.getByLabel("Minimum impact velocity")).toHaveValue("72");
});

test("legacy sessions restore musical settings with marker zero, overdub off and unchanged velocity", async ({ page, baseURL }) => {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote staged take", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const legacy = JSON.parse(await download(page));
  delete legacy.sourceOrigin;
  delete legacy.loopStart;
  delete legacy.overdub;
  delete legacy.settings.minimumVelocity;
  await control(baseURL!, { type: "configure", settings: { minimumVelocity: 90 } });
  await page.getByLabel("Overdub staged loop").click();
  await expect(page.getByLabel("Overdub staged loop")).toBeChecked();
  await control(baseURL!, { type: "set-loop-start", position: 0.75 });
  await page.getByLabel("Loop session JSON file").setInputFiles({ name: "legacy.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(legacy)) });
  await page.getByRole("button", { name: "Replace completed takes", exact: true }).click();
  await expect(page.locator(".session-feedback")).toContainText("Loop session loaded");
  await expect(page.getByLabel("Overdub staged loop")).not.toBeChecked();
  await expect(page.getByLabel("Loop start beat")).toHaveCount(0);
  expect((await control(baseURL!)).capture.loopStart).toBe(0);
  const restored = await control(baseURL!);
  expect(restored.settings).toMatchObject({ bpm: 240, countInEnabled: false, minimumVelocity: 1 });
  expect(restored.transport.state).toBe("stopped");
});

test("shared export dialog snaps only start, previews on host, saves prepared bytes and cancels", async ({ page, baseURL }, info) => {
  const commands: EngineCommand[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    const message = JSON.parse(String(payload));
    if (message.command) commands.push(message.command);
  }));
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote previous staged take", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Promote previous staged take", exact: true }).click();
  await page.getByRole("button", { name: "Export loop to sample library", exact: true }).click();
  await expect(page.getByRole("button", { name: "Preview on host output", exact: true })).toBeDisabled();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await control(baseURL!, { type: "set-loop-start", position: 0.375 });
  const before = await control(baseURL!);
  const sessionBefore = parseLoopSession(await download(page));
  for (const target of ["sample", "promoted"] as const) {
    commands.length = 0;
    await page.getByRole("button", { name: target === "sample" ? "Export loop to sample library" : "Save promoted tracks as MP3 files", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Choose start beat").click();
    const slider = dialog.getByRole("slider", { name: "Export start beat" });
    await slider.focus();
    await slider.press("ArrowRight");
    await slider.press("ArrowRight");
    await slider.press("ArrowLeft");
    await expect(slider).toHaveValue("1");
    await expect(slider).toHaveAttribute("aria-valuetext", "Beat 2 of 4");
    const preview = dialog.getByRole("button", { name: "Preview on host output", exact: true });
    await reachable(preview);
    await preview.click();
    await expect(dialog.locator(".export-status")).toHaveText("previewing", { timeout: 30_000 });
    const midiCount = (await control(baseURL!)).engine.midiEventsReceived;
    // The production software MIDI source emits every 500ms, even while stopped.
    await page.waitForTimeout(1100);
    expect((await control(baseURL!)).engine.midiEventsReceived).toBe(midiCount);
    for (const command of [{ type: "play" }, { type: "trigger-sample-pad", pad: 0, velocity: 100 }, { type: "configure-arpeggiator", settings: { enabled: true } }] satisfies EngineCommand[]) {
      await expect(control(baseURL!, command)).rejects.toThrow("Stop export preview");
    }
    expect(commands.filter(({ type }) => type === "set-loop-start")).toHaveLength(0);
    expect((await control(baseURL!)).transport).toEqual(before.transport);
    await page.screenshot({ path: `artifacts/ui-qa/export-${target}-${info.project.name}.png` });
    await dialog.getByRole("button", { name: "Stop preview", exact: true }).click();
    await expect(dialog.locator(".export-status")).toHaveText("ready");
    await expect(slider).toHaveValue("1");
    if (target === "sample") {
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".sample-export-feedback")).toContainText("Saved Loop");
      expect(commands.filter(({ type }) => type === "prepare-loop-export")).toHaveLength(1);
      expect(commands.filter(({ type }) => type === "publish-loop-export")).toHaveLength(1);
    } else {
      await slider.press("ArrowRight");
      await expect(slider).toHaveValue("2");
      await preview.click();
      await expect(dialog.locator(".export-status")).toHaveText("previewing", { timeout: 30_000 });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(commands.filter(({ type }) => type === "prepare-loop-export")).toHaveLength(2);
      expect(commands.filter(({ type }) => type === "publish-loop-export")).toHaveLength(0);
    }
  }
  expect(parseLoopSession(await download(page))).toEqual(sessionBefore);
  const after = await control(baseURL!);
  expect(after.capture).toEqual(before.capture);
  expect(after.promoted).toEqual(before.promoted);
  expect(after.settings).toEqual(before.settings);
});

test("Stop, Panic, and browser disconnect cancel preview and leave transport stopped", async ({ page, baseURL }) => {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote staged take", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const before = await control(baseURL!);
  for (const cancel of ["stop", "panic", "disconnect"] as const) {
    await page.getByRole("button", { name: "Export loop to sample library", exact: true }).click();
    await page.getByRole("button", { name: "Preview on host output", exact: true }).click();
    await expect(page.locator(".export-status")).toHaveText("previewing", { timeout: 30_000 });
    if (cancel === "disconnect") {
      await page.reload();
      await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
    } else {
      await control(baseURL!, { type: cancel });
      await expect(page.locator(".export-status")).not.toContainText("previewing");
      await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    }
    const after = await control(baseURL!);
    expect(after.transport).toEqual(before.transport);
    expect(after.capture).toEqual(before.capture);
  }
});
