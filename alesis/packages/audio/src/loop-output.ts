import { SamplePlayer } from "./samples.js";

export interface LoopOutput {
  start(pcm: Buffer, encoded: Buffer, onError: (message: string) => void): Promise<void>;
  close(): Promise<void>;
}

/** The cursor crosses the seam inside a buffer, never by restarting a pad or process. */
class CircularPcm {
  private offset = 0;
  constructor(private readonly pcm: Buffer) {
    if (pcm.length === 0 || pcm.length % 4 !== 0) throw new Error("Loop PCM must contain complete stereo S16 frames");
  }
  frames(count: number): Buffer {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid frame count");
    const out = Buffer.alloc(count * 4);
    for (let written = 0; written < out.length;) {
      const size = Math.min(out.length - written, this.pcm.length - this.offset);
      this.pcm.copy(out, written, this.offset, this.offset + size);
      written += size;
      this.offset = (this.offset + size) % this.pcm.length;
    }
    return out;
  }
}

export class PcmLoopOutput implements LoopOutput {
  private player: SamplePlayer | null = null;
  private generation = 0;
  constructor(private readonly device: string) {}
  async start(pcm: Buffer, _encoded: Buffer, onError: (message: string) => void): Promise<void> {
    const closing = this.close();
    const generation = this.generation;
    await closing;
    if (generation !== this.generation) throw new Error("Preview output startup canceled");
    const source = new CircularPcm(pcm);
    this.player = new SamplePlayer(this.device, { renderPcm: (frames) => source.frames(frames), stopImmediately: true, onError });
    await this.player.start();
  }
  async close(): Promise<void> {
    this.generation += 1;
    const player = this.player;
    await player?.close();
    if (this.player === player) this.player = null;
  }
}

/** Hardware-free sink with the same contiguous reader as the production ALSA pump. */
export class SimulatedLoopOutput implements LoopOutput {
  private source: CircularPcm | null = null;
  encoded: Buffer = Buffer.alloc(0);
  async start(pcm: Buffer, encoded: Buffer, _onError: (message: string) => void): Promise<void> {
    this.source = new CircularPcm(pcm);
    this.encoded = Buffer.from(encoded);
  }
  frames(count: number): Buffer { return this.source?.frames(count) ?? Buffer.alloc(0); }
  async close(): Promise<void> { this.source = null; }
}
