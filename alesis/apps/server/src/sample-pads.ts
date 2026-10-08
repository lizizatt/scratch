import type { MidiEvent } from "@alesis/engine";
import { MAX_SAMPLE_CATALOG, type PadMode, type SamplePad, type PadAssignment, type SampleCatalogEntry } from "@alesis/protocol";

export interface SampleDescriptor {
  id: string;
  name: string;
  path: string;
}

export interface DecodedSample {
  id: string;
  name: string;
  samples: Float32Array;
}

export interface SampleLibraryLike {
  scan(): Promise<SampleDescriptor[]>;
  loadPage(pageIndex: number): Promise<Array<DecodedSample | null>>;
  loadSlots?(ids: readonly (string | null)[]): Promise<Array<DecodedSample | null>>;
  readonly descriptors: readonly SampleDescriptor[];
  close?(): Promise<void>;
}

export interface SamplePlayerLike {
  start(): Promise<void>;
  setPage(samples: readonly (DecodedSample | null)[]): void;
  trigger(pad: number, velocity: number): void;
  release(pad: number): boolean;
  panic(): void;
  close(): Promise<void>;
}

export type SampleLibraryStatus = "ready" | "loading" | "error";

export interface SamplePadState {
  status: SampleLibraryStatus;
  error?: string;
  pageIndex: number;
  pageCount: number;
  page: SamplePad[];
  catalog: SampleCatalogEntry[];
}

export type SamplePadStateListener = (state: SamplePadState) => void;

export class SamplePadService {
  private generation = 0;
  private libraryTail: Promise<void> = Promise.resolve();
  private refreshInProgress = false;
  private pageCount = 0;
  private pageIndex = 0;
  private page: Array<DecodedSample | null> = emptyDecodedPage();
  private status: SampleLibraryStatus = "loading";
  private error: string | undefined;
  private player: SamplePlayerLike | null = null;
  private playerStarted = false;
  private playerStart: Promise<void> | null = null;
  private closed = false;
  private mode: PadMode = "samples";
  private assignments: PadAssignment[] = [];
  private catalog: SampleCatalogEntry[] = [];

  constructor(
    private readonly library: SampleLibraryLike,
    private readonly onState: SamplePadStateListener,
    private readonly createPlayer?: () => SamplePlayerLike | null,
  ) {}

  snapshot(): SamplePadState {
    return {
      status: this.status,
      ...(this.error === undefined ? {} : { error: this.error }),
      pageIndex: this.pageIndex,
      pageCount: this.pageCount,
      page: pageDescriptors(this.page),
      catalog: this.catalog,
    };
  }

  async refresh(): Promise<{ accepted: boolean; error?: string }> {
    if (this.closed) return { accepted: false, error: "Sample service is closed" };
    const generation = ++this.generation;
    this.refreshInProgress = true;
    this.status = "loading";
    this.error = undefined;
    this.player?.panic();
    this.emit();
    try {
      const loaded = await this.withLibrary(async () => {
        const descriptors = await this.library.scan();
        if (generation !== this.generation) return null;
        if (descriptors.length > MAX_SAMPLE_CATALOG) throw new Error("Sample catalog exceeds 4096 files");
        this.catalog = descriptors.map(({ id, name }) => ({ id, name }));
        const pageCount = this.availablePageCount();
        const pageIndex = pageCount === 0 ? 0 : Math.min(this.pageIndex, pageCount - 1);
        const samples = await this.loadMappedPage(pageIndex);
        return { pageCount, pageIndex, samples };
      });
      if (generation !== this.generation || loaded === null) return { accepted: false, error: "Sample refresh was superseded" };
      this.pageCount = loaded.pageCount;
      this.pageIndex = loaded.pageIndex;
      this.page = paddedPage(loaded.samples);
      return await this.installPage(generation)
        ? { accepted: true }
        : { accepted: false, error: "Sample refresh was superseded" };
    } catch (error) {
      if (generation !== this.generation) return { accepted: false, error: "Sample refresh was superseded" };
      const message = sanitizeError(error);
      this.fail(message);
      return { accepted: false, error: `Unable to refresh samples: ${message}` };
    } finally {
      if (generation === this.generation) this.refreshInProgress = false;
    }
  }

