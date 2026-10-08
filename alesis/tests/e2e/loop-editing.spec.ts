import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
test.beforeEach(async ({ page, baseURL }) => {
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
  for (const command of [
    { type: "stop" },
    { type: "configure", settings: original.settings, clearAudio: true },
    { type: "select-synth", synthId: original.synth.selectedId },
    { type: "configure-arpeggiator", settings: original.arpeggiator },
    { type: "configure-drums", settings: original.drums },
    { type: "set-overdub", enabled: original.capture.overdub },
    { type: "set-loop-start", position: original.capture.loopStart },
    { type: "set-quantization", mode: original.capture.quantization },
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

test("marker controls are reachable, do not seek live transport, and apply on the next Play", async ({ page, baseURL }, info) => {
  await expect(page.getByLabel("Overdub staged loop")).not.toBeChecked();
  await expect(page.getByLabel("Loop start beat")).toHaveValue("0");
  await expect(page.getByRole("button", { name: "Set start here", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const target of [page.getByLabel("Overdub staged loop"), page.getByLabel("Loop start beat"), page.getByRole("button", { name: "Set start here", exact: true }), page.getByRole("button", { name: "Reset start", exact: true })]) await reachable(target);
  await page.getByLabel("Loop start beat").selectOption("0.25");
  await expect(page.getByLabel("Loop start beat")).toHaveValue("0.25");
  expect((await control(baseURL!)).transport.origin).toBe(0);
  await expect(page.locator(".current-capture .loop-start-marker")).toHaveAttribute("style", /left: 25%/);
  await page.getByRole("button", { name: "Set start here", exact: true }).click();
  await expect.poll(async () => (await control(baseURL!)).capture.loopStart).not.toBe(0.25);
  expect((await control(baseURL!)).transport.origin).toBe(0);
  await page.getByLabel("Loop start beat").selectOption("0.5");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await control(baseURL!)).transport.origin).toBe(0.5);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.screenshot({ path: `artifacts/ui-qa/loop-editing-${info.project.name}.png` });
  await page.getByRole("button", { name: "Reset start", exact: true }).click();
  await expect(page.getByLabel("Loop start beat")).toHaveValue("0");
  expect(await page.locator(".loop-pane").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test("stable overdub, marker and velocity floor survive browser reload and session restore", async ({ page, baseURL }, info) => {
  await page.getByLabel("Overdub staged loop").click();
  await expect(page.getByLabel("Overdub staged loop")).toBeChecked();
  await page.getByLabel("Loop start beat").selectOption("0.25");
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
  await expect(page.getByLabel("Loop start beat")).toHaveValue("0.25");
  const json = await download(page);
  const saved = parseLoopSession(json);
  expect(saved).toMatchObject({ overdub: true, loopStart: 0.25, sourceOrigin: 0, settings: { minimumVelocity: 72, velocityCurve: "responsive" } });
  expect(saved.staged!.rawRecording.some(({ event }) => event.type === "note-on" && event.velocity > 0)).toBe(true);
  const cache = JSON.parse(await readFile(process.env.ALESIS_SETTINGS_PATH!, "utf8"));
  expect(cache.settings.minimumVelocity).toBe(72);
  await page.getByLabel("Overdub staged loop").click();
  await expect(page.getByLabel("Overdub staged loop")).not.toBeChecked();
  await page.getByRole("button", { name: "Reset start", exact: true }).click();
  await control(baseURL!, { type: "configure", settings: { minimumVelocity: 1 } });
  await page.getByLabel("Loop session JSON file").setInputFiles({ name: "saved.json", mimeType: "application/json", buffer: Buffer.from(json) });
  await page.getByRole("button", { name: "Replace completed takes", exact: true }).click();
  await expect(page.locator(".session-feedback")).toContainText("Loop session loaded");
  await expect(page.getByLabel("Overdub staged loop")).toBeChecked();
  await expect(page.getByLabel("Loop start beat")).toHaveValue("0.25");
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
  await page.getByLabel("Loop start beat").selectOption("0.75");
  await page.getByLabel("Loop session JSON file").setInputFiles({ name: "legacy.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(legacy)) });
  await page.getByRole("button", { name: "Replace completed takes", exact: true }).click();
  await expect(page.locator(".session-feedback")).toContainText("Loop session loaded");
  await expect(page.getByLabel("Overdub staged loop")).not.toBeChecked();
  await expect(page.getByLabel("Loop start beat")).toHaveValue("0");
  const restored = await control(baseURL!);
  expect(restored.settings).toMatchObject({ bpm: 240, countInEnabled: false, minimumVelocity: 1 });
  expect(restored.transport.state).toBe("stopped");
});