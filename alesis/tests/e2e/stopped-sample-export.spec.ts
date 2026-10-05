import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import WebSocket from "ws";
import { PROTOCOL_VERSION, type EngineCommand, type EngineSnapshot } from "../../packages/protocol/src/index.js";

async function control(baseURL: string, command?: EngineCommand): Promise<EngineSnapshot> {
  const socket = new WebSocket(`${baseURL.replace("http", "ws")}/control`);
  return new Promise((resolve, reject) => {
    let snapshot: EngineSnapshot;
    let sent = false;
    const commandId = randomUUID();
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error("Control command timed out")); }, 10_000);
    socket.on("error", (error) => { clearTimeout(timeout); reject(error); });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "snapshot") {
        snapshot = message.snapshot;
        if (!command) { clearTimeout(timeout); socket.close(); resolve(snapshot); }
        else if (!sent) { sent = true; socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId, command })); }
      }
      if (message.type === "command-result" && message.commandId === commandId) {
        clearTimeout(timeout);
        socket.close();
        if (message.accepted) resolve(snapshot);
        else reject(new Error(message.error ?? "Control command rejected"));
      }
    });
  });
}

test("exports a completed demo take while stopped without restarting transport", async ({ page, baseURL }) => {
  const sampleRoot = process.env.ALESIS_E2E_SAMPLE_LIBRARY_DIR!;
  expect((await stat(join(sampleRoot, ".alesis-playwright-owned"))).isFile()).toBe(true);
  const original = await control(baseURL!);
  let exportedPath: string | undefined;
  let exporting = false;
  const exportStates: string[] = [];
  const exportCommands: EngineCommand[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().endsWith("/control")) return;
    socket.on("framesent", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (exporting && message.command) exportCommands.push(message.command);
    });
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (exporting && message.type === "snapshot") exportStates.push(message.snapshot.transport.state);
    });
  });

  try {
    for (const command of [
      { type: "stop" },
      { type: "configure", settings: { bpm: 121 }, clearAudio: true },
      { type: "configure", settings: { bpm: 120, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false, metronomeEnabled: false }, clearAudio: true },
      { type: "select-synth", synthId: "subtractive" },
      { type: "configure-arpeggiator", settings: { enabled: false, latch: false } },
      { type: "configure-drums", settings: { enabled: false } },
      { type: "set-monitor-only", enabled: false },
      { type: "set-staged-audible", audible: true },
    ] satisfies EngineCommand[]) await control(baseURL!, command);

    await page.goto("/");
    await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
    const exportButton = page.getByRole("button", { name: "Export loop to sample library", exact: true });
    await expect(exportButton).toBeDisabled();
    await expect(page.locator(".sample-export-hint")).toContainText("Add an audible staged/promoted take");

    // Playback here records the real software demo; it is stopped before requesting export.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    const promote = page.getByRole("button", { name: "Promote staged take", exact: true });
    await expect(promote).toBeEnabled({ timeout: 10_000 });
    await promote.click();
    await expect(page.locator(".take-row")).toHaveCount(1);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator(".transport-status")).toContainText("stopped");
    const before = await control(baseURL!);
    expect(before.transport.state).toBe("stopped");
    expect(before.promoted).toHaveLength(1);
    await expect(exportButton).toBeEnabled();

    exporting = true;
    await exportButton.click();
    const feedback = page.locator(".sample-export-feedback");
    await expect(feedback).toHaveText(/^Saved Loop \d{4,}\.mp3 to the sample library\.$/, { timeout: 30_000 });
    const filename = (await feedback.textContent())!.match(/^Saved (Loop \d{4,}\.mp3) to the sample library\.$/)![1]!;
    exportedPath = join(sampleRoot, filename);
    expect((await stat(exportedPath)).size).toBeGreaterThan(1_000);
    const after = await control(baseURL!);
    expect(after.transport).toEqual(before.transport);
    expect(after.capture).toEqual(before.capture);
    expect(after.promoted).toEqual(before.promoted);
    expect(after.settings).toEqual(before.settings);
    expect(exportCommands.map(({ type }) => type)).toEqual(["export-loop-sample"]);
    expect(exportStates.length).toBeGreaterThan(0);
    expect(exportStates.every((state) => state === "stopped")).toBe(true);
    await expect(page.locator(".transport-status")).toContainText("stopped");
    await expect(exportButton).toBeEnabled();
  } finally {
    exporting = false;
    if (exportedPath) await rm(exportedPath, { force: true });
    for (const command of [
      { type: "stop" },
      { type: "configure", settings: { bpm: 30 }, clearAudio: true },
      { type: "configure", settings: original.settings, clearAudio: true },
      { type: "select-synth", synthId: original.synth.selectedId },
      { type: "configure-arpeggiator", settings: original.arpeggiator },
      { type: "configure-drums", settings: original.drums },
      { type: "set-monitor-only", enabled: original.monitorOnly },
      { type: "set-staged-audible", audible: original.capture.stagedAudible },
      { type: "refresh-samples" },
    ] satisfies EngineCommand[]) await control(baseURL!, command);
  }
});
