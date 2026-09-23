import { describe, expect, it, vi } from "vitest";
import { SamplePadService, samplePadInput, type DecodedSample, type SampleDescriptor, type SampleLibraryLike, type SamplePlayerLike } from "./sample-pads.js";

function decoded(id: string, name = id): DecodedSample {
  return { id, name, samples: new Float32Array([0, 0.5]) };
}

function fixtureLibrary(count = 9): SampleLibraryLike {
  const descriptors: SampleDescriptor[] = Array.from({ length: count }, (_, index) => ({ id: `sample-${index}`, name: `Sample ${index}`, path: `/private/sample-${index}.wav` }));
  return {
    descriptors,
    async scan() { return descriptors; },
    async loadPage(pageIndex) {
      return Array.from({ length: 8 }, (_, pad) => {
        const index = pageIndex * 8 + pad;
        return descriptors[index] ? decoded(descriptors[index]!.id, descriptors[index]!.name) : null;
      });
    },
  };
}

function mockPlayer(): SamplePlayerLike & { starts: number; pages: number; hits: Array<[number, number]> } {
  return {
    starts: 0,
    pages: 0,
    hits: [],
    async start() { this.starts += 1; },
    setPage() { this.pages += 1; },
    trigger(pad, velocity) { this.hits.push([pad, velocity]); },
    panic: vi.fn(),
    close: vi.fn(async () => {}),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("sample pad service", () => {
  it("scans and decodes in simulated mode, publishes eight safe pad descriptors, and previews loaded pads", async () => {
    const states: Array<{ status: string; page: Array<{ id: string; name: string; pad: number } | null> }> = [];
    const library = fixtureLibrary();
    const service = new SamplePadService(library, (state) => states.push({ status: state.status, page: state.page }));

    expect((await service.refresh()).accepted).toBe(true);
    expect(service.snapshot()).toMatchObject({ status: "ready", pageCount: 2, page: [
      { id: "sample-0", name: "Sample 0", pad: 0 },
      { id: "sample-1", name: "Sample 1", pad: 1 },
      { id: "sample-2", name: "Sample 2", pad: 2 },
      { id: "sample-3", name: "Sample 3", pad: 3 },
      { id: "sample-4", name: "Sample 4", pad: 4 },
      { id: "sample-5", name: "Sample 5", pad: 5 },
      { id: "sample-6", name: "Sample 6", pad: 6 },
      { id: "sample-7", name: "Sample 7", pad: 7 },
    ] });
    expect(service.snapshot().page.join(" ")).not.toContain("/private");
    expect(service.trigger(3, 127)).toBe(true);
    expect(service.trigger(7, 100)).toBe(true);
    expect(service.trigger(8, 100)).toBe(false);
    expect((await service.selectPage(1)).accepted).toBe(true);
    expect(service.snapshot().page).toEqual([
      { id: "sample-8", name: "Sample 8", pad: 0 }, null, null, null, null, null, null, null,
    ]);
    expect(states.some(({ status }) => status === "loading")).toBe(true);
  });

  it("starts and updates an optional player only after a decoded page is ready", async () => {
    const player = mockPlayer();
    const service = new SamplePadService(fixtureLibrary(1), () => {}, () => player);

    expect((await service.refresh()).accepted).toBe(true);
    expect(player).toMatchObject({ starts: 1, pages: 1 });
    expect(service.trigger(0, 64)).toBe(true);
    expect(player.hits).toEqual([[0, 64]]);
    await service.selectPage(0);
    expect(player.starts).toBe(1);
    expect(player.pages).toBe(2);
  });

  it("can create its player on a later refresh after audio becomes available", async () => {
    const player = mockPlayer();
    let audioAvailable = false;
    const service = new SamplePadService(fixtureLibrary(1), () => {}, () => audioAvailable ? player : null);

    expect((await service.refresh()).accepted).toBe(true);
    expect(player.starts).toBe(0);
    audioAvailable = true;
    expect((await service.refresh()).accepted).toBe(true);
    expect(player.starts).toBe(1);
    expect(service.trigger(0, 100)).toBe(true);
    expect(player.hits).toEqual([[0, 100]]);
  });

  it("keeps failures visible without throwing and ignores stale scan results", async () => {
    const firstScanStarted = deferred<void>();
    const firstScan = deferred<SampleDescriptor[]>();
    let scans = 0;
    const descriptors = [{ id: "new", name: "New", path: "/hidden/new.wav" }];
    const library: SampleLibraryLike = {
      descriptors,
      scan() {
        scans += 1;
        if (scans === 1) {
          firstScanStarted.resolve();
          return firstScan.promise;
        }
        return Promise.resolve(descriptors);
      },
      async loadPage() { return [decoded("new"), null, null, null, null, null, null, null]; },
    };
    const service = new SamplePadService(library, () => {});
    const stale = service.refresh();
    await firstScanStarted.promise;
    const current = service.refresh();
    firstScan.resolve([{ id: "old", name: "Old", path: "/hidden/old.wav" }]);
    expect(await stale).toMatchObject({ accepted: false });
    expect((await current).accepted).toBe(true);
    expect(service.snapshot().page[0]?.id).toBe("new");

    const failure = new SamplePadService({ ...library, async scan() { throw new Error("permission denied"); } }, () => {});
    expect(await failure.refresh()).toMatchObject({ accepted: false, error: "Unable to refresh samples: permission denied" });
    expect(failure.snapshot()).toMatchObject({ status: "error", error: "permission denied" });
  });

  it("serializes overlapping scans so a stale completion cannot replace the active library catalog", async () => {
    const firstScanStarted = deferred<void>();
    const firstScan = deferred<SampleDescriptor[]>();
    let scans = 0;
    let currentDescriptors: SampleDescriptor[] = [];
    const library: SampleLibraryLike = {
      get descriptors() { return currentDescriptors; },
      scan() {
        scans += 1;
        if (scans === 1) {
          firstScanStarted.resolve();
          return firstScan.promise.then((descriptors) => {
            currentDescriptors = descriptors;
            return descriptors;
          });
        }
        currentDescriptors = Array.from({ length: 9 }, (_, index) => ({ id: `new-${index}`, name: `New ${index}`, path: `/private/new-${index}.mp3` }));
        return Promise.resolve(currentDescriptors);
      },
      async loadPage(pageIndex) {
        return Array.from({ length: 8 }, (_, pad) => {
          const descriptor = currentDescriptors[pageIndex * 8 + pad];
          return descriptor ? decoded(descriptor.id, descriptor.name) : null;
        });
      },
    };
    const service = new SamplePadService(library, () => {});
    const staleRefresh = service.refresh();
    const currentRefresh = service.refresh();

    await firstScanStarted.promise;
    expect(scans).toBe(1);
    expect(await service.selectPage(0)).toMatchObject({ accepted: false, error: "Sample library is refreshing" });
    firstScan.resolve([{ id: "old", name: "Old", path: "/private/old.mp3" }]);
    expect(await staleRefresh).toMatchObject({ accepted: false });
    expect((await currentRefresh).accepted).toBe(true);
    expect((await service.selectPage(1)).accepted).toBe(true);
    expect(service.snapshot().page[0]).toMatchObject({ id: "new-8", name: "New 8" });
  });

  it("panics the current page immediately when selecting another page", async () => {
    const player = mockPlayer();
    const pageLoadStarted = deferred<void>();
    const pageLoad = deferred<Array<DecodedSample | null>>();
    const library = fixtureLibrary();
    let loads = 0;
    const delayedLibrary: SampleLibraryLike = {
      ...library,
      async loadPage(pageIndex) {
        loads += 1;
        if (loads === 2) {
          pageLoadStarted.resolve();
          return pageLoad.promise;
        }
        return library.loadPage(pageIndex);
      },
    };
    const service = new SamplePadService(delayedLibrary, () => {}, () => player);
    await service.refresh();

    const selection = service.selectPage(1);
    expect(player.panic).toHaveBeenCalledTimes(1);
    await pageLoadStarted.promise;
    expect(service.trigger(0, 100)).toBe(false);
    pageLoad.resolve([decoded("next"), null, null, null, null, null, null, null]);
    expect((await selection).accepted).toBe(true);
  });

  it("ignores a decoded page after close and closes the library", async () => {
    const loadStarted = deferred<void>();
    const pageLoad = deferred<Array<DecodedSample | null>>();
    const close = vi.fn(async () => {});
    const player = mockPlayer();
    const states: string[] = [];
    const library: SampleLibraryLike = {
      descriptors: [{ id: "sample", name: "Sample", path: "/sample.wav" }],
      async scan() { return this.descriptors as SampleDescriptor[]; },
      loadPage() {
        loadStarted.resolve();
        return pageLoad.promise;
      },
      close,
    };
    const service = new SamplePadService(library, (state) => states.push(state.status), () => player);
    const refresh = service.refresh();
    await loadStarted.promise;
    await service.close();
    pageLoad.resolve([decoded("sample"), null, null, null, null, null, null, null]);

    expect(await refresh).toMatchObject({ accepted: false });
    expect(close).toHaveBeenCalledTimes(1);
    expect(player.starts).toBe(0);
    expect(states).not.toContain("ready");
    expect(await service.refresh()).toMatchObject({ accepted: false, error: "Sample service is closed" });
  });

  it("does not publish ready or restart audio when closed during player startup", async () => {
    const startStarted = deferred<void>();
    const finishStart = deferred<void>();
    const player = mockPlayer();
    player.start = vi.fn(async () => {
      player.starts += 1;
      startStarted.resolve();
      await finishStart.promise;
    });
    const states: string[] = [];
    const service = new SamplePadService(fixtureLibrary(1), (state) => states.push(state.status), () => player);
    const refresh = service.refresh();
    await startStarted.promise;

    await service.close();
    finishStart.resolve();
    expect(await refresh).toMatchObject({ accepted: false });
    expect(player).toMatchObject({ starts: 1 });
    expect(player.close).toHaveBeenCalledTimes(2);
    expect(states).not.toContain("ready");
    expect(await service.refresh()).toMatchObject({ accepted: false });
    expect(player.starts).toBe(1);
  });

  it("shares in-flight player startup across a superseding refresh", async () => {
    const startStarted = deferred<void>();
    const finishStart = deferred<void>();
    const player = mockPlayer();
    player.start = vi.fn(async () => {
      player.starts += 1;
      startStarted.resolve();
      await finishStart.promise;
    });
    const service = new SamplePadService(fixtureLibrary(1), () => {}, () => player);
    const stale = service.refresh();
    await startStarted.promise;
    const current = service.refresh();
    finishStart.resolve();

    expect(await stale).toMatchObject({ accepted: false });
    expect((await current).accepted).toBe(true);
    expect(player.starts).toBe(1);
    expect(player.pages).toBe(2);
  });

  it("closes the player when playback reports an error", async () => {
    const player = mockPlayer();
    const service = new SamplePadService(fixtureLibrary(1), () => {}, () => player);
    await service.refresh();

    service.reportPlaybackError("audio device disconnected");

    expect(service.snapshot()).toMatchObject({ status: "error", error: "audio device disconnected" });
    expect(player.close).toHaveBeenCalledTimes(1);
  });
});

describe("sample pad MIDI matching", () => {
  it("consumes only channel 10 notes 36 through 43 and triggers only positive note-ons", () => {
    expect(samplePadInput({ type: "note-on", channel: 9, note: 36, velocity: 90 })).toEqual({ consumed: true, pad: 0, velocity: 90 });
    expect(samplePadInput({ type: "note-off", channel: 9, note: 43 })).toEqual({ consumed: true });
    expect(samplePadInput({ type: "note-on", channel: 9, note: 43, velocity: 0 })).toEqual({ consumed: true });
    expect(samplePadInput({ type: "note-on", channel: 8, note: 36, velocity: 90 })).toEqual({ consumed: false });
    expect(samplePadInput({ type: "note-on", channel: 9, note: 44, velocity: 90 })).toEqual({ consumed: false });
    expect(samplePadInput({ type: "pitch-bend", channel: 9 })).toEqual({ consumed: false });
  });
});
