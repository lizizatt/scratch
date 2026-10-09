import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import WebSocket from "ws";
import { serverMessageSchema, type EngineCommand, type ServerMessage } from "../../packages/protocol/src/index.js";

type SnapshotMessage = Extract<ServerMessage, { type: "snapshot" }>;

// Read capabilities from the isolated test host; replay UI states without sending it commands.
async function fixture(page: Page, baseURL: string, takes = 2, samples = 256) {
  const message = await new Promise<SnapshotMessage>((resolve, reject) => {
    const socket = new WebSocket(`${baseURL.replace("http", "ws")}/control`);
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("Snapshot timeout")); }, 10_000);
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
    socket.on("message", (raw) => {
      const parsed = serverMessageSchema.parse(JSON.parse(String(raw)));
      if (parsed.type === "snapshot") { clearTimeout(timer); socket.close(); resolve(parsed); }
    });
  });
  const snapshot = message.snapshot;
  snapshot.transport = { state: "stopped", cycle: 0, progress: 0.35 };
  snapshot.settings = { ...snapshot.settings, bpm: 120, beatsPerMeasure: 4, loopMeasures: 4 };
  snapshot.monitorOnly = false;
  snapshot.drums.enabled = false;
  snapshot.arpeggiator.mode = "up-to-root-then-down";
  snapshot.synth.selectedId = "soundfont";
  // Actual installed Miku asset/preset labels, also usable on CI without that optional asset.
  snapshot.synth.soundFonts = [{ id: "hatsune-miku-fnf-sustain-sf2", name: "Hatsune Miku FNF Sustain" }];
  snapshot.synth.selectedSoundFontId = snapshot.synth.soundFonts[0]!.id;
  snapshot.synth.soundFontPresets = [{ id: "0:0", bank: 0, program: 0, name: "Miku Sustain" }];
  snapshot.synth.selectedSoundFontPresetId = "0:0";
  for (const control of snapshot.synth.instruments.find(({ id }) => id === "soundfont")!.controls) {
    snapshot.synth.parameterValues[control.id] = control.defaultValue;
  }
  const waveform = Array.from({ length: samples }, (_, i) => 0.2 + 0.7 * Math.abs(Math.sin(i * 0.3)));
  const take = { id: "visual-staged", cycle: 1, level: 0.8, muted: false, waveform };
  snapshot.capture = { ...snapshot.capture, currentWaveform: waveform, hasCurrentEvents: samples > 0,
    staged: samples ? take : null, previousStaged: samples ? { ...take, id: "visual-previous" } : null };
  snapshot.promoted = Array.from({ length: takes }, (_, i) => ({ ...take, id: `visual-${i}` }));
  snapshot.canUndoDelete = false;
  let route: WebSocketRoute;
  let onCommand = (_command: EngineCommand, _commandId: string) => {};
  const publish = () => route.send(JSON.stringify(serverMessageSchema.parse(message)));
  await page.routeWebSocket("**/control", (socket) => {
    route = socket;
    publish();
    socket.onMessage((raw) => {
      const { command, commandId } = JSON.parse(String(raw));
      onCommand(command, commandId);
    });
  });
  await page.goto("/");
  await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { snapshot, message, publish,
    handle: (handler: typeof onCommand) => { onCommand = handler; },
    result: (commandId: string, result: { accepted: boolean; message?: string; error?: string }) => {
      route.send(JSON.stringify(serverMessageSchema.parse({ type: "command-result", commandId, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle, ...result })));
    },
  };
}

async function evidence(page: Page, name: string) {
  const directory = join("artifacts", "ui-qa", process.env.UI_QA_PHASE ?? "current");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${test.info().project.name}-${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: "image/png" });
}

async function hitTarget(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  expect.soft(await target.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return [0.15, 0.5, 0.85].every((fraction) => node.contains(document.elementFromPoint(r.x + r.width * fraction, r.y + r.height / 2)));
  }), `${await target.getAttribute("aria-label")} unobscured hit targets`).toBe(true);
}

async function containedChildren(page: Page) {
  const clipped = await page.locator(".pane").evaluate((pane) => {
    const p = pane.getBoundingClientRect();
    return [...pane.querySelectorAll<HTMLElement>("button, input:not([hidden]), select, .parameter > span, .waveform, summary")]
      .filter((node) => node.getClientRects().length && !node.closest("dialog:not([open])"))
      .filter((node) => { const r = node.getBoundingClientRect(); return r.left < p.left || r.right > p.right + 1; })
      .map((node) => node.getAttribute("aria-label") ?? node.textContent);
  });
  expect.soft(clipped, "children fit horizontally, not just pane.scrollWidth").toEqual([]);
}

