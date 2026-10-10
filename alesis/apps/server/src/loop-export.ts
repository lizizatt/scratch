import { basename } from "node:path";
import { exportNameSchema, idleLoopExport, type EngineSnapshot, type LoopArtifactInfo, type LoopExportStatus } from "@alesis/protocol";
import type { LoopOutput } from "@alesis/audio";
import { renderLoopArtifact, type LoopArtifact, type LoopRecipe, type LoopRenderSelection } from "./loop-render.js";
import { publishSampleArtifact } from "./loop-sample-exporter.js";
import { publishMp3Artifact } from "./mp3-exporter.js";

interface Dependencies {
  snapshot(): EngineSnapshot;
  capture(target: LoopRenderSelection["target"]): LoopRecipe;
  sampleRoot: string;
  outputRoot: string;
  output(): LoopOutput;
  enterPreview(): void;
  leavePreview(): void;
  refreshSamples(): Promise<void>;
}
interface OwnedExport {
  id: string;
  owner: string;
  selection: LoopRenderSelection;
  controller: AbortController;
  artifact?: LoopArtifact;
  work?: Promise<unknown>;
  timer?: ReturnType<typeof setTimeout>;
}

/** One bounded, connection-owned frozen artifact. Rendering never owns the control queue. */
export class LoopExports {
  private current: OwnedExport | null = null;
  private value: LoopExportStatus = { ...idleLoopExport };
  private listeners = new Set<(status: LoopExportStatus) => void>();
  private sink: LoopOutput | null = null;
  private exclusive = false;
  private previewGeneration = 0;
  private stopping: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private readonly host: Dependencies) {}
  status = (): LoopExportStatus => ({ ...this.value });
  blocksPerformance = (): boolean => this.exclusive;
  subscribe = (listener: (status: LoopExportStatus) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(state: LoopExportStatus["state"], error?: string): void {
    this.value = { state, artifactId: this.current?.id ?? null, target: this.current?.selection.target ?? null, ...(error ? { error } : {}) };
    for (const listener of this.listeners) listener(this.status());
  }
  private owned(owner: string, id: string): OwnedExport {
    const current = this.current;
    if (!current || current.owner !== owner || current.id !== id || current.controller.signal.aborted) throw new Error("Export is unavailable or belongs to another connection");
    return current;
  }
  async prepare(owner: string, selection: LoopRenderSelection & { artifactId: string }): Promise<LoopArtifactInfo> {
    if (this.closed) throw new Error("Export host is closed");
    if (this.current) throw new Error("Another export is active; close it before preparing a new one");
    const current: OwnedExport = { owner, id: selection.artifactId, selection: { ...selection }, controller: new AbortController() };
    this.current = current;
    this.update("preparing");
    current.timer = setTimeout(() => { void this.cancel().catch(() => {}); }, 5 * 60_000);
    current.timer.unref();
    const work = async () => {
      try {
        const recipe = this.host.capture(selection.target);
        const artifact = await renderLoopArtifact(recipe, selection, current.controller.signal);
        current.artifact = artifact;
        current.controller.signal.throwIfAborted();
        this.update("ready");
        return { artifactId: current.id, target: selection.target, durationSeconds: artifact.durationSeconds };
      } catch (error) {
        await this.dispose(current);
        if (this.current === current && !current.controller.signal.aborted) { this.current = null; this.update("error", message(error)); }
        throw error;
      }
    };
    const pending = work();
    current.work = pending;
    try { return await pending; } finally { if (current.work === pending) delete current.work; }
  }
  async preview(owner: string, id: string, enabled: boolean): Promise<void> {
    const current = this.owned(owner, id);
    if (!enabled) { await this.stopPreview(); return; }
    if (this.host.snapshot().transport.state !== "stopped") throw new Error("Stop transport before preview; it will not stop or resume automatically");
    if (!current.artifact || this.value.state !== "ready") throw new Error("Export is not ready for preview");
    await this.stopping;
    this.owned(owner, id);
    if (this.value.state !== "ready") throw new Error("Export is not ready for preview");
    const generation = ++this.previewGeneration;
    this.exclusive = true;
    this.update("previewing");
    try {
      this.host.enterPreview();
      const sink = this.host.output();
      this.sink = sink;
      await sink.start(current.artifact.pcm, current.artifact.encoded, (error) => {
        if (this.current === current && this.sink === sink) void this.cancel(error).catch(() => {});
      });
      current.controller.signal.throwIfAborted();
    } catch (error) {
      if (this.current === current && generation === this.previewGeneration) await this.cancel(message(error));
      throw error;
    }
  }
  async stopPreview(): Promise<void> {
    this.previewGeneration += 1;
    // Serial teardown keeps performance blocked until the previous sink has actually closed.
    this.stopping = this.stopping.catch(() => {}).then(async () => {
      const sink = this.sink;
      await sink?.close();
      if (this.sink === sink) this.sink = null;
      if (this.exclusive) { this.host.leavePreview(); this.exclusive = false; }
      if (this.current?.artifact && !this.current.controller.signal.aborted && this.value.state === "previewing") this.update("ready");
    });
    await this.stopping;
  }
  async publish(owner: string, id: string, rawName?: string): Promise<{ paths: string[]; message: string }> {
    const current = this.owned(owner, id);
    if (!current.artifact || !["ready", "previewing"].includes(this.value.state)) throw new Error("Export is not ready to save");
    const name = rawName === undefined ? undefined : exportNameSchema.parse(rawName);
    if (current.selection.target === "promoted" && !name) throw new Error("Folder name is required");
    this.update("publishing");
    const work = async () => {
      try {
        await this.stopPreview();
        const artifact = current.artifact!;
        const signal = current.controller.signal;
        signal.throwIfAborted();
        let result: { paths: string[]; message: string };
        if (current.selection.target === "sample") {
          const published = await publishSampleArtifact(artifact, this.host.sampleRoot, name, signal);
          let warning = published.warning ? ` Warning: ${published.warning}.` : "";
          try { await this.host.refreshSamples(); }
          catch { warning += " Warning: the file exists, but the sample library could not be refreshed."; }
          result = { paths: [published.path], message: `Saved ${basename(published.path)} to the sample library.${warning}` };
        } else {
          const published = await publishMp3Artifact(artifact, name!, this.host.outputRoot, signal);
          result = { paths: [...published.tracks, published.mix], message: `Saved ${published.tracks.length} tracks and mix to ${published.directory}` };
        }
        // Publication is committed; a lost acknowledgement must not delete saved user files.
        try { await this.dispose(current); }
        catch {
          result.message += " Warning: temporary export cleanup failed; press Stop to retry cleanup.";
          this.update("error", "Temporary export cleanup failed; press Stop to retry cleanup");
          return result;
        }
        if (this.current === current) { this.current = null; this.update("idle"); }
        return result;
      } catch (error) {
        if (!current.controller.signal.aborted) this.update("ready", message(error));
        throw error;
      }
    };
    const pending = work();
    current.work = pending;
    try { return await pending; } finally { if (current.work === pending) delete current.work; }
  }
  async release(owner: string, id: string): Promise<void> {
    if (!this.current) return;
    if (this.current.owner !== owner || this.current.id !== id) throw new Error("Export belongs to another connection");
    await this.cancel();
  }
  async disconnect(owner: string): Promise<void> { if (this.current?.owner === owner) await this.cancel(); }
  async cancel(error?: string): Promise<void> {
    const current = this.current;
    if (!current) { await this.stopPreview(); return; }
    current.controller.abort();
    this.update("canceling");
    await this.stopPreview();
    await current.work?.catch(() => {});
    await this.dispose(current);
    if (this.current === current) { this.current = null; this.update(error ? "error" : "idle", error); }
  }
  private async dispose(current: OwnedExport): Promise<void> {
    if (current.timer) clearTimeout(current.timer);
    await current.artifact?.release();
    delete current.artifact;
  }
  async close(): Promise<void> { this.closed = true; await this.cancel(); this.listeners.clear(); }
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
