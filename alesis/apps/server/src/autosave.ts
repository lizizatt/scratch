import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomically } from "./settings-cache.js";

export function defaultAutosavePath(environment = process.env): string {
  return environment.ALESIS_AUTOSAVE_PATH
    ?? join(environment.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "alesis", "autosave-loop-session-v1.json");
}

export async function readAutosave(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export interface AutosaverOptions {
  path: string;
  /** The session to keep, or null when there are no completed takes (which removes the file). */
  capture(): string | null;
  /** True while a command is replacing the session; saving is retried afterwards. */
  busy(): boolean;
  playing(): boolean;
  onError(message: string): void;
  delayMs?: number;
  heartbeatMs?: number;
}

/**
 * Keeps the latest loop session on disk so recorded takes survive a power cut. Saves are debounced,
 * serialized, skipped when nothing changed, and renewed on a heartbeat while playing because the
 * staged take changes every pass without any command.
 */
export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private chain: Promise<void> = Promise.resolve();
  private last: string | null | undefined;
  private disposed = false;

  constructor(private readonly options: AutosaverOptions) {
    this.heartbeat = setInterval(() => { if (options.playing()) this.request(); }, options.heartbeatMs ?? 30_000);
    this.heartbeat.unref();
  }

  request(): void {
    if (this.disposed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.options.delayMs ?? 2_000);
    this.timer.unref();
  }

  /** Saves now; resolves once this and any earlier save has finished. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.chain = this.chain.then(() => this.save());
    return this.chain;
  }

  async dispose(): Promise<void> {
    await this.flush();
    this.disposed = true;
    clearInterval(this.heartbeat);
  }

  private async save(): Promise<void> {
    if (this.options.busy()) { this.request(); return; }
    try {
      const session = this.options.capture();
      if (session === this.last) return;
      if (session === null) await rm(this.options.path, { force: true });
      else await writeFileAtomically(this.options.path, session);
      this.last = session;
    } catch (error) {
      this.options.onError(`Unable to autosave loops: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
