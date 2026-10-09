import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import { SamplePadService, type SampleDescriptor, type SampleLibraryLike, type SamplePlayerLike } from "./sample-pads.js";
import { disconnectSamplePlayer, DrumPadNoteTracker, executePadMode, executePadNavigation, executeSamplePadRelease, executeSamplePadTrigger, HardwareProgramChangeNavigationMapper } from "./pad-controls.js";
import { loadSettingsCache, restoreSettingsCache, saveSettingsCache, settingsCacheFromSnapshot } from "./settings-cache.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sampleLibrary(count = 17, failPage?: number): SampleLibraryLike {
  const descriptors = Array.from({ length: count }, (_, index) => ({
    id: `sample-${index}`,
    name: `Sample ${index}`,
    path: `/private/sample-${index}.wav`,
  }));
  return {
    descriptors,
    async scan() { return descriptors; },
    async loadPage(pageIndex) {
      if (pageIndex === failPage) throw new Error("decode failed");
      return Array.from({ length: 8 }, (_, pad) => {
        const descriptor = descriptors[pageIndex * 8 + pad];
        return descriptor ? { id: descriptor.id, name: descriptor.name, samples: new Float32Array([0, 1]) } : null;
      });
    },
  };
}

function samplesFor(engine: SimulatedHostEngine, library: SampleLibraryLike): SamplePadService {
  return new SamplePadService(library, (state) => {
    engine.setSamplePage(state.pageIndex, state.pageCount, state.page);
    engine.setSampleLibraryStatus(state.status, state.error);
  });
}

function navigationAudio() {
  return { selectSoundFontPreset: vi.fn(), selectDrumKit: vi.fn() };
}

function mockPlayer(): SamplePlayerLike {
  return {
    start: vi.fn(async () => {}),
    setPage() {},
    trigger() {},
    release: vi.fn(() => true),
    panic() {},
    close: vi.fn(async () => {}),
  };
}

function restoreExecutor(engine: SimulatedHostEngine, samplePads: SamplePadService, audio = navigationAudio()) {
  return (command: EngineCommand) => {
    if (command.type === "set-pad-mode") return executePadMode(command, { engine, samplePads, audio });
    if (command.type === "select-pad-program" || command.type === "step-pad-navigation") {
      return executePadNavigation(command, { engine, samplePads, audio });
    }
    return engine.execute(command);
  };
}

async function applyHardwareProgramChange(program: number, mapper: HardwareProgramChangeNavigationMapper, engine: SimulatedHostEngine, samplePads: SamplePadService, audio = navigationAudio()) {
  const mapped = mapper.commandForProgramChange(program, engine.snapshot());
  if (!mapped.command) return { mapped, result: null };
  const result = await executePadNavigation(mapped.command, { engine, samplePads, audio });
  return { mapped, result };
}

