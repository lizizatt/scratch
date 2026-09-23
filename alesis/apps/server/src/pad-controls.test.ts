import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import { SamplePadService, type SampleDescriptor, type SampleLibraryLike, type SamplePlayerLike } from "./sample-pads.js";
import { disconnectSamplePlayer, DrumPadNoteTracker, executePadMode, executePadNavigation, executeSamplePadTrigger } from "./pad-controls.js";
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

describe("pad host controls", () => {
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
    const samplePads = { selectPage: vi.fn(async () => ({ accepted: true })), panic: vi.fn(), trigger: vi.fn(() => true) };
    const command = { type: "trigger-sample-pad", pad: 0, velocity: 100 } as const;

    expect(executeSamplePadTrigger(command, { engine, samplePads })).toMatchObject({ accepted: false, error: "Sample pads are only available in sample mode" });
    expect(samplePads.trigger).not.toHaveBeenCalled();
    await engine.execute({ type: "set-pad-mode", mode: "samples" });
    expect(executeSamplePadTrigger(command, { engine, samplePads }).accepted).toBe(true);
    expect(samplePads.trigger).toHaveBeenCalledWith(0, 100);
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
    const samplePads = { selectPage: vi.fn(async () => ({ accepted: true })), panic: vi.fn(), trigger: vi.fn(() => true) };
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
