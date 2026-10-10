import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SimulatedHostEngine } from "@alesis/engine";
import { SilentAudioOutput, SimulatedLoopOutput } from "@alesis/audio";
import { MidiLoopScheduler } from "./loop-playback.js";
import { LoopExports } from "./loop-export.js";
import type { LoopOutput } from "@alesis/audio";
import type { LoopExportStatus } from "@alesis/protocol";
import { renderLoopArtifact } from "./loop-render.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

it("freezes a captured loop, previews the final bytes and publishes those same bytes without changing musical state", async () => {
  const root = await mkdtemp(join(tmpdir(), "alesis-preview-test-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const engine = new SimulatedHostEngine();
  cleanup.push(() => engine.dispose());
  await engine.execute({ type: "configure", settings: { bpm: 240, loopMeasures: 1, countInEnabled: false } });
  await engine.execute({ type: "select-synth", synthId: "subtractive" });
  const loops = new MidiLoopScheduler(new SilentAudioOutput());
  await engine.execute({ type: "play" });
  loops.record({ type: "note-on", channel: 0, note: 60, velocity: 100 }, engine.snapshot());
  engine.advance(0.25);
  loops.record({ type: "note-off", channel: 0, note: 60 }, engine.snapshot());
  engine.advance(0.76);
  loops.update(engine.snapshot());
  await engine.execute({ type: "stop" });
  const before = engine.snapshot();
  const output = new SimulatedLoopOutput();
  const exports = new LoopExports({
    snapshot: () => engine.snapshot(),
    capture: () => ({ snapshot: engine.snapshot(), recordings: loops.captureRecordings(engine.snapshot(), [before.capture.staged!.id]) }),
    sampleRoot: root, outputRoot: join(root, "promoted"),
    output: () => output, enterPreview() {}, leavePreview() {},
    refreshSamples: async () => {},
  });
  cleanup.push(() => exports.close());
  const id = randomUUID();
  await exports.prepare("browser", { artifactId: id, target: "sample", startBeat: 0 });
  await exports.preview("browser", id, true);
  expect(exports.status().state).toBe("previewing");
  expect(output.frames(48_000 * 2)).toHaveLength(48_000 * 2 * 4);
  const previewBytes = output.encoded;
  const result = await exports.publish("browser", id);
  expect(await readFile(result.paths[0]!)).toEqual(previewBytes);
  expect(engine.snapshot()).toEqual(before);
  expect(exports.status().state).toBe("idle");
});

async function fixture(output: LoopOutput = new SimulatedLoopOutput()) {
  const root = await mkdtemp(join(tmpdir(), "alesis-export-safety-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const engine = new SimulatedHostEngine();
  cleanup.push(() => engine.dispose());
  await engine.execute({ type: "configure", settings: { bpm: 240, loopMeasures: 1, countInEnabled: false } });
  const snapshot = engine.snapshot();
  snapshot.synth.selectedId = "subtractive";
  snapshot.synth.parameterValues = { attack: 0.001, release: 0.01, cutoff: 6300 };
  snapshot.capture.staged = { id: "staged", cycle: 0, level: 1, muted: false, waveform: [0.2, 0.4] };
  const recording = [
    { position: 0.5, event: { type: "note-on" as const, channel: 0, note: 60, velocity: 100 } },
    { position: 0.6, event: { type: "note-off" as const, channel: 0, note: 60 } },
  ];
  const recipe = { snapshot, recordings: new Map([["staged", recording]]) };
  const enter = vi.fn();
  const leave = vi.fn();
  const service = new LoopExports({ snapshot: () => engine.snapshot(), capture: () => recipe, sampleRoot: root, outputRoot: join(root, "promoted"), output: () => output, enterPreview: enter, leavePreview: leave, refreshSamples: async () => {} });
  cleanup.push(() => service.close());
  return { root, engine, recipe, service, output, enter, leave, id: randomUUID() };
}

it("repeats decoded final frames contiguously across arbitrary buffer boundaries", async () => {
  const output = new SimulatedLoopOutput();
  await output.start(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), Buffer.from([9]), () => {});
  expect([...output.frames(3)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4]);
  expect([...output.frames(2)]).toEqual([5, 6, 7, 8, 1, 2, 3, 4]);
  await output.close();
  expect(output.frames(1)).toHaveLength(0);
});

it.each(["playing", "counting-in"] as const)("rejects preview while %s without stopping transport or acquiring output", async (state) => {
  const h = await fixture();
  await h.service.prepare("owner", { artifactId: h.id, target: "sample" });
  await h.engine.execute({ type: "configure", settings: { countInEnabled: state === "counting-in" } });
  await h.engine.execute({ type: "play" });
  await expect(h.service.preview("owner", h.id, true)).rejects.toThrow("Stop transport");
  expect(h.engine.snapshot().transport.state).toBe(state);
  expect(h.enter).not.toHaveBeenCalled();
  expect(h.service.blocksPerformance()).toBe(false);
});

it("retains exact default onset policy and nonzero legacy origin, while explicit Beat 1 keeps the whole cycle", async () => {
  const h = await fixture();
  const render = async (startBeat?: number) => {
    const artifact = await renderLoopArtifact(h.recipe, { target: "sample", startBeat }, new AbortController().signal);
    cleanup.push(() => artifact.release());
    return artifact;
  };
  const trimmed = await render();
  const explicit = await render(0);
  expect(trimmed.durationSeconds).toBeGreaterThan(0.49);
  expect(trimmed.durationSeconds).toBeLessThan(0.52);
  expect(explicit.durationSeconds).toBe(1);
  expect(explicit.pcm.subarray(0, 48_000 * 4 * 0.45).every((v) => v === 0)).toBe(true);
  h.recipe.snapshot.capture.loopStart = 0.375;
  const legacy = await render();
  expect(legacy.durationSeconds).toBe(1);
  const onset = (pcm: Buffer) => {
    for (let frame = 0; frame < pcm.length / 4; frame++) if (Math.abs(pcm.readInt16LE(frame * 4)) > 100) return frame / 48_000;
    return Infinity;
  };
  expect(onset(legacy.pcm)).toBeGreaterThan(0.12);
  expect(onset(legacy.pcm)).toBeLessThan(0.14);
  expect(h.recipe.snapshot.capture.loopStart).toBe(0.375);
});

it("bounds concurrent work and cancels a long render without accepting stale completion", async () => {
  const h = await fixture();
  h.recipe.snapshot.settings.bpm = 30;
  h.recipe.snapshot.settings.loopMeasures = 12;
  h.recipe.snapshot.promoted = [h.recipe.snapshot.capture.staged!];
  const states: LoopExportStatus["state"][] = [];
  h.service.subscribe(({ state }) => states.push(state));
  const pending = h.service.prepare("owner", { artifactId: h.id, target: "promoted" }).catch((error) => error);
  await expect(h.service.prepare("other", { artifactId: randomUUID(), target: "sample" })).rejects.toThrow("Another export");
  await h.service.cancel();
  expect(await pending).toBeInstanceOf(Error);
  expect(states).not.toContain("ready");
  expect(h.service.status().state).toBe("idle");
  expect(await readdir(h.root)).toEqual([]);
  await expect(h.service.publish("owner", h.id, "Canceled")).rejects.toThrow("unavailable");
});

it("cancels during warm-up before any retained cycle is rendered", async () => {
  const h = await fixture();
  h.recipe.snapshot.settings.bpm = 30;
  h.recipe.snapshot.settings.loopMeasures = 12;
  h.recipe.snapshot.promoted = [h.recipe.snapshot.capture.staged!];
  const controller = new AbortController();
  const rendering = renderLoopArtifact(h.recipe, { target: "promoted", startBeat: 0 }, controller.signal);
  const cancel = setTimeout(() => controller.abort(), 30);
  const started = performance.now();
  try {
    await expect(rendering).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(2000);
  } finally { clearTimeout(cancel); }
});

it("rejects an oversized multi-layer artifact before rendering or allocating PCM", async () => {
  const h = await fixture();
  h.recipe.snapshot.settings.bpm = 30;
  h.recipe.snapshot.settings.beatsPerMeasure = 16;
  h.recipe.snapshot.settings.loopMeasures = 30;
  h.recipe.snapshot.promoted = [h.recipe.snapshot.capture.staged!, { ...h.recipe.snapshot.capture.staged!, id: "other" }];
  h.recipe.recordings.set("other", h.recipe.recordings.get("staged")!);
  await expect(renderLoopArtifact(h.recipe, { target: "promoted", startBeat: 0 }, new AbortController().signal)).rejects.toThrow("256 MiB");
});

it("does not grant preview/publish/release ownership to another browser, and disconnect never resumes", async () => {
  const h = await fixture();
  await h.service.prepare("owner", { artifactId: h.id, target: "sample" });
  await expect(h.service.preview("other", h.id, true)).rejects.toThrow("another connection");
  await expect(h.service.publish("other", h.id)).rejects.toThrow("another connection");
  await expect(h.service.release("other", h.id)).rejects.toThrow("another connection");
  await h.service.preview("owner", h.id, true);
  expect(h.service.blocksPerformance()).toBe(true);
  await h.service.disconnect("other");
  expect(h.service.blocksPerformance()).toBe(true);
  await h.service.disconnect("owner");
  expect(h.service.blocksPerformance()).toBe(false);
  expect(h.leave).toHaveBeenCalledOnce();
  expect(h.engine.snapshot().transport.state).toBe("stopped");
  expect(h.service.status().state).toBe("idle");
});

it("cleans up and releases exclusive mode when the actual output adapter reports failure", async () => {
  let report: ((error: string) => void) | undefined;
  const output = new SimulatedLoopOutput();
  const start = output.start.bind(output);
  output.start = async (pcm, encoded, onError) => { report = onError; await start(pcm, encoded, onError); };
  const h = await fixture(output);
  await h.service.prepare("owner", { artifactId: h.id, target: "sample" });
  await h.service.preview("owner", h.id, true);
  report!("output disappeared");
  await vi.waitFor(() => expect(h.service.status()).toMatchObject({ state: "error", artifactId: null, error: "output disappeared" }));
  expect(output.frames(1)).toHaveLength(0);
  expect(h.service.blocksPerformance()).toBe(false);
  expect(h.engine.snapshot().transport.state).toBe("stopped");
});

it("publishes frozen promoted tracks including muted ones plus the previewed mix, not staged or drums", async () => {
  const output = new SimulatedLoopOutput();
  const h = await fixture(output);
  h.recipe.snapshot.promoted = [{ ...h.recipe.snapshot.capture.staged!, id: "muted", muted: true }];
  h.recipe.recordings.set("muted", structuredClone(h.recipe.recordings.get("staged")!));
  h.recipe.snapshot.drums.enabled = true;
  await h.service.prepare("owner", { artifactId: h.id, target: "promoted", startBeat: 0 });
  h.recipe.recordings.clear();
  h.recipe.snapshot.promoted = [];
  await h.service.preview("owner", h.id, true);
  const encoded = Buffer.from(output.encoded);
  const saved = await h.service.publish("owner", h.id, "Frozen");
  expect(saved.paths.map((path) => path.split("/").at(-1))).toEqual(["track-01.mp3", "mix.mp3"]);
  expect(await readFile(saved.paths[1]!)).toEqual(encoded);
});

it("keeps a prepared artifact retryable after publication fails without overwriting existing data", async () => {
  const h = await fixture();
  h.recipe.snapshot.promoted = [h.recipe.snapshot.capture.staged!];
  await h.service.prepare("owner", { artifactId: h.id, target: "promoted", startBeat: 0 });
  await writeFile(join(h.root, "promoted"), "existing data");
  await expect(h.service.publish("owner", h.id, "Retry")).rejects.toThrow();
  expect(await readFile(join(h.root, "promoted"), "utf8")).toBe("existing data");
  expect(h.service.status().state).toBe("ready");
  await rm(join(h.root, "promoted"));
  expect((await h.service.publish("owner", h.id, "Retry")).paths).toHaveLength(2);
});

it("retries failed output teardown without unlocking performance or poisoning later cancellation", async () => {
  const output = new SimulatedLoopOutput();
  const h = await fixture(output);
  const close = vi.spyOn(output, "close").mockRejectedValueOnce(new Error("close failed"));
  await h.service.prepare("owner", { artifactId: h.id, target: "sample" });
  await h.service.preview("owner", h.id, true);
  await expect(h.service.cancel()).rejects.toThrow("close failed");
  expect(h.service.blocksPerformance()).toBe(true);
  await h.service.cancel();
  expect(close).toHaveBeenCalledTimes(2);
  expect(output.frames(1)).toHaveLength(0);
  expect(h.service.blocksPerformance()).toBe(false);
  expect(h.service.status().state).toBe("idle");
});

it("ignores an old failed preview start after its owner canceled and another render prepared", async () => {
  let failStart!: (error: Error) => void;
  const output = new SimulatedLoopOutput();
  output.start = () => new Promise<void>((_resolve, reject) => { failStart = reject; });
  const h = await fixture(output);
  await h.service.prepare("owner", { artifactId: h.id, target: "sample" });
  const starting = h.service.preview("owner", h.id, true).catch((error) => error);
  await vi.waitFor(() => expect(failStart).toBeDefined());
  await h.service.disconnect("owner");
  const next = randomUUID();
  await h.service.prepare("other", { artifactId: next, target: "sample" });
  failStart(new Error("retired startup failed"));
  expect(await starting).toBeInstanceOf(Error);
  expect(h.service.status()).toMatchObject({ state: "ready", artifactId: next });
});

it("keeps a restarted preview alive when the same artifact's earlier start fails late", async () => {
  let failStart!: (error: Error) => void;
  const first = new SimulatedLoopOutput();
  first.start = () => new Promise<void>((_resolve, reject) => { failStart = reject; });
  const h = await fixture(first);
  await h.service.prepare("owner", { artifactId: h.id, target: "sample" });
  const starting = h.service.preview("owner", h.id, true).catch((error) => error);
  await vi.waitFor(() => expect(failStart).toBeDefined());
  await h.service.preview("owner", h.id, false);
  first.start = SimulatedLoopOutput.prototype.start;
  await h.service.preview("owner", h.id, true);
  failStart(new Error("old startup failed"));
  expect(await starting).toBeInstanceOf(Error);
  expect(h.service.status()).toMatchObject({ state: "previewing", artifactId: h.id });
  expect(h.service.blocksPerformance()).toBe(true);
});