describe("pad host controls", () => {
  it("maps adjacent physical Program Change values to relative navigation across MIDI byte boundaries", async () => {
    const engine = new SimulatedHostEngine();
    const samplePads = samplesFor(engine, sampleLibrary(140 * 8));
    await samplePads.refresh();
    await engine.execute({ type: "set-pad-navigation-target", target: "sample-pages" });
    const mapper = new HardwareProgramChangeNavigationMapper();
    const audio = navigationAudio();

    for (const [program, expectedIndex, mode] of [
      [110, 110, "absolute"],
      [111, 111, "relative"],
      [112, 112, "relative"],
      [113, 113, "relative"],
      [127, 127, "absolute"],
      [0, 128, "relative"],
      [1, 129, "relative"],
      [0, 128, "relative"],
      [127, 127, "relative"],
    ] as const) {
      const { mapped, result } = await applyHardwareProgramChange(program, mapper, engine, samplePads, audio);
      expect(mapped.mode).toBe(mode);
      expect(result?.accepted).toBe(true);
      expect(engine.snapshot().pads.navigationIndex).toBe(expectedIndex);
      expect(engine.snapshot().pads.samplePageIndex).toBe(expectedIndex);
    }

    await samplePads.close();
    await engine.dispose();
  });

  it("ignores duplicate physical Program Change values and maps non-adjacent values modulo the current catalog", async () => {
    const engine = new SimulatedHostEngine({
      soundFontPresets: Array.from({ length: 113 }, (_, index) => ({ id: `voice-${index}`, bank: 0, program: index, name: `Voice ${index}` })),
      selectedSoundFontPresetId: "voice-0",
    });
    const samplePads = samplesFor(engine, sampleLibrary());
    const mapper = new HardwareProgramChangeNavigationMapper();
    const audio = navigationAudio();

    expect((await applyHardwareProgramChange(127, mapper, engine, samplePads, audio)).result?.accepted).toBe(true);
    expect(engine.snapshot().pads.navigationIndex).toBe(14);
    const duplicate = await applyHardwareProgramChange(127, mapper, engine, samplePads, audio);
    expect(duplicate.mapped).toMatchObject({ mode: "duplicate", command: null });
    expect(duplicate.result).toBeNull();
    expect(engine.snapshot().pads.navigationIndex).toBe(14);

    mapper.reset();
    const afterReset = await applyHardwareProgramChange(127, mapper, engine, samplePads, audio);
    expect(afterReset.mapped.mode).toBe("absolute");
    expect(afterReset.result?.accepted).toBe(true);
    expect(engine.snapshot().pads.navigationIndex).toBe(14);

    const nonAdjacent = await applyHardwareProgramChange(5, mapper, engine, samplePads, audio);
    expect(nonAdjacent.mapped.mode).toBe("absolute");
    expect(nonAdjacent.result?.accepted).toBe(true);
    expect(engine.snapshot().pads.navigationIndex).toBe(5);

    await samplePads.close();
    await engine.dispose();
  });

  it("resets physical Program Change adjacency when identical preset topology moves to a different SoundFont", async () => {
    const presets = Array.from({ length: 4 }, (_, index) => ({ id: `voice-${index}`, bank: 0, program: index, name: `Voice ${index}` }));
    const engine = new SimulatedHostEngine({
      soundFonts: [
        { id: "font-a", name: "Font A" },
        { id: "font-b", name: "Font B" },
      ],
      selectedSoundFontId: "font-a",
      soundFontPresets: presets,
      selectedSoundFontPresetId: "voice-0",
    });
    const samplePads = samplesFor(engine, sampleLibrary());
    const mapper = new HardwareProgramChangeNavigationMapper();
    const audio = navigationAudio();

    const firstFontSelection = await applyHardwareProgramChange(1, mapper, engine, samplePads, audio);
    expect(firstFontSelection.mapped.mode).toBe("absolute");
    expect(firstFontSelection.result?.accepted).toBe(true);
    expect(engine.snapshot().pads.navigationIndex).toBe(1);

    const switchResult = engine.replaceSoundFontSelection("font-b", presets, "voice-0");
    expect(switchResult.accepted).toBe(true);
    expect(engine.snapshot().pads).toMatchObject({ navigationTarget: "voices", navigationIndex: 0 });

    const firstSelectionInNewFont = await applyHardwareProgramChange(2, mapper, engine, samplePads, audio);
    expect(firstSelectionInNewFont.mapped.mode).toBe("absolute");
    expect(firstSelectionInNewFont.result?.accepted).toBe(true);
    expect(engine.snapshot().synth).toMatchObject({ selectedSoundFontId: "font-b", selectedSoundFontPresetId: "voice-2" });
    expect(engine.snapshot().pads.navigationIndex).toBe(2);

    await samplePads.close();
    await engine.dispose();
  });

  it("resets physical Program Change adjacency across drum kit, sample page, and empty catalogs", async () => {
    const engine = new SimulatedHostEngine({
      soundFontPresets: [
        { id: "voice-a", bank: 0, program: 0, name: "A" },
        { id: "voice-b", bank: 0, program: 1, name: "B" },
      ],
      selectedSoundFontPresetId: "voice-a",
      drumKits: [
        { id: "kit-a", bank: 128, program: 0, name: "A kit" },
        { id: "kit-b", bank: 128, program: 1, name: "B kit" },
        { id: "kit-c", bank: 128, program: 2, name: "C kit" },
      ],
    });
    const samplePads = samplesFor(engine, sampleLibrary(17));
    await samplePads.refresh();
    const mapper = new HardwareProgramChangeNavigationMapper();
    const audio = navigationAudio();

    expect((await applyHardwareProgramChange(1, mapper, engine, samplePads, audio)).mapped.mode).toBe("absolute");
    await engine.execute({ type: "set-pad-navigation-target", target: "drum-kits" });
    const firstKit = await applyHardwareProgramChange(2, mapper, engine, samplePads, audio);
    expect(firstKit.mapped.mode).toBe("absolute");
    expect(firstKit.result?.accepted).toBe(true);
    expect(engine.snapshot().pads.navigationIndex).toBe(2);
    const wrappedKit = await applyHardwareProgramChange(3, mapper, engine, samplePads, audio);
    expect(wrappedKit.mapped.mode).toBe("relative");
    expect(wrappedKit.result?.accepted).toBe(true);
    expect(engine.snapshot().pads.navigationIndex).toBe(0);

    await engine.execute({ type: "set-pad-navigation-target", target: "sample-pages" });
    const firstPage = await applyHardwareProgramChange(1, mapper, engine, samplePads, audio);
    expect(firstPage.mapped.mode).toBe("absolute");
    expect(firstPage.result?.accepted).toBe(true);
    expect(engine.snapshot().pads).toMatchObject({ navigationIndex: 1, samplePageIndex: 1 });

    await engine.execute({ type: "set-pad-navigation-target", target: "voices" });
    await engine.execute({ type: "select-soundfont-preset", presetId: "voice-b" });
    const afterFontTargetReset = await applyHardwareProgramChange(2, mapper, engine, samplePads, audio);
    expect(afterFontTargetReset.mapped.mode).toBe("absolute");
    expect(afterFontTargetReset.result?.accepted).toBe(true);
    expect(engine.snapshot().pads.navigationIndex).toBe(0);

    const emptyEngine = new SimulatedHostEngine();
    const emptyPads = samplesFor(emptyEngine, sampleLibrary());
    const empty = await applyHardwareProgramChange(64, new HardwareProgramChangeNavigationMapper(), emptyEngine, emptyPads, audio);
    expect(empty.mapped).toMatchObject({ mode: "empty" });
    expect(empty.result?.accepted).toBe(false);

    await emptyPads.close();
    await emptyEngine.dispose();
    await samplePads.close();
    await engine.dispose();
  });

  it("keeps loaded, displayed, persisted, and restored sample pages aligned for next and previous", async () => {
    const engine = new SimulatedHostEngine();
    const samplePads = samplesFor(engine, sampleLibrary());
    const audio = navigationAudio();
    await engine.execute({ type: "set-pad-navigation-target", target: "sample-pages" });
    expect((await samplePads.refresh()).accepted).toBe(true);

    const directory = await mkdtemp(join(tmpdir(), "alesis-pad-controls-"));
    temporaryDirectories.push(directory);
    const cachePath = join(directory, "settings.json");
    for (const [direction, expectedIndex, expectedSample] of [[1, 1, "sample-8"], [-1, 0, "sample-0"]] as const) {
      const result = await executePadNavigation({ type: "step-pad-navigation", direction }, { engine, samplePads, audio });
      expect(result.accepted).toBe(true);
      expect(engine.snapshot().pads).toMatchObject({ navigationIndex: expectedIndex, samplePageIndex: expectedIndex });
      expect(engine.snapshot().pads.samplePage[0]?.id).toBe(expectedSample);
      expect(samplePads.snapshot().pageIndex).toBe(expectedIndex);
      expect(samplePads.snapshot().page[0]?.id).toBe(expectedSample);

      await saveSettingsCache(cachePath, settingsCacheFromSnapshot(engine.snapshot()));
      const persisted = await loadSettingsCache(cachePath);
      expect(persisted?.pads).toMatchObject({ navigationTarget: "sample-pages", navigationIndex: expectedIndex, samplePageIndex: expectedIndex });

      const restoredEngine = new SimulatedHostEngine();
      const restoredPads = samplesFor(restoredEngine, sampleLibrary());
      await restoredPads.refresh();
      await restoreSettingsCache(persisted!, restoreExecutor(restoredEngine, restoredPads), () => restoredEngine.snapshot());
      expect(restoredEngine.snapshot().pads).toMatchObject({ navigationIndex: expectedIndex, samplePageIndex: expectedIndex });
      expect(restoredEngine.snapshot().pads.samplePage[0]?.id).toBe(expectedSample);
      expect(restoredPads.snapshot().pageIndex).toBe(expectedIndex);
      expect(restoredPads.snapshot().page[0]).toEqual({ id: expectedSample, name: `Sample ${expectedIndex * 8}`, pad: 0 });
      await restoredPads.close();
      await restoredEngine.dispose();
    }

    await samplePads.close();
    await engine.dispose();
  });

  it("rejects a failed decode while retaining the failed page as the coherent selected page", async () => {
    const engine = new SimulatedHostEngine();
    const samplePads = samplesFor(engine, sampleLibrary(17, 1));
    const audio = navigationAudio();
    await engine.execute({ type: "set-pad-navigation-target", target: "sample-pages" });
    await samplePads.refresh();

    const result = await executePadNavigation({ type: "step-pad-navigation", direction: 1 }, { engine, samplePads, audio });

    expect(result).toMatchObject({ accepted: false, error: "Unable to load sample page: decode failed" });
    expect(engine.snapshot().pads).toMatchObject({
      navigationIndex: 1,
      samplePageIndex: 1,
      sampleLibraryStatus: "error",
      sampleLibraryError: "decode failed",
      samplePage: Array(8).fill(null),
    });
    expect(samplePads.snapshot()).toMatchObject({ pageIndex: 1, status: "error", error: "decode failed" });
    expect(settingsCacheFromSnapshot(engine.snapshot()).pads).toMatchObject({ navigationIndex: 1, samplePageIndex: 1 });
    await samplePads.close();
    await engine.dispose();
  });

  it("applies voice and kit selections to both audio and engine state", async () => {
    const engine = new SimulatedHostEngine({
      soundFontPresets: [
        { id: "voice-a", bank: 4, program: 1, name: "Alpha" },
        { id: "voice-b", bank: 4, program: 9, name: "Beta" },
        { id: "voice-other", bank: 8, program: 0, name: "Other bank" },
      ],
      selectedSoundFontPresetId: "voice-a",
      drumKits: [
        { id: "kit-a", bank: 128, program: 1, name: "Alpha kit" },
        { id: "kit-b", bank: 128, program: 9, name: "Beta kit" },
      ],
    });
    const samplePads = samplesFor(engine, sampleLibrary());
    const audio = navigationAudio();

    expect((await executePadNavigation({ type: "step-pad-navigation", direction: 1 }, { engine, samplePads, audio })).accepted).toBe(true);
    expect(engine.snapshot().synth.selectedSoundFontPresetId).toBe("voice-b");
    expect(audio.selectSoundFontPreset).toHaveBeenCalledWith(4, 9);

    await engine.execute({ type: "set-pad-navigation-target", target: "drum-kits" });
    expect((await executePadNavigation({ type: "step-pad-navigation", direction: 1 }, { engine, samplePads, audio })).accepted).toBe(true);
    expect(engine.snapshot().pads.selectedDrumKitId).toBe("kit-b");
    expect(audio.selectDrumKit).toHaveBeenCalledWith(128, 9);
    await samplePads.close();
    await engine.dispose();
  });

  it("rejects browser sample triggers in drum mode and dispatches only in sample mode", async () => {
    const engine = new SimulatedHostEngine();
    const samplePads = { selectPage: vi.fn(async () => ({ accepted: true })), panic: vi.fn(), trigger: vi.fn(() => true), release: vi.fn(() => true) };
    const command = { type: "trigger-sample-pad", pad: 0, velocity: 100 } as const;

    expect(executeSamplePadTrigger(command, { engine, samplePads })).toMatchObject({ accepted: false, error: "Sample pads are only available in sample mode" });
    expect(samplePads.trigger).not.toHaveBeenCalled();
    await engine.execute({ type: "set-pad-mode", mode: "samples" });
    expect(executeSamplePadTrigger(command, { engine, samplePads }).accepted).toBe(true);
    expect(samplePads.trigger).toHaveBeenCalledWith(0, 100);
    expect(executeSamplePadRelease({ type: "release-sample-pad", pad: 0 }, { engine, samplePads }).accepted).toBe(true);
    expect(samplePads.release).toHaveBeenCalledWith(0);
    await engine.execute({ type: "set-pad-mode", mode: "drums" });
    expect(executeSamplePadRelease({ type: "release-sample-pad", pad: 0 }, { engine, samplePads })).toMatchObject({ accepted: false });
    await engine.dispose();
  });

  it("disconnects only the sample player and reuses the open library on reconnect", async () => {
    const baseLibrary = sampleLibrary(1);
    const closeLibrary = vi.fn(async () => {});
    const library: SampleLibraryLike = { ...baseLibrary, close: closeLibrary };
    const players = [mockPlayer(), mockPlayer()];
    let createdPlayers = 0;
    const service = new SamplePadService(library, () => {}, () => players[createdPlayers++] ?? null);

    expect((await service.refresh()).accepted).toBe(true);
    disconnectSamplePlayer(service);
    expect(players[0]!.close).toHaveBeenCalledOnce();
    expect(service.snapshot()).toMatchObject({ status: "error", error: "Audio device disconnected" });
    expect((await service.refresh()).accepted).toBe(true);
    expect(players[1]!.start).toHaveBeenCalledOnce();
    expect(service.snapshot().status).toBe("ready");
    expect(closeLibrary).not.toHaveBeenCalled();

    await service.close();
    expect(closeLibrary).toHaveBeenCalledOnce();
  });

  it("panics samples when leaving sample mode and releases held drum-pad notes when entering it", async () => {
    const engine = new SimulatedHostEngine();
    const samplePads = { selectPage: vi.fn(async () => ({ accepted: true })), panic: vi.fn(), trigger: vi.fn(() => true), release: vi.fn(() => true) };
    const audio = navigationAudio();
    await engine.execute({ type: "set-pad-mode", mode: "samples" });
    await executePadMode({ type: "set-pad-mode", mode: "drums" }, { engine, samplePads, audio });
    expect(samplePads.panic).toHaveBeenCalledOnce();

    const noteTracker = new DrumPadNoteTracker();
    noteTracker.observe({ type: "note-on", channel: 9, note: 38, velocity: 90 });
    const released: unknown[] = [];
    await executePadMode({ type: "set-pad-mode", mode: "samples" }, {
      engine,
      samplePads,
      audio,
      panicDrumNotes: () => noteTracker.panic((event) => released.push(event)),
    });
    expect(released).toEqual([{ type: "note-off", channel: 9, note: 38 }]);
    expect(engine.snapshot().pads.mode).toBe("samples");
  });
});