  async selectPage(pageIndex: number): Promise<{ accepted: boolean; error?: string }> {
    if (this.closed) return { accepted: false, error: "Sample service is closed" };
    if (this.refreshInProgress) return { accepted: false, error: "Sample library is refreshing" };
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= Math.max(1, this.pageCount)) {
      return { accepted: false, error: "Sample page is outside the available range" };
    }
    const generation = ++this.generation;
    this.pageIndex = pageIndex;
    this.status = "loading";
    this.error = undefined;
    this.page = emptyDecodedPage();
    this.player?.panic();
    this.emit();
    try {
      const samples = await this.withLibrary(() => this.loadMappedPage(pageIndex));
      if (generation !== this.generation) return { accepted: false, error: "Sample page load was superseded" };
      this.page = paddedPage(samples);
      return await this.installPage(generation)
        ? { accepted: true }
        : { accepted: false, error: "Sample page load was superseded" };
    } catch (error) {
      if (generation !== this.generation) return { accepted: false, error: "Sample page load was superseded" };
      const message = sanitizeError(error);
      this.fail(message);
      return { accepted: false, error: `Unable to load sample page: ${message}` };
    }
  }

  trigger(pad: number, velocity: number): boolean {
    if (this.status !== "ready" || pad < 0 || pad > 7 || !this.page[pad]) return false;
    this.player?.trigger(pad, velocity);
    return true;
  }

  async configure(mode: PadMode, assignments: PadAssignment[]): Promise<{ accepted: boolean; error?: string }> {
    this.mode = mode;
    this.assignments = structuredClone(assignments);
    // Audio reconnection can refresh outside the command queue with the old mapping.
    if (this.refreshInProgress) return this.refresh();
    this.pageCount = this.availablePageCount();
    this.pageIndex = Math.min(this.pageIndex, Math.max(0, this.pageCount - 1));
    return this.selectPage(this.pageIndex);
  }

  private availablePageCount(): number {
    return Math.max(Math.ceil(this.catalog.length / 8), ...this.assignments.map(({ page }) => page + 1));
  }

  private loadMappedPage(pageIndex: number): Promise<Array<DecodedSample | null>> {
    const overrides = this.assignments.filter((entry) => entry.mode === this.mode && entry.page === pageIndex);
    if (!overrides.length) return this.library.loadPage(pageIndex);
    const ids = Array.from({ length: 8 }, (_, pad) => {
      const action = overrides.find((entry) => entry.pad === pad)?.action;
      return action ? action.kind === "sample" ? action.sampleId : null : this.library.descriptors[pageIndex * 8 + pad]?.id ?? null;
    });
    if (!this.library.loadSlots) throw new Error("Sample library does not support assignments");
    return this.library.loadSlots(ids);
  }

  release(pad: number): boolean {
    if (!Number.isInteger(pad) || pad < 0 || pad > 7) return false;
    this.player?.release(pad);
    return true;
  }

  panic(): void {
    this.player?.panic();
  }

  reportPlaybackError(message: string): void {
    const player = this.player;
    this.player = null;
    this.playerStarted = false;
    this.playerStart = null;
    void player?.close().catch(() => {});
    this.fail(sanitizeError(message));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    ++this.generation;
    const player = this.player;
    this.player = null;
    this.playerStarted = false;
    this.playerStart = null;
    await Promise.all([player?.close(), this.library.close?.()]);
  }

  private async installPage(generation: number): Promise<boolean> {
    if (this.closed || generation !== this.generation) return false;
    if (this.createPlayer) {
      this.player ??= this.createPlayer();
      const player = this.player;
      if (player) {
        player.setPage(this.page);
        if (!this.playerStarted) {
          if (!this.playerStart) {
            let starting: Promise<void>;
            starting = player.start().then(() => {
              if (this.closed || this.player !== player) {
                void player.close().catch(() => {});
                return;
              }
              this.playerStarted = true;
            }).catch((error: unknown) => {
              if (this.player === player) {
                this.player = null;
                this.playerStarted = false;
              }
              void player.close().catch(() => {});
              throw error;
            }).finally(() => {
              if (this.playerStart === starting) this.playerStart = null;
            });
            this.playerStart = starting;
          }
          await this.playerStart;
          if (this.closed || generation !== this.generation || this.player !== player) return false;
          this.playerStarted = true;
        }
      }
    }
    if (this.closed || generation !== this.generation) return false;
    this.status = "ready";
    this.error = undefined;
    this.emit();
    return true;
  }

  private fail(message: string): void {
    this.status = "error";
    this.error = message;
    this.emit();
  }

  private emit(): void {
    this.onState(this.snapshot());
  }

  private withLibrary<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.libraryTail.then(operation, operation);
    this.libraryTail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

export type PadMidiAction =
  | { kind: "trigger-sample"; pad: number; velocity: number }
  | { kind: "release-sample"; pad: number }
  | { kind: "drum-hit"; note: number; velocity: number }
  | { kind: "drum-release"; note: number };

export function padMidiInput(event: MidiEvent, mode: PadMode): PadMidiAction | null {
  if (!isMappedPadNote(event)) return null;
  const releasing = event.type === "note-off" || event.type === "note-on" && event.velocity === 0;
  const pad = event.note - 36;
  if (mode === "samples") {
    return releasing ? { kind: "release-sample", pad } : { kind: "trigger-sample", pad, velocity: event.velocity };
  }
  return releasing
    ? { kind: "drum-release", note: event.note }
    : { kind: "drum-hit", note: event.note, velocity: event.velocity };
}

export function isMappedDrumPadRelease(event: MidiEvent): boolean {
  return event.type === "note-off" && isMappedPadNote(event)
    || event.type === "note-on" && event.velocity === 0 && isMappedPadNote(event);
}

function isMappedPadNote(event: MidiEvent): event is Extract<MidiEvent, { type: "note-on" | "note-off" }> {
  return (event.type === "note-on" || event.type === "note-off")
    && event.channel === 9 && event.note >= 36 && event.note <= 43;
}

function pageDescriptors(samples: readonly (DecodedSample | null)[]): SamplePad[] {
  return Array.from({ length: 8 }, (_, pad) => {
    const sample = samples[pad];
    return sample ? { id: sample.id, name: sample.name, pad } : null;
  });
}

function paddedPage(samples: readonly (DecodedSample | null)[]): Array<DecodedSample | null> {
  return Array.from({ length: 8 }, (_, pad) => samples[pad] ?? null);
}

function emptyDecodedPage(): Array<DecodedSample | null> {
  return Array.from({ length: 8 }, () => null);
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/'\/[^']*'|"\/[^"]*"|\/[^\s'"<>]+/g, "[local path]");
}
