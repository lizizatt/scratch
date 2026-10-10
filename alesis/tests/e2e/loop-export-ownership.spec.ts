import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { PROTOCOL_VERSION, type EngineCommand, type EngineSnapshot, type ServerMessage } from "../../packages/protocol/src/index.js";

type Result = Extract<ServerMessage, { type: "command-result" }>;

async function connect(baseURL: string) {
  const socket = new WebSocket(`${baseURL.replace("http", "ws")}/control`);
  const results = new Map<string, (result: Result) => void>();
  let snapshot!: EngineSnapshot;
  const ready = new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("message", () => resolve());
  });
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as ServerMessage;
    if (message.type === "snapshot") snapshot = message.snapshot;
    if (message.type === "command-result") results.get(message.commandId)?.(message);
  });
  await ready;
  return {
    snapshot: () => snapshot,
    async command(command: EngineCommand) {
      const commandId = randomUUID();
      const result = await new Promise<Result>((resolve, reject) => {
        const timer = setTimeout(() => { results.delete(commandId); reject(new Error("Control timeout")); }, 10_000);
        results.set(commandId, (result) => { clearTimeout(timer); results.delete(commandId); resolve(result); });
        socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId, command }));
      });
      expect(result.accepted, result.error).toBe(true);
      return result;
    },
    close() { socket.close(); },
  };
}

async function openExport(page: Page) {
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
  await page.getByRole("button", { name: "Export loop to sample library", exact: true }).click();
  return page.getByRole("dialog");
}

let original: EngineSnapshot;
test.beforeEach(async ({ page, baseURL }) => {
  const control = await connect(baseURL!);
  try {
    original = control.snapshot();
    for (const command of [
      { type: "stop" },
      { type: "configure", settings: { bpm: 121 }, clearAudio: true },
      { type: "configure", settings: { bpm: 240, loopMeasures: 1, beatsPerMeasure: 4, countInEnabled: false, metronomeEnabled: false }, clearAudio: true },
      { type: "select-synth", synthId: "subtractive" },
      { type: "configure-arpeggiator", settings: { enabled: false, latch: false } },
      { type: "configure-drums", settings: { enabled: false } },
      { type: "set-monitor-only", enabled: false },
      { type: "set-staged-audible", audible: true },
    ] satisfies EngineCommand[]) await control.command(command);
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Promote staged take", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
  } finally { control.close(); }
});

test.afterEach(async ({ baseURL }) => {
  const control = await connect(baseURL!);
  try {
    for (const command of [
      { type: "stop" },
      { type: "configure", settings: { bpm: 121 }, clearAudio: true },
      { type: "configure", settings: original.settings, clearAudio: true },
      { type: "select-synth", synthId: original.synth.selectedId },
      { type: "configure-arpeggiator", settings: original.arpeggiator },
      { type: "configure-drums", settings: original.drums },
      { type: "set-monitor-only", enabled: original.monitorOnly },
      { type: "set-staged-audible", audible: original.capture.stagedAudible },
    ] satisfies EngineCommand[]) await control.command(command);
  }
  finally { control.close(); }
});

for (const dismissal of ["Cancel", "Escape"] as const) {
  test(`${dismissal} closes a rejected export without releasing the other browser's artifact`, async ({ page, context }) => {
    const owner = await context.newPage();
    try {
      const ownerDialog = await openExport(owner);
      await ownerDialog.getByRole("button", { name: "Preview on host output", exact: true }).click();
      await expect(ownerDialog.locator(".export-status")).toHaveText("previewing", { timeout: 30_000 });
      await ownerDialog.getByRole("button", { name: "Stop preview", exact: true }).click();
      await expect(ownerDialog.locator(".export-status")).toHaveText("ready");
      const commands: EngineCommand[] = [];
      page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
        const message = JSON.parse(String(payload));
        if (message.command) commands.push(message.command);
      }));
      const rejected = await openExport(page);
      await rejected.getByRole("button", { name: "Preview on host output", exact: true }).click();
      await expect(rejected.getByRole("alert")).toContainText("Another export is active");
      if (dismissal === "Escape") await page.keyboard.press("Escape");
      else await rejected.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(rejected).toHaveCount(0);
      expect(commands.map(({ type }) => type)).toEqual(["prepare-loop-export"]);
      await expect(ownerDialog.locator(".export-status")).toHaveText("ready");
      await ownerDialog.getByRole("button", { name: "Preview on host output", exact: true }).click();
      await expect(ownerDialog.locator(".export-status")).toHaveText("previewing");
      await ownerDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(ownerDialog).toHaveCount(0);
    } finally { await owner.close(); }
  });
}

for (const occupied of [false, true]) {
  test(`cancel while preparation acknowledgement is pending (${occupied ? "other owner" : "own artifact"})`, async ({ page, baseURL }) => {
    const owner = await connect(baseURL!);
    const ownerId = randomUUID();
    let held: string | Buffer | undefined;
    let forward!: (message: string | Buffer) => void;
    const commands: EngineCommand[] = [];
    await page.routeWebSocket("**/control", (route) => {
      const server = route.connectToServer();
      let prepareId: string | undefined;
      forward = (message) => route.send(message);
      route.onMessage((raw) => {
        const envelope = JSON.parse(String(raw));
        commands.push(envelope.command);
        if (envelope.command.type === "prepare-loop-export") prepareId = envelope.commandId;
        server.send(raw);
      });
      server.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        if (message.type === "command-result" && message.commandId === prepareId) held = raw;
        else route.send(raw);
      });
    });
    try {
      if (occupied) await owner.command({ type: "prepare-loop-export", artifactId: ownerId, target: "sample", startBeat: 0 });
      const dialog = await openExport(page);
      await dialog.getByRole("button", { name: "Preview on host output", exact: true }).click();
      await expect.poll(() => held !== undefined).toBe(true);
      expect(JSON.parse(String(held)).accepted).toBe(!occupied);
      await expect(dialog.getByRole("button", { name: "Preview on host output", exact: true })).toBeDisabled();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect.poll(() => commands.some(({ type }) => type === "release-loop-export")).toBe(true);
      forward(held!);
      await expect(dialog).toHaveCount(0);
      expect(commands.map(({ type }) => type)).toEqual(["prepare-loop-export", "release-loop-export"]);
      if (occupied) {
        await owner.command({ type: "preview-loop-export", artifactId: ownerId, enabled: true });
        await owner.command({ type: "release-loop-export", artifactId: ownerId });
      }
      // A subsequent owner can prepare, proving cancellation did not leak the old artifact.
      const nextId = randomUUID();
      await owner.command({ type: "prepare-loop-export", artifactId: nextId, target: "sample", startBeat: 0 });
      await owner.command({ type: "release-loop-export", artifactId: nextId });
    } finally { owner.close(); }
  });
}
