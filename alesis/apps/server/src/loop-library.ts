import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  exportNameSchema,
  idleSavedLoops,
  parseLoopSession,
  type SavedLoop,
  type SavedLoopsStatus,
} from "@alesis/protocol";

interface Options {
  directory: string;
  log?: (message: string) => void;
}

/** Loops kept on the host as plain session files, so any of them can be reopened and edited. */
export class LoopLibrary {
  private items = new Map<string, SavedLoop & { signature: string }>();
  private unreadable: string[] = [];
  private listeners = new Set<(status: SavedLoopsStatus) => void>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: Options) {}

  async init(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true });
    await this.refresh();
  }

  status(): SavedLoopsStatus {
    if (this.items.size === 0 && this.unreadable.length === 0) return { ...idleSavedLoops };
    const items = [...this.items.values()]
      .map(({ signature: _signature, ...item }): SavedLoop => item)
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt) || left.id.localeCompare(right.id))
      .slice(0, 500);
    return { items, unreadable: this.unreadable.slice(0, 50) };
  }

  subscribe(listener: (status: SavedLoopsStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Saves under `name`, replacing any loop of that name. The file is complete or absent, never half-written. */
  async save(name: string, sessionJson: string): Promise<SavedLoop> {
    const id = exportNameSchema.parse(name);
    parseLoopSession(sessionJson);
    return this.serialize(async () => {
      await mkdir(this.options.directory, { recursive: true });
      const target = this.path(id);
      await writeFile(`${target}.tmp`, sessionJson);
      await rename(`${target}.tmp`, target);
      const item = await this.describe(id);
      if (!item) throw new Error("The saved loop could not be read back");
      this.items.set(id, item);
      this.unreadable = this.unreadable.filter((entry) => entry !== `${id}.json`);
      this.emit();
      const { signature: _signature, ...saved } = item;
      return saved;
    });
  }

  async read(id: string): Promise<string> {
    const safe = exportNameSchema.parse(id);
    if (!this.items.has(safe)) throw new Error(`No saved loop named ${safe}`);
    return readFile(this.path(safe), "utf8");
  }

  async delete(id: string): Promise<void> {
    const safe = exportNameSchema.parse(id);
    return this.serialize(async () => {
      if (!this.items.has(safe)) throw new Error(`No saved loop named ${safe}`);
      await rm(this.path(safe), { force: true });
      this.items.delete(safe);
      this.emit();
    });
  }

  /** Rescans the folder, so files copied in or removed by hand show up. */
  refresh(): Promise<void> {
    return this.serialize(async () => {
      const seen = new Set<string>();
      const unreadable: string[] = [];
      for (const name of await readdir(this.options.directory).catch(() => [] as string[])) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -".json".length);
        if (!exportNameSchema.safeParse(id).success) continue;
        seen.add(id);
        const info = await stat(this.path(id)).catch(() => null);
        if (!info?.isFile()) continue;
        if (this.items.get(id)?.signature === `${info.mtimeMs}:${info.size}`) continue;
        const item = await this.describe(id);
        if (item) this.items.set(id, item);
        else { this.items.delete(id); unreadable.push(name); }
      }
      for (const id of [...this.items.keys()]) if (!seen.has(id)) this.items.delete(id);
      this.unreadable = unreadable;
      this.emit();
    });
  }

  private path(id: string): string { return join(this.options.directory, `${id}.json`); }

  private async describe(id: string): Promise<(SavedLoop & { signature: string }) | null> {
    try {
      const info = await stat(this.path(id));
      const session = parseLoopSession(await readFile(this.path(id), "utf8"));
      return {
        id, savedAt: info.mtime.toISOString(), bytes: info.size,
        takeCount: (session.staged ? 1 : 0) + (session.previousStaged ? 1 : 0) + session.promoted.length,
        bpm: session.settings.bpm, loopMeasures: session.settings.loopMeasures, beatsPerMeasure: session.settings.beatsPerMeasure,
        signature: `${info.mtimeMs}:${info.size}`,
      };
    } catch (error) {
      (this.options.log ?? console.error)(`Unreadable saved loop ${id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.catch(() => {});
    return run;
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }
}
