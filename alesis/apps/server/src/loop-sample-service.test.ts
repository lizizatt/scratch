import { describe, expect, it, vi } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import { createLoopSampleExportService, type LoopSampleCapture } from "./loop-sample-service.js";

function captureFixture(): LoopSampleCapture {
  const engine = new SimulatedHostEngine();
  const snapshot = engine.snapshot();
  snapshot.transport.state = "playing";
  snapshot.settings.loopMeasures = 1;
  snapshot.capture.staged = { id: "take-1", cycle: 0, level: 0.8, muted: false, waveform: [] };
  engine.dispose();
  return {
    snapshot,
    recordings: new Map([["take-1", [{ position: 0.25, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } }]]]),
  };
}

function dependencies(overrides: Partial<Parameters<typeof createLoopSampleExportService>[0]> = {}) {
  let revision = 7;
  return {
    capture: vi.fn(() => captureFixture()),
    render: vi.fn(async () => ({ filename: "New Loop.wav", path: "/private/sample-root/New Loop.wav", durationSeconds: 8 })),
    refreshSamples: vi.fn(async () => ({ accepted: true, revision: ++revision, appliedCycle: 2 })),
    sampleRoot: "/private/sample-root",
    resultState: vi.fn(() => ({ revision, appliedCycle: 2 })),
    ...overrides,
  };
}

describe("loop sample export service", () => {
  it("renders a defensive capture, refreshes after commit, and reports only the filename", async () => {
    const deps = dependencies();
    const service = createLoopSampleExportService(deps);
    const result = await service.execute("New Loop");

    expect(deps.capture).toHaveBeenCalledWith("New Loop");
    expect(deps.render).toHaveBeenCalledWith(expect.objectContaining({
      name: "New Loop",
      sampleRoot: "/private/sample-root",
      snapshot: expect.objectContaining({ capture: expect.objectContaining({ staged: { id: "take-1", cycle: 0, level: 0.8, muted: false, waveform: [] } }) }),
      recordings: new Map([["take-1", [{ position: 0.25, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } }]]]),
    }));
    expect(deps.refreshSamples).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ accepted: true, message: "Saved New Loop.wav to the sample library." });
    expect(JSON.stringify(result)).not.toContain("/private");
    expect(service.busy()).toBe(false);
  });

  it("allows a name-free export request", async () => {
    const deps = dependencies();
    const result = await createLoopSampleExportService(deps).execute();

    expect(deps.capture).toHaveBeenCalledWith(undefined);
    expect(deps.render).toHaveBeenCalledWith(expect.not.objectContaining({ name: expect.anything() }));
    expect(result).toMatchObject({ accepted: true, message: "Saved New Loop.wav to the sample library." });
  });

  it("keeps the captured state stable while rendering is in progress", async () => {
    const live = captureFixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = dependencies({
      capture: vi.fn(() => live),
      render: vi.fn(async (request) => {
        await gate;
        expect(request.snapshot.transport.state).toBe("playing");
        expect(request.recordings.get("take-1")?.[0]?.position).toBe(0.25);
        return { filename: "Stable.wav", path: "/private/Stable.wav", durationSeconds: 8 };
      }),
    });
    const service = createLoopSampleExportService(deps);
    const pending = service.execute("Stable");
    live.snapshot.transport.state = "stopped";
    live.recordings.get("take-1")![0]!.position = 0.75;
    release();

    expect((await pending).accepted).toBe(true);
  });

  it("rejects concurrent exports and releases busy state when rendering fails", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = dependencies({
      render: vi.fn(async () => {
        await gate;
        throw new Error("failed under /home/device/private");
      }),
    });
    const service = createLoopSampleExportService(deps);
    const pending = service.execute("First");

    expect(service.busy()).toBe(true);
    await expect(service.execute("Second")).resolves.toMatchObject({ accepted: false, error: "A loop sample export is already in progress" });
    expect(deps.capture).toHaveBeenCalledOnce();
    release();
    const failed = await pending;

    expect(failed).toMatchObject({ accepted: false, error: "Unable to export loop sample: failed under [local path]" });
    expect(deps.refreshSamples).not.toHaveBeenCalled();
    expect(service.busy()).toBe(false);
  });

  it("reports a separate refresh warning without misreporting a committed file as failed", async () => {
    const deps = dependencies({
      refreshSamples: vi.fn(async () => ({ accepted: false, revision: 8, appliedCycle: 2, error: "scan failed at /home/device/samples" })),
    });
    const result = await createLoopSampleExportService(deps).execute("Committed");

    expect(result).toMatchObject({
      accepted: true,
      message: "Saved New Loop.wav. Warning: the file exists, but the sample library could not be refreshed (scan failed at [local path]).",
    });
  });

  it("propagates a sanitized renderer warning while keeping the export successful", async () => {
    const deps = dependencies({
      render: vi.fn(async () => ({
        filename: "New Loop.wav",
        path: "/private/sample-root/New Loop.wav",
        durationSeconds: 8,
        warning: "Temporary cleanup failed under /private/sample-root/.staging",
      })),
    });

    await expect(createLoopSampleExportService(deps).execute("New Loop")).resolves.toMatchObject({
      accepted: true,
      message: "Saved New Loop.wav. Warning: Temporary cleanup failed under [local path].",
    });
    expect(deps.refreshSamples).toHaveBeenCalledOnce();
  });

  it("does not refresh the catalog when capture or rendering fails", async () => {
    const deps = dependencies({ capture: vi.fn(() => { throw new Error("not playing"); }) });
    const service = createLoopSampleExportService(deps);

    await expect(service.execute("Invalid")).resolves.toMatchObject({ accepted: false, error: "Unable to export loop sample: not playing" });
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.refreshSamples).not.toHaveBeenCalled();
    expect(service.busy()).toBe(false);
  });
});
