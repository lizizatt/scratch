import { expect, test, type Page } from "@playwright/test";
import type { EngineCommand, EngineSnapshot } from "@alesis/protocol";

test("drum-mode pads expose every control and preserve independent sample-mode assignments", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/)).toBeVisible();
  await command(page, { type: "refresh-samples" });
  await command(page, { type: "set-pad-mode", mode: "drums" });
  await command(page, { type: "set-pad-navigation-target", target: "sample-pages" });
  await command(page, { type: "select-pad-program", program: 0 });
  await command(page, { type: "configure", settings: { countInEnabled: false } });
  await page.getByRole("button", { name: "Pads", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Edit pad/ })).toHaveCount(8);
  const active = (snapshot: EngineSnapshot, target: string) => target === "transport" ? snapshot.transport.state !== "stopped"
    : target === "drums" ? snapshot.drums.enabled : target === "metronome" ? snapshot.settings.metronomeEnabled : snapshot.arpeggiator.enabled;
  try {
    for (const target of ["transport", "drums", "metronome", "arpeggiator"] as const) {
      for (const operation of ["on", "off"] as const) {
        await page.getByRole("button", { name: "Edit pad 1", exact: true }).click();
        await page.getByLabel("Pad action", { exact: true }).selectOption("control");
        await page.getByLabel("Control", { exact: true }).selectOption(target);
        await page.getByLabel("On press", { exact: true }).selectOption(operation);
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        await page.getByRole("button", { name: /^Pad 1 — / }).click();
        await expect.poll(async () => active(await command(page), target)).toBe(operation === "on");
      }
    }
    await command(page, { type: "set-pad-mode", mode: "samples" });
    expect((await command(page)).pads.assignments.some((entry) => entry.mode === "samples" && entry.page === 0 && entry.pad === 0)).toBe(false);
    await command(page, { type: "set-pad-mode", mode: "drums" });
    await expect(page.getByRole("button", { name: "Pad 1 — Arpeggiator — Disable", exact: true })).toBeEnabled();
  } finally {
    await command(page, { type: "stop" });
    await command(page, { type: "configure-pad", mode: "drums", page: 0, pad: 0, action: null });
    await command(page, { type: "configure", settings: { countInEnabled: true, metronomeEnabled: true } });
  }
});

test("editor waits for acknowledgement, displays rejection, and keeps modal actions reachable", async ({ page }) => {
  let reply: ((accepted: boolean) => void) | undefined;
  await page.routeWebSocket("**/control", (socket) => {
    const host = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.command?.type === "configure-pad") {
        reply = (accepted) => socket.send(JSON.stringify({ type: "command-result", commandId: message.commandId, accepted, revision: 0, appliedCycle: 0, ...(accepted ? {} : { error: "Test storage unavailable" }) }));
      } else host.send(raw);
    });
  });
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/)).toBeVisible();
  await page.getByRole("button", { name: "Pads", exact: true }).click();
  const opener = page.getByRole("button", { name: "Edit pad 8", exact: true });
  await opener.click();
  await page.getByLabel("Pad action", { exact: true }).selectOption("control");
  const dialog = page.getByRole("dialog", { name: "Edit pad 8", exact: true });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.scrollIntoViewIfNeeded();
  const box = await save.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await save.click();
  await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  await expect(dialog).toBeVisible();
  await expect.poll(() => Boolean(reply)).toBe(true);
  reply!(false);
  await expect(dialog.getByRole("alert")).toHaveText("Test storage unavailable");
  await expect(save).toBeEnabled();
  reply = undefined;
  await save.click();
  await expect.poll(() => Boolean(reply)).toBe(true);
  reply!(true);
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

