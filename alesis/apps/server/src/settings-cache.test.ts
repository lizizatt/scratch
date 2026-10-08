import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import { executePadMode, executePadNavigation } from "./pad-controls.js";
import { SamplePadService } from "./sample-pads.js";
import { loadSettingsCache, restoreSettingsCache, saveSettingsCache, settingsCacheFromSnapshot } from "./settings-cache.js";

function configuredEngine(): SimulatedHostEngine {
  return new SimulatedHostEngine({
    soundFonts: [{ id: "sth", name: "STH" }],
    selectedSoundFontId: "sth",
    soundFontPresets: [{ id: "3:27", bank: 3, program: 27, name: "Guitar" }],
    selectedSoundFontPresetId: "3:27",
  });
}

describe("settings cache", () => {
  it("boots legacy caches without resetting musical settings and persists the new velocity floor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alesis-velocity-settings-"));
    try {
      const path = join(directory, "settings.json");
      const source = configuredEngine();
      await source.execute({ type: "configure", settings: { bpm: 137, velocityCurve: "responsive", minimumVelocity: 72 } });
      await saveSettingsCache(path, settingsCacheFromSnapshot(source.snapshot()));
      const target = configuredEngine();
      await restoreSettingsCache((await loadSettingsCache(path))!, (command) => target.execute(command));
      expect(target.snapshot().settings).toMatchObject({ bpm: 137, velocityCurve: "responsive", minimumVelocity: 72 });
      const legacy = settingsCacheFromSnapshot(source.snapshot());
      delete (legacy.settings as Partial<typeof legacy.settings>).minimumVelocity;
      await writeFile(path, JSON.stringify(legacy));
      await restoreSettingsCache((await loadSettingsCache(path))!, (command) => target.execute(command));
      expect(target.snapshot().settings).toMatchObject({ bpm: 137, velocityCurve: "responsive", minimumVelocity: 1 });
      expect(target.snapshot().capture.overdub).toBe(false);
      expect(target.snapshot().transport.state).toBe("stopped");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("round-trips sparse assignments and restores missing assets without substituting or dropping settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alesis-pad-settings-"));
    try {
      const engine = configuredEngine();
      engine.setSampleCatalog([{ id: "saved-loop", name: "Loop 0001" }]);
      expect((await engine.execute({ type: "configure-pad", mode: "samples", page: 0, pad: 7, action: { kind: "sample", sampleId: "saved-loop" } })).accepted).toBe(true);
      expect((await engine.execute({ type: "configure-pad", mode: "drums", page: 0, pad: 0, action: { kind: "control", target: "transport", operation: "toggle" } })).accepted).toBe(true);
      const path = join(directory, "settings.json");
      await saveSettingsCache(path, settingsCacheFromSnapshot(engine.snapshot()));
      const saved = (await loadSettingsCache(path))!;
      const restarted = configuredEngine();
      restarted.restorePadAssignments(saved.pads.assignments);
      await restoreSettingsCache(saved, (command) => restarted.execute(command));
      expect(restarted.snapshot().pads.assignments).toEqual(engine.snapshot().pads.assignments);
      expect(restarted.snapshot().pads.sampleCatalog).toEqual([]);
      expect((await restarted.execute({ type: "configure-pad", mode: "samples", page: 0, pad: 7, action: null })).accepted).toBe(true);
      expect(restarted.snapshot().pads.assignments).toHaveLength(1);
      expect((await restarted.execute({ type: "configure-pad", mode: "samples", page: 0, pad: 0, action: { kind: "sample", sampleId: "unknown" } })).accepted).toBe(false);
      expect((await restarted.execute({ type: "configure-pad", mode: "samples", page: 1, pad: 0, action: null })).accepted).toBe(false);
      const legacy = settingsCacheFromSnapshot(engine.snapshot());
      delete (legacy.pads as Partial<typeof legacy.pads>).assignments;
      await writeFile(path, JSON.stringify(legacy));
      expect((await loadSettingsCache(path))?.pads.assignments).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("atomically saves and loads only persistent user settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alesis-settings-cache-"));
    const path = join(directory, "settings-v1.json");
    try {
      const engine = configuredEngine();
      await engine.execute({ type: "select-synth", synthId: "soundfont" });
      await engine.execute({ type: "configure", settings: { bpm: 137, metronomeEnabled: false } });
      await engine.execute({ type: "set-synth-parameter", parameterId: "reverb-send", value: 1 });
      await engine.execute({ type: "configure-arpeggiator", settings: { enabled: true, rate: "1/16" } });
      await engine.execute({ type: "configure-drums", settings: { enabled: true, pattern: "breakbeat" } });
      await engine.execute({ type: "set-quantization", mode: "1/32" });

      await saveSettingsCache(path, settingsCacheFromSnapshot(engine.snapshot()));
      const cache = await loadSettingsCache(path);

      expect(cache).toMatchObject({
        version: 1,
        settings: { bpm: 137, metronomeEnabled: false },
        synth: { selectedId: "soundfont", selectedSoundFontId: "sth", selectedSoundFontPresetId: "3:27", parameterValues: { "reverb-send": 1 } },
        arpeggiator: { enabled: true, rate: "1/16" },
        drums: { enabled: true, pattern: "breakbeat" },
        quantization: "1/32",
        pads: { mode: "drums", navigationTarget: "voices", navigationIndex: 0, selectedDrumKitId: null, samplePageIndex: 0 },
      });
      expect(JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"))).not.toHaveProperty("transport");
      expect(JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"))).not.toHaveProperty("promoted");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed and incompatible cache files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alesis-settings-cache-"));
    const path = join(directory, "settings-v1.json");
    try {
      await writeFile(path, "not json");
      expect(await loadSettingsCache(path)).toBeNull();
      await writeFile(path, JSON.stringify({ version: 2 }));
      expect(await loadSettingsCache(path)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("ignores retired chord settings while restoring the remaining v1 cache", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alesis-settings-cache-"));
    const path = join(directory, "settings-v1.json");
    try {
      const engine = configuredEngine();
      const cache = { ...settingsCacheFromSnapshot(engine.snapshot()), chord: { enabled: true, inversion: "second" } };
      await writeFile(path, JSON.stringify(cache));

      expect(await loadSettingsCache(path)).toEqual(settingsCacheFromSnapshot(engine.snapshot()));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("migrates a pre-pad v1 cache to non-destructive pad defaults", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alesis-settings-cache-"));
    const path = join(directory, "settings-v1.json");
    try {
      const legacy = settingsCacheFromSnapshot(configuredEngine().snapshot());
      delete (legacy as Partial<typeof legacy>).pads;
      await writeFile(path, JSON.stringify(legacy));

      expect((await loadSettingsCache(path)?.then((cache) => cache?.pads))).toEqual({
        mode: "drums", navigationTarget: "voices", navigationIndex: 0, selectedDrumKitId: null, samplePageIndex: 0,
        assignments: [],
      });
      expect(JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"))).not.toHaveProperty("pads");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("replays the cache through validated engine commands", async () => {
    const source = configuredEngine();
    await source.execute({ type: "select-synth", synthId: "soundfont" });
    await source.execute({ type: "configure", settings: { bpm: 151, velocityCurve: "fixed", countInEnabled: false } });
    await source.execute({ type: "set-synth-parameter", parameterId: "reverb-send", value: 0.8 });
    await source.execute({ type: "configure-arpeggiator", settings: { enabled: true, latch: true } });
    await source.execute({ type: "configure-drums", settings: { enabled: true, volume: 0.9 } });
    await source.execute({ type: "set-quantization", mode: "1/16" });
    const cache = settingsCacheFromSnapshot(source.snapshot());
    const target = configuredEngine();

    await restoreSettingsCache(cache, (command) => target.execute(command));

    expect(target.snapshot()).toMatchObject({
      settings: { bpm: 151, velocityCurve: "fixed", countInEnabled: false },
      synth: { selectedId: "soundfont", selectedSoundFontId: "sth", selectedSoundFontPresetId: "3:27", parameterValues: { "reverb-send": 0.8 } },
      arpeggiator: { enabled: true, latch: true },
      drums: { enabled: true, volume: 0.9 },
      capture: { quantization: "1/16" },
    });
  });

  it("restores the selected drum kit by id against the current kit catalog", async () => {
    const source = new SimulatedHostEngine({
      drumKits: [
        { id: "kit-a", bank: 128, program: 0, name: "A" },
        { id: "kit-b", bank: 128, program: 1, name: "B" },
      ],
    });
    await source.execute({ type: "set-pad-navigation-target", target: "drum-kits" });
    await source.execute({ type: "step-pad-navigation", direction: 1 });
    const cache = settingsCacheFromSnapshot(source.snapshot());
    const target = new SimulatedHostEngine({ drumKits: source.snapshot().pads.drumKits });

    await restoreSettingsCache(cache, (command) => target.execute(command), () => target.snapshot());

    expect(target.snapshot().pads).toMatchObject({ navigationTarget: "drum-kits", selectedDrumKitId: "kit-b", navigationIndex: 1 });
  });

  it("falls back to the cached drum-kit index when the selected kit is no longer installed", async () => {
    const source = new SimulatedHostEngine({
      drumKits: [
        { id: "old-a", bank: 128, program: 0, name: "A" },
        { id: "old-b", bank: 128, program: 1, name: "B" },
      ],
    });
    await source.execute({ type: "set-pad-navigation-target", target: "drum-kits" });
    await source.execute({ type: "step-pad-navigation", direction: 1 });
    const cache = settingsCacheFromSnapshot(source.snapshot());
    const target = new SimulatedHostEngine({ drumKits: [
      { id: "new-a", bank: 128, program: 0, name: "A" },
      { id: "new-b", bank: 128, program: 1, name: "B" },
    ] });

    await restoreSettingsCache(cache, (command) => target.execute(command), () => target.snapshot());

    expect(target.snapshot().pads).toMatchObject({ navigationTarget: "drum-kits", selectedDrumKitId: "new-b", navigationIndex: 1 });
  });

  it("restores the selected kit and sample page independently of the final navigation target", async () => {
    const options = {
      soundFonts: [{ id: "sth", name: "STH" }],
      selectedSoundFontId: "sth",
      soundFontPresets: [
        { id: "voice-a", bank: 4, program: 1, name: "Alpha" },
        { id: "voice-b", bank: 4, program: 9, name: "Beta" },
      ],
      selectedSoundFontPresetId: "voice-a",
      drumKits: [
        { id: "kit-a", bank: 128, program: 0, name: "A" },
        { id: "kit-b", bank: 128, program: 1, name: "B" },
      ],
    };
    const descriptors = Array.from({ length: 8 * 129 }, (_, index) => ({
      id: `sample-${index}`,
      name: `Sample ${index}`,
      path: `/sample-${index}.wav`,
    }));
    const makeSamplePads = (engine: SimulatedHostEngine) => new SamplePadService({
      descriptors,
      async scan() { return descriptors; },
      async loadPage(pageIndex) {
        return Array.from({ length: 8 }, (_, pad) => {
          const descriptor = descriptors[pageIndex * 8 + pad];
          return descriptor ? { id: descriptor.id, name: descriptor.name, samples: new Float32Array([0, 1]) } : null;
        });
      },
    }, (state) => engine.setSamplePage(state.pageIndex, state.pageCount, state.page));
    const makeExecutor = (engine: SimulatedHostEngine, samplePads: SamplePadService) => {
      const audio = { selectSoundFontPreset() {}, selectDrumKit() {} };
      return (command: EngineCommand) => {
        if (command.type === "set-pad-mode") return executePadMode(command, { engine, samplePads, audio });
        if (command.type === "select-pad-program" || command.type === "step-pad-navigation") {
          return executePadNavigation(command, { engine, samplePads, audio });
        }
        return engine.execute(command);
      };
    };
    const source = new SimulatedHostEngine(options);
    const sourcePads = makeSamplePads(source);
    const target = new SimulatedHostEngine(options);
    const targetPads = makeSamplePads(target);
    try {
      await sourcePads.refresh();
      await source.execute({ type: "set-pad-mode", mode: "samples" });
      await source.execute({ type: "set-pad-navigation-target", target: "drum-kits" });
      await source.execute({ type: "select-pad-program", program: 1 });
      await source.execute({ type: "set-pad-navigation-target", target: "sample-pages" });
      await executePadNavigation({ type: "select-pad-program", program: 128 }, {
        engine: source,
        samplePads: sourcePads,
        audio: { selectSoundFontPreset() {}, selectDrumKit() {} },
      });
      await source.execute({ type: "set-pad-navigation-target", target: "voices" });
      const cache = settingsCacheFromSnapshot(source.snapshot());

      await targetPads.refresh();
      await restoreSettingsCache(cache, makeExecutor(target, targetPads), () => target.snapshot());

      expect(target.snapshot().pads).toMatchObject({
        mode: "samples",
        navigationTarget: "voices",
        selectedDrumKitId: "kit-b",
        samplePageIndex: 128,
      });
      expect(target.snapshot().synth.selectedSoundFontPresetId).toBe("voice-a");
      expect(targetPads.snapshot().pageIndex).toBe(128);
    } finally {
      await Promise.all([sourcePads.close(), targetPads.close()]);
      await Promise.all([source.dispose(), target.dispose()]);
    }
  });
});
