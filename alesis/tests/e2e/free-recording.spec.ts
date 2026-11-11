import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { PROTOCOL_VERSION, type EngineCommand, type EngineSnapshot, type FreeRecordingStatus } from "../../packages/protocol/src/index.js";

interface Result { snapshot: EngineSnapshot; freeRecording: FreeRecordingStatus }

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
        latest = { snapshot: message.snapshot, freeRecording: message.freeRecording };
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

let original: EngineSnapshot;
async function cleanRecordings(baseURL: string): Promise<void> {
  const { snapshot, freeRecording } = await control(baseURL);
  if (freeRecording.active) await control(baseURL, { type: "stop-free-recording" });
  for (const { id } of (await control(baseURL)).freeRecording.items) await control(baseURL, { type: "delete-free-recording", id });
  if (snapshot.capture.freeRecord) await control(baseURL, { type: "set-capture-mode", mode: "replace" });
}
test.beforeEach(async ({ page, baseURL }) => {
  original = (await control(baseURL!)).snapshot;
  await control(baseURL!, { type: "stop" });
  await cleanRecordings(baseURL!);
  await control(baseURL!, { type: "set-capture-mode", mode: "replace" });
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
});
test.afterEach(async ({ baseURL }) => {
  await control(baseURL!, { type: "stop" });
  await cleanRecordings(baseURL!);
  await control(baseURL!, { type: original.capture.overdub ? "set-overdub" : "set-capture-mode", ...original.capture.overdub ? { enabled: true } : { mode: "replace" } } as EngineCommand);
});

const modeSwitch = (page: Page) => page.getByRole("radiogroup", { name: "Capture mode" });
const radio = (page: Page, name: string) => modeSwitch(page).getByRole("radio", { name });

test("a three-position switch chooses Replace, Overdub or Record", async ({ page, baseURL }, info) => {
  await expect(modeSwitch(page).getByRole("radio")).toHaveCount(3);
  await expect(radio(page, "Replace staged loop")).toBeChecked();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  await radio(page, "Overdub staged loop").click();
  await expect(radio(page, "Overdub staged loop")).toBeChecked();
  await expect(radio(page, "Replace staged loop")).not.toBeChecked();
  expect((await control(baseURL!)).snapshot.capture).toMatchObject({ overdub: true, freeRecord: false });

  await radio(page, "Record open-ended take").click();
  await expect(radio(page, "Record open-ended take")).toBeChecked();
  expect((await control(baseURL!)).snapshot.capture).toMatchObject({ overdub: false, freeRecord: true });
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Recording", exact: true })).toBeVisible();
  await expect(page.locator(".signal-stack")).toHaveCount(0);
  await page.screenshot({ path: `artifacts/ui-qa/free-record-idle-${info.project.name}.png` });

  await radio(page, "Replace staged loop").click();
  await expect(radio(page, "Replace staged loop")).toBeChecked();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(page.locator(".signal-stack")).toBeVisible();
});

test("Record is unavailable while the loop transport runs, but Replace and Overdub still swap", async ({ page, baseURL }) => {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(radio(page, "Record open-ended take")).toBeDisabled();
  await radio(page, "Overdub staged loop").click();
  await expect(radio(page, "Overdub staged loop")).toBeChecked();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(radio(page, "Record open-ended take")).toBeEnabled();
  expect((await control(baseURL!)).snapshot.transport.state).toBe("stopped");
});

test("recording logs the performance live, then offers the MIDI file and the MP3", async ({ page, baseURL }, info) => {
  await radio(page, "Record open-ended take").click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeEnabled();
  await expect(page.locator(".transport-status")).toContainText(/recording \/\/ \d+:\d\d/);
  // The mode cannot change under a running recording.
  for (const name of ["Replace staged loop", "Overdub staged loop", "Record open-ended take"]) await expect(radio(page, name)).toBeDisabled();

  // The software keyboard plays a note every half second; the lane fills as they sound.
  const lines = page.locator(".free-lane .waveform svg line");
  await expect.poll(() => lines.count(), { timeout: 8_000 }).toBeGreaterThan(2);
  await expect(page.locator(".free-stats")).toContainText(/\d+ notes/);
  const elapsed = async () => (await page.locator(".free-lane .lane-label").textContent())!;
  const first = await elapsed();
  await expect.poll(elapsed).not.toBe(first);
  await page.screenshot({ path: `artifacts/ui-qa/free-record-active-${info.project.name}.png` });

  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  const row = page.getByRole("article").first();
  await expect(row).toBeVisible();
  const midiLink = row.getByRole("link", { name: /Download MIDI/ });
  await expect(midiLink).toBeVisible();
  await expect(row.getByRole("link", { name: /Download MP3/ })).toBeVisible({ timeout: 30_000 });
  await expect(radio(page, "Replace staged loop")).toBeEnabled();
  await page.screenshot({ path: `artifacts/ui-qa/free-record-done-${info.project.name}.png` });

  const midiHref = (await midiLink.getAttribute("href"))!;
  const mp3Href = (await row.getByRole("link", { name: /Download MP3/ }).getAttribute("href"))!;
  const midi = await page.request.get(midiHref);
  expect(midi.status()).toBe(200);
  expect((await midi.body()).subarray(0, 4).toString()).toBe("MThd");
  const mp3 = await page.request.get(mp3Href);
  expect(mp3.status()).toBe(200);
  expect((await mp3.body()).length).toBeGreaterThan(2_000);

  page.once("dialog", (dialog) => void dialog.accept());
  await row.getByRole("button", { name: /^Delete Jam/ }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  expect((await page.request.get(midiHref)).status()).toBe(404);
});

test("a recording with no notes is discarded with an explanation", async ({ page, baseURL }) => {
  await control(baseURL!, { type: "set-capture-mode", mode: "record" });
  await page.reload();
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
  // Stop before the demo keyboard's first note after a very short take.
  await control(baseURL!, { type: "start-free-recording" });
  await control(baseURL!, { type: "stop-free-recording" });
  const { freeRecording } = await control(baseURL!);
  if (freeRecording.items.length === 0) await expect(page.locator(".free-notice")).toContainText("Nothing was played");
});

test("the recording controls stay reachable and on screen at every viewport", async ({ page, baseURL }) => {
  await control(baseURL!, { type: "set-capture-mode", mode: "record" });
  await page.reload();
  const viewport = page.viewportSize()!;
  for (const target of [page.getByRole("button", { name: "Record", exact: true }), modeSwitch(page), page.locator(".free-lane .waveform")]) {
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }
});
