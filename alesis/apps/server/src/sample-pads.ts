import type { SamplePad } from "@alesis/protocol";

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
  readonly descriptors: readonly SampleDescriptor[];
  close?(): Promise<void>;
}

export interface SamplePlayerLike {
  start(): Promise<void>;
  setPage(samples: readonly (DecodedSample | null)[]): void;
  trigger(pad: number, velocity: number): void;
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
    };
  }

  async refresh(): Promise<{ accepted: boolean; error?: string }> {
    if (this.closed) return { accepted: false, error: "Sample service is closed" };
    const generation = ++this.generation;
    this.refreshInProgress = true;
    this.status = "loading";
    this.error = undefined;
    this.emit();
    try {
      const loaded = await this.withLibrary(async () => {
        const descriptors = await this.library.scan();
        if (generation !== this.generation) return null;
        const pageCount = Math.ceil(descriptors.length / 8);
        const pageIndex = pageCount === 0 ? 0 : Math.min(this.pageIndex, pageCount - 1);
        const samples = await this.library.loadPage(pageIndex);
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
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pageCount) {
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
      const samples = await this.withLibrary(() => this.library.loadPage(pageIndex));
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

export function samplePadInput(event: { type: string; channel?: number; note?: number; velocity?: number }): { consumed: boolean; pad?: number; velocity?: number } {
  if ((event.type !== "note-on" && event.type !== "note-off") || event.channel !== 9 || event.note === undefined || event.note < 36 || event.note > 43) {
    return { consumed: false };
  }
  return event.type === "note-on" && event.velocity !== undefined && event.velocity > 0
    ? { consumed: true, pad: event.note - 36, velocity: event.velocity }
    : { consumed: true };
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
  return message.replace(/(?:^|\s)\/(?:[^/\s]+\/)*[^/\s]*/g, " [local path]");
}