async function readableSelection(select: Locator) {
  const metrics = await select.evaluate((node: HTMLSelectElement) => {
    const style = getComputedStyle(node);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = style.font;
    // Reserve the native dropdown arrow as well as CSS padding.
    return { text: node.selectedOptions[0]!.text, font: parseFloat(style.fontSize),
      needed: context.measureText(node.selectedOptions[0]!.text).width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 24,
      width: node.getBoundingClientRect().width };
  });
  expect.soft(metrics.font, `${metrics.text} font`).toBeGreaterThanOrEqual(12);
  expect.soft(metrics.width, `${metrics.text} fits including native arrow`).toBeGreaterThanOrEqual(metrics.needed);
}

for (const [takes, samples] of [[0, 0], [2, 3], [12, 256]]) {
  test(`bounded waveform rows with ${takes} takes and ${samples} samples`, async ({ page, baseURL }) => {
    await fixture(page, baseURL!, takes, samples);
    await evidence(page, `loops-${takes}-top`);
    for (const name of ["current-capture", "staged-capture", "previous-staged-capture"]) {
      const row = (await page.locator(`.${name}`).boundingBox())!;
      expect.soft(row.height, `${name} remains a lane, not a square SVG`).toBeLessThanOrEqual(page.viewportSize()!.height * 0.35);
      expect.soft(row.height).toBeGreaterThanOrEqual(54);
    }
    const staged = (await page.getByRole("button", { name: "Promote staged take", exact: true }).boundingBox())!;
    expect.soft(staged.y + staged.height, "staging visible without scrolling from initial view").toBeLessThan(page.viewportSize()!.height - 50);
    await containedChildren(page);
    if (takes) {
      await hitTarget(page.getByLabel(`Level take ${takes}`, { exact: true }));
      await hitTarget(page.getByRole("button", { name: `Delete take ${takes}`, exact: true }));
      await evidence(page, `loops-${takes}-bottom`);
    }
    const nav = page.getByRole("navigation");
    for (const button of await nav.getByRole("button").all()) await hitTarget(button);
    expect(await nav.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  });
}

test("named SoundFont selectors and expanded effect controls remain legible", async ({ page, baseURL }) => {
  await fixture(page, baseURL!);
  await page.getByRole("button", { name: "Synth", exact: true }).click();
  await evidence(page, "miku-selectors");
  for (const name of ["Synthesizer", "SoundFont", "SoundFont preset"]) await readableSelection(page.getByLabel(name, { exact: true }));
  for (const selector of [".effect-advanced summary", ".arpeggiator-controls summary", ".drum-controls summary"]) await page.locator(selector).click();
  await page.locator(".synth-pane").evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await evidence(page, "expanded-effects");
  await readableSelection(page.getByLabel("Drum pattern", { exact: true }));
  await readableSelection(page.getByLabel("Arpeggiator mode", { exact: true }));
  const drumWidth = (await page.locator(".drum-effect-grid").boundingBox())!.width;
  expect.soft((await page.getByLabel("Drum volume").boundingBox())!.width, "three drum controls use available width").toBeGreaterThan(drumWidth / 4);
  await containedChildren(page);
  for (const name of ["Drum volume", "Drum pattern", "Arpeggiator mode"]) await hitTarget(page.getByLabel(name, { exact: true }));
});

test("MP3 save panel is opaque and controls are usable", async ({ page, baseURL }) => {
  await fixture(page, baseURL!);
  await page.getByRole("button", { name: "Save promoted tracks as MP3 files", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save MP3 audio", exact: true });
  await evidence(page, "mp3-dialog");
  const background = await dialog.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect.soft(background, "waveforms must not show through the dialog").toMatch(/^rgb\(/);
  await hitTarget(dialog.getByLabel("Folder name"));
  await hitTarget(dialog.getByRole("button", { name: "Cancel", exact: true }));
  await hitTarget(dialog.getByRole("button", { name: "Save", exact: true }));
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("recording/export status and host errors do not cover controls", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  state.snapshot.transport = { state: "counting-in", cycle: 1234, progress: 0 };
  state.publish();
  let exportId = "";
  state.handle((command, id) => { if (command.type === "export-loop-sample") exportId = id; });
  await page.getByRole("button", { name: "Export loop to sample library", exact: true }).click();
  await evidence(page, "export-pending");
  const toolbar = await page.locator(".transport-controls, .transport-status, .export-actions").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  expect.soft(toolbar[0]!.right).toBeLessThanOrEqual(toolbar[1]!.left);
  expect.soft(toolbar[1]!.right).toBeLessThanOrEqual(toolbar[2]!.left);
  await hitTarget(page.getByRole("button", { name: "Stop", exact: true }));
  await hitTarget(page.getByRole("button", { name: "Promote staged take", exact: true }));
  state.result(exportId, { accepted: true, message: "Loop sample exported to sample library. Warning: refresh is still pending; check the Pads pane before retrying." });
  await expect(page.locator(".sample-export-feedback")).toContainText("Warning:");
  await evidence(page, "export-feedback");
  await hitTarget(page.getByRole("button", { name: "Delete take 2", exact: true }));
  state.handle((_command, id) => state.result(id, { accepted: false, error: "Audio output unavailable: reconnect the configured output device and retry. No recorded takes have been changed." }));
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".error-line")).toBeVisible();
  await evidence(page, "host-error");
  await hitTarget(page.getByRole("button", { name: "Save promoted tracks as MP3 files", exact: true }));
  await containedChildren(page);
});

test("session validation and replacement dialog fit without obscuring actions", async ({ page, baseURL }) => {
  const { snapshot } = await fixture(page, baseURL!);
  const input = page.getByLabel("Loop session JSON file");
  await input.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("not JSON") });
  await expect(page.locator(".session-feedback[role=alert]")).toBeVisible();
  await evidence(page, "session-error");
  await hitTarget(page.getByRole("button", { name: "Load loop session", exact: true }));
  const { midiInputId: _midi, audioOutputId: _audio, ...settings } = snapshot.settings;
  const session = {
    format: "alesis-loop-session", version: 1, settings,
    synth: { selectedId: snapshot.synth.selectedId, parameterValues: snapshot.synth.parameterValues,
      soundFont: { ...snapshot.synth.soundFonts[0], preset: snapshot.synth.soundFontPresets[0] } },
    percussion: null, drums: snapshot.drums, arpeggiator: snapshot.arpeggiator,
    monitorOnly: false, stagedAudible: true, quantization: "off", staged: null, previousStaged: null, promoted: [],
  };
  await input.setInputFiles({ name: `${"long-session-name-".repeat(12)}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(session)) });
  const dialog = page.getByRole("dialog", { name: "Replace completed takes?" });
  await expect(dialog).toBeVisible();
  await evidence(page, "session-dialog");
  expect.soft(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth), "long filename wraps within the dialog").toBe(true);
  await hitTarget(dialog.getByRole("button", { name: "Cancel", exact: true }));
  await hitTarget(dialog.getByRole("button", { name: "Replace completed takes", exact: true }));
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("every pane keeps child controls within the viewport and floating navigation reachable", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!, 0, 0);
  for (const section of ["Options", "Synth", "Pads", "Loops"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    if (section === "Pads") await page.locator(".pad-help summary").click();
    await containedChildren(page);
    await evidence(page, `${section.toLowerCase()}-pane-top`);
    await page.locator(".pane").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await evidence(page, `${section.toLowerCase()}-pane-bottom`);
    expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
    for (const button of await page.getByRole("navigation").getByRole("button").all()) await hitTarget(button);
  }
  state.snapshot.synth.selectedId = "subtractive";
  state.snapshot.synth.parameterValues = Object.fromEntries(state.snapshot.synth.instruments
    .find(({ id }) => id === "subtractive")!.controls.map((control) => [control.id, control.defaultValue]));
  state.publish();
  await page.getByRole("button", { name: "Synth", exact: true }).click();
  await expect(page.getByLabel("Synthesizer", { exact: true })).toHaveValue("subtractive");
  await containedChildren(page);
  await evidence(page, "neon-parameters");
});

test("readiness failures reserve space rather than covering selectors", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  state.message.readiness.audio = { ready: false, reason: "Configured audio output is unavailable; reconnect the device." };
  state.message.readiness.midi = { ready: false, reason: "MIDI receiver disconnected; reconnect the input device." };
  state.publish();
  await expect(page.locator(".readiness-line")).toBeVisible();
  for (const section of ["Loops", "Synth", "Options", "Pads"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    const pane = (await page.locator(".pane").boundingBox())!;
    const notice = (await page.locator(".readiness-line").boundingBox())!;
    expect.soft(notice.y + notice.height).toBeLessThanOrEqual(pane.y);
    await containedChildren(page);
    await evidence(page, `readiness-${section.toLowerCase()}`);
  }
});

test("connection telemetry stays outside scrolled controls", async ({ page, baseURL }) => {
  await fixture(page, baseURL!, 12);
  const pane = page.locator(".pane");
  await pane.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await evidence(page, "connection-scrolled");
  const bounds = (await pane.boundingBox())!;
  const connection = (await page.locator(".connection-line").boundingBox())!;
  expect(connection.y + connection.height, "telemetry cannot obscure a row as it scrolls past the top").toBeLessThanOrEqual(bounds.y);
});
