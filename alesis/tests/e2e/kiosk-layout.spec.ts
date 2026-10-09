import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { PROTOCOL_VERSION, type EngineCommand, type EngineSnapshot, type LoopSession } from "../../packages/protocol/src/index.js";

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

async function scrollPane(page: Page, pane: Locator, toBottom = true) {
  // Options loads Space Mono only after that pane is mounted.
  await page.evaluate(() => document.fonts.ready);
  const box = (await pane.boundingBox())!;
  if (test.info().project.name === "alesis-kiosk") {
    const cdp = await page.context().newCDPSession(page);
    try {
      for (let swipe = 0; swipe < 10; swipe++) {
        const reached = await pane.evaluate((element, bottom) => bottom
          ? element.scrollTop + element.clientHeight >= element.scrollHeight - 2
          : element.scrollTop <= 1, toBottom);
        if (reached) break;
        const x = box.x + box.width - 20;
        const start = box.y + (toBottom ? box.height - 30 : 30);
        const end = box.y + (toBottom ? 30 : box.height - 30);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: start }] });
        for (let step = 1; step <= 12; step++) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove", touchPoints: [{ x, y: start + (end - start) * step / 12 }],
          });
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
    } finally { await cdp.detach(); }
  } else {
    await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2);
    await page.mouse.wheel(0, toBottom ? 4000 : -4000);
  }
  await expect.poll(() => pane.evaluate((element, bottom) => bottom
    ? element.scrollTop + element.clientHeight >= element.scrollHeight - 2
    : element.scrollTop <= 1, toBottom)).toBe(true);
}

async function expectReachable(pane: Locator, element: Locator) {
  const bounds = (await pane.boundingBox())!;
  const target = (await element.boundingBox())!;
  expect(target.y).toBeGreaterThanOrEqual(bounds.y);
  expect(target.y + target.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
  expect(target.x).toBeGreaterThanOrEqual(bounds.x);
  expect(target.x + target.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  const nav = (await element.page().getByRole("navigation", { name: "Application sections" }).boundingBox())!;
  expect(target.y + target.height).toBeLessThanOrEqual(nav.y);
  expect(await element.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
}

test("scrolls the full looper and every settings pane without hiding navigation", async ({ page, baseURL }) => {
  const original = await control(baseURL!);
  try {
    await control(baseURL!, { type: "stop" });
    const snapshot = await control(baseURL!, { type: "select-synth", synthId: "subtractive" });
    const { midiInputId: _midi, audioOutputId: _audio, ...settings } = snapshot.settings;
    const font = snapshot.synth.soundFonts.find(({ id }) => id === snapshot.synth.selectedSoundFontId)!;
    const preset = snapshot.synth.soundFontPresets.find(({ id }) => id === snapshot.synth.selectedSoundFontPresetId)!;
    const session: LoopSession = {
      format: "alesis-loop-session", version: 1, settings,
      synth: { selectedId: "subtractive", parameterValues: snapshot.synth.parameterValues, soundFont: { ...font, preset } },
      percussion: null, drums: { ...snapshot.drums, enabled: false }, arpeggiator: { ...snapshot.arpeggiator, enabled: false },
      monitorOnly: false, stagedAudible: true, quantization: "off", staged: null, previousStaged: null,
      promoted: Array.from({ length: 12 }, (_, index) => ({
        take: { id: `layout-${index}`, cycle: 0, level: 0.8, muted: false, waveform: [0, 0.5, 0] },
        recording: [
          { position: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
          { position: 0.5, event: { type: "note-off", channel: 0, note: 60 } },
        ],
      })),
    };
    await control(baseURL!, { type: "import-loop-session", sessionJson: JSON.stringify(session) });
    await page.goto("/");
    await expect(page.getByText(/connected \/\/ rev/i)).toBeVisible();
    // Late webfont metrics can change the scroll extent after the single wheel gesture.
    await page.evaluate(() => document.fonts.ready);
    const pane = page.getByRole("region", { name: "Looper", exact: true });
    await expectReachable(pane, page.getByRole("button", { name: "Load loop session", exact: true }));
    await expect.poll(() => pane.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await scrollPane(page, pane);
    await expectReachable(pane, page.getByRole("button", { name: "Delete take 12", exact: true }));
    await page.getByRole("button", { name: "Delete take 12", exact: true }).click();
    await scrollPane(page, pane);
    await expectReachable(pane, page.getByRole("button", { name: "Undo delete", exact: true }));
    await page.getByRole("button", { name: "Undo delete", exact: true }).click();
    await expect(page.locator(".take-row")).toHaveCount(12);
    await scrollPane(page, pane, false);
    await expectReachable(pane, page.getByRole("button", { name: "Load loop session", exact: true }));
    for (const section of ["Options", "Synth", "Pads", "Loops"]) {
      await expect(page.getByRole("button", { name: section, exact: true })).toBeInViewport();
    }

    await page.getByRole("button", { name: "Options", exact: true }).click();
    const options = page.getByRole("region", { name: "Options", exact: true });
    await expectReachable(options, page.getByLabel("BPM", { exact: true }));
    await scrollPane(page, options);
    await expectReachable(options, options.locator("input, select").last());

    await page.getByRole("button", { name: "Synth", exact: true }).click();
    await page.getByText("Arpeggiator", { exact: true }).click();
    await page.getByText("Drums", { exact: true }).click();
    const synth = page.locator(".synth-pane");
    await scrollPane(page, synth);
    await expectReachable(synth, page.getByLabel("Drum volume", { exact: true }));

    await page.getByRole("button", { name: "Pads", exact: true }).click();
    await page.locator(".pad-help summary").click();
    const pads = page.locator(".pads-pane");
    await scrollPane(page, pads);
    await expectReachable(pads, page.locator(".pad-help p").last());
    for (const name of ["Options", "Synth", "Pads", "Loops"]) {
      await page.getByRole("button", { name, exact: true }).click();
      const current = page.locator(".pane");
      expect(await current.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      const bounds = (await current.boundingBox())!;
      expect(bounds.y + bounds.height).toBe(page.viewportSize()!.height);
      const nav = page.getByRole("navigation", { name: "Application sections" });
      expect(await nav.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
      expect(await nav.evaluate((element) => {
        const first = element.querySelector("button")!.getBoundingClientRect();
        return document.elementFromPoint(first.right + 4, first.y + first.height / 2)?.closest("nav") === null;
      })).toBe(true);
    }
  } finally {
    await control(baseURL!, { type: "stop" });
    await control(baseURL!, { type: "configure", settings: { bpm: original.settings.bpm === 30 ? 31 : 30 }, clearAudio: true });
    await control(baseURL!, { type: "configure", settings: original.settings, clearAudio: true });
    await control(baseURL!, { type: "select-synth", synthId: original.synth.selectedId });
    await control(baseURL!, { type: "configure-arpeggiator", settings: original.arpeggiator });
    await control(baseURL!, { type: "configure-drums", settings: original.drums });
  }
});
