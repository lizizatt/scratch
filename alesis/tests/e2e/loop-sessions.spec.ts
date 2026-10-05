import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { PROTOCOL_VERSION, parseLoopSession, type EngineCommand, type EngineSnapshot, type LoopSession } from "../../packages/protocol/src/index.js";

async function command(baseURL: string, command?: EngineCommand): Promise<{ snapshot: EngineSnapshot; result?: { accepted: boolean; error?: string; sessionJson?: string } }> {
  const socket = new WebSocket(`${baseURL.replace("http", "ws")}/control`);
  return new Promise((resolve, reject) => {
    let snapshot: EngineSnapshot;
    let sent = false;
    const id = randomUUID();
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error("Control command timed out")); }, 10_000);
    socket.on("error", reject);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "snapshot") {
        snapshot = message.snapshot;
        if (!command) { clearTimeout(timeout); socket.close(); resolve({ snapshot }); }
        else if (!sent) { sent = true; socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: id, command })); }
      }
      if (message.type === "command-result" && message.commandId === id) {
        clearTimeout(timeout);
        socket.close();
        resolve({ snapshot, result: message });
      }
    });
  });
}

let original: EngineSnapshot | undefined;
test.beforeEach(async ({ baseURL }) => {
  original = (await command(baseURL!)).snapshot;
  for (const cmd of [
    { type: "stop" },
    { type: "configure", settings: { bpm: 241 }, clearAudio: true },
    { type: "configure", settings: { bpm: 240, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false, metronomeEnabled: false }, clearAudio: true },
    { type: "select-synth", synthId: "subtractive" },
    { type: "configure-arpeggiator", settings: { enabled: false, latch: false } },
    { type: "configure-drums", settings: { enabled: false } },
    { type: "set-monitor-only", enabled: false },
    { type: "set-staged-audible", audible: true },
  ] satisfies EngineCommand[]) expect((await command(baseURL!, cmd)).result?.accepted).toBe(true);
});
test.afterEach(async ({ baseURL }) => {
  if (!original) return;
  for (const cmd of [
    { type: "stop" },
    { type: "configure", settings: { bpm: 30 }, clearAudio: true },
    { type: "configure", settings: original.settings, clearAudio: true },
    { type: "select-synth", synthId: original.synth.selectedId },
    { type: "configure-arpeggiator", settings: original.arpeggiator },
    { type: "configure-drums", settings: original.drums },
    { type: "set-quantization", mode: original.capture.quantization },
    { type: "set-monitor-only", enabled: original.monitorOnly },
    { type: "set-staged-audible", audible: original.capture.stagedAudible },
  ] satisfies EngineCommand[]) await command(baseURL!, cmd);
});

async function recordTakes(page: Page) {
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
  await page.getByLabel("Staged quantization").selectOption("1/16");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save loop session", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Load loop session", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Promote staged take", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Promote staged take", exact: true }).click();
  await expect(page.locator(".take-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Promote staged take", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Promote staged take", exact: true }).click();
  await expect(page.locator(".take-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Promote staged take", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Promote previous staged take", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save loop session", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Mute take 1", exact: true }).click();
  await page.getByLabel("Level take 2").fill("37");
  await expect(page.getByLabel("Level take 2")).toHaveValue("37");
}

async function download(page: Page): Promise<{ json: string; session: LoopSession }> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save loop session", exact: true }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(/^alesis-loop-session-.*\.json$/);
  const json = await readFile((await file.path())!, "utf8");
  return { json, session: parseLoopSession(json) };
}
async function upload(page: Page, json: string) {
  await page.getByLabel("Loop session JSON file").setInputFiles({ name: "saved-loop.json", mimeType: "application/json", buffer: Buffer.from(json) });
}
function withoutIds(value: LoopSession): LoopSession {
  const session = structuredClone(value);
  for (const entry of [session.staged, session.previousStaged, ...session.promoted]) if (entry) entry.take.id = "ignored";
  return session;
}

test("downloads and restores editable MIDI after confirmation, and cancel preserves existing takes", async ({ page, baseURL }) => {
  await recordTakes(page);
  const saved = await download(page);
  expect(saved.session.promoted).toHaveLength(2);
  expect(saved.session.staged).not.toBeNull();
  expect(saved.session.previousStaged).not.toBeNull();
  expect(saved.session.promoted.some(({ recording }) => recording.some(({ event }) => event.type === "note-on"))).toBe(true);
  await page.getByRole("button", { name: "Delete take 1", exact: true }).click();
  await expect(page.locator(".take-row")).toHaveCount(1);
  await upload(page, saved.json);
  await expect(page.getByRole("dialog", { name: "Replace completed takes?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".take-row")).toHaveCount(1);
  expect((await command(baseURL!)).snapshot.promoted).toHaveLength(1);
  await upload(page, saved.json);
  await page.getByRole("button", { name: "Replace completed takes", exact: true }).click();
  await expect(page.locator(".session-feedback")).toHaveText("Loop session loaded. Transport remains stopped.");
  await expect(page.locator(".take-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Unmute take 1", exact: true })).toBeVisible();
  await expect(page.getByLabel("Level take 2")).toHaveValue("37");
  await expect(page.getByRole("button", { name: "Undo delete", exact: true })).not.toBeVisible();
  expect((await command(baseURL!)).snapshot.transport.state).toBe("stopped");
  expect(withoutIds((await download(page)).session)).toEqual(withoutIds(saved.session));
  await page.getByLabel("Staged quantization").selectOption("off");
  const raw = (await download(page)).session;
  expect(raw.staged!.recording).toEqual(saved.session.staged!.rawRecording);
  expect(raw.promoted.map(({ recording }) => recording)).toEqual(saved.session.promoted.map(({ recording }) => recording));
});

test("invalid files and missing capabilities are recoverable without replacement", async ({ page, baseURL }) => {
  await recordTakes(page);
  const saved = await download(page);
  await upload(page, "not JSON");
  await expect(page.locator(".session-feedback[role=alert]")).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const bad = structuredClone(saved.session);
  bad.synth.soundFont = { id: "missing-font", name: "Missing font", preset: { id: "0:0", bank: 0, program: 0, name: "Missing preset" } };
  await upload(page, JSON.stringify(bad));
  await page.getByRole("button", { name: "Replace completed takes", exact: true }).click();
  await expect(page.locator(".session-feedback[role=alert]")).toContainText("Missing SoundFont");
  expect(withoutIds((await download(page)).session)).toEqual(withoutIds(saved.session));
  // A second client can invalidate a file dialog's stopped snapshot; the server also enforces it.
  await command(baseURL!, { type: "play" });
  const rejected = await command(baseURL!, { type: "import-loop-session", sessionJson: saved.json });
  expect(rejected.result).toMatchObject({ accepted: false, error: expect.stringContaining("Stop transport") });
  await command(baseURL!, { type: "stop" });
  await upload(page, saved.json);
  await page.getByRole("button", { name: "Replace completed takes", exact: true }).click();
  await expect(page.locator(".session-feedback")).toHaveText("Loop session loaded. Transport remains stopped.");
});