async function command(page: Page, command?: EngineCommand): Promise<EngineSnapshot> {
  return page.evaluate(async (command) => new Promise<EngineSnapshot>((resolve, reject) => {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/control`);
    let snapshot: EngineSnapshot;
    const id = crypto.randomUUID();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === "snapshot") {
        snapshot = message.snapshot;
        if (!command) { socket.close(); resolve(snapshot); }
      }
      if (message.type === "command-result" && message.commandId === id) {
        socket.close();
        if (message.accepted) resolve(snapshot); else reject(new Error(message.error));
      }
    };
    socket.onopen = () => { if (command) socket.send(JSON.stringify({ protocolVersion: 6, commandId: id, command })); };
    socket.onerror = () => reject(new Error("WebSocket failed"));
  }), command);
}

test("edits every pad, assigns a cross-page saved MP3, resets, and restores keyboard focus", async ({ page }) => {
  const sent: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => sent.push(String(payload))));
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/)).toBeVisible();
  await command(page, { type: "refresh-samples" });
  await command(page, { type: "set-pad-mode", mode: "samples" });
  await command(page, { type: "set-pad-navigation-target", target: "sample-pages" });
  await command(page, { type: "select-pad-program", program: 0 });
  await page.getByRole("button", { name: "Pads", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Edit pad/ })).toHaveCount(8);
  const editorButton = page.getByRole("button", { name: "Edit pad 1", exact: true });
  await editorButton.click();
  const dialog = page.getByRole("dialog", { name: "Edit pad 1", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Pad action", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(editorButton).toBeFocused();
  await editorButton.click();
  await page.getByLabel("Pad action", { exact: true }).selectOption("sample");
  const snapshot = await command(page);
  const sample = snapshot.pads.sampleCatalog[9]!;
  expect(sample).toBeTruthy();
  await page.getByLabel("Sample / saved loop MP3", { exact: true }).selectOption(sample.id);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  try {
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: `Pad 1 — ${sample.name}`, exact: true })).toBeEnabled();
    await page.reload();
    await page.getByRole("button", { name: "Pads", exact: true }).click();
    await expect(page.getByRole("button", { name: `Pad 1 — ${sample.name}`, exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Edit pad 1", exact: true }).click();
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect((await command(page)).pads.assignments).not.toContainEqual(expect.objectContaining({ mode: "samples", page: 0, pad: 0 }));
    expect(sent.some((frame) => frame.includes('"trigger-sample-pad"'))).toBe(false);
  } finally { await command(page, { type: "configure-pad", mode: "samples", page: 0, pad: 0, action: null }); }
});

test("blank pads expose controls, ordinary presses toggle once, and editing fits touch viewports", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/)).toBeVisible();
  await command(page, { type: "refresh-samples" });
  await command(page, { type: "set-pad-mode", mode: "samples" });
  await command(page, { type: "set-pad-navigation-target", target: "sample-pages" });
  await command(page, { type: "select-pad-program", program: 1 });
  await command(page, { type: "configure", settings: { metronomeEnabled: true } });
  await page.getByRole("button", { name: "Pads", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pad 8 — Empty slot", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Edit pad 8", exact: true }).click();
  await page.getByLabel("Pad action", { exact: true }).selectOption("control");
  await page.getByLabel("Control", { exact: true }).selectOption("metronome");
  await expect(page.getByLabel("On press").locator("option")).toHaveText(["Toggle mute / unmute", "Unmute", "Mute"]);
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  try {
    await expect(page.getByRole("dialog")).not.toBeVisible();
    const pad = page.getByRole("button", { name: "Pad 8 — Metronome — Toggle mute / unmute", exact: true });
    await pad.focus();
    await page.keyboard.down("Space");
    await page.keyboard.down("Space");
    await expect.poll(async () => (await command(page)).settings.metronomeEnabled).toBe(false);
    await page.keyboard.up("Space");
    expect((await command(page)).settings.metronomeEnabled).toBe(false);
    await pad.click();
    await expect.poll(async () => (await command(page)).settings.metronomeEnabled).toBe(true);
  } finally {
    await command(page, { type: "configure-pad", mode: "samples", page: 1, pad: 7, action: null });
    await command(page, { type: "select-pad-program", program: 0 });
  }
});