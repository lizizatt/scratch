import type { ChordEstimate } from "../analysis/types";
import type { PianoNote } from "../analysis/piano";

export type MicrophoneAnalysisStatus =
  | "starting"
  | "running"
  | "muted"
  | "ended"
  | "stopped"
  | "error";

export type MicrophoneAnalysisSnapshot = {
  readonly status: MicrophoneAnalysisStatus;
  readonly estimate?: ChordEstimate;
  readonly heatmapFrame?: MicrophoneHeatmapFrame;
  readonly settings?: MediaTrackSettings;
  readonly message?: string;
};

export type MicrophoneHeatmapFrame = {
  readonly timestampSeconds: number;
  readonly chroma: readonly number[];
  readonly intervalSeconds: number;
  readonly lowestNote?: string;
  readonly pianoNotes: readonly PianoNote[];
};

type WorkerMessage = {
  readonly type: "estimate";
  readonly estimate: ChordEstimate;
  readonly heatmapFrame: MicrophoneHeatmapFrame;
};

export class MicrophoneAnalysisSession {
  #context: AudioContext | undefined;
  #stream: MediaStream | undefined;
  #track: MediaStreamTrack | undefined;
  #source: MediaStreamAudioSourceNode | undefined;
  #worklet: AudioWorkletNode | undefined;
  #worker: Worker | undefined;
  #fftWindowMilliseconds = 85;
  #onSnapshot: (snapshot: MicrophoneAnalysisSnapshot) => void;

  constructor(onSnapshot: (snapshot: MicrophoneAnalysisSnapshot) => void) {
    this.#onSnapshot = onSnapshot;
  }

  async start(): Promise<void> {
    await this.stop();
    this.#onSnapshot({ status: "starting" });
    try {
      this.#context = new AudioContext();
      await this.#context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
          channelCount: 1,
        },
      });
      this.#stream = stream;
      this.#track = stream.getAudioTracks()[0];
      if (this.#track === undefined) {
        throw new Error("No microphone track was returned");
      }
      this.#track.addEventListener("mute", this.#handleMute);
      this.#track.addEventListener("unmute", this.#handleUnmute);
      this.#track.addEventListener("ended", this.#handleEnded);
      await this.#context.audioWorklet.addModule(
        new URL("../analysis/microphone-worklet.ts", import.meta.url),
      );
      this.#source = this.#context.createMediaStreamSource(stream);
      this.#worklet = new AudioWorkletNode(this.#context, "microphone-frame");
      this.#worker = new Worker(
        new URL("../analysis/microphone-worker.ts", import.meta.url),
        { type: "module" },
      );
      this.#worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === "estimate") {
          this.#onSnapshot({
            status: "running",
            estimate: event.data.estimate,
            heatmapFrame: event.data.heatmapFrame,
          });
        }
      };
      this.#worker.postMessage({
        type: "start",
        sampleRate: this.#context.sampleRate,
        fftWindowMilliseconds: this.#fftWindowMilliseconds,
      });
      this.#worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const samples = event.data;
        this.#worker?.postMessage({ type: "samples", samples }, [samples.buffer]);
      };
      this.#source.connect(this.#worklet);
      this.#worklet.connect(this.#context.destination);
      this.#onSnapshot({
        status: "running",
        settings: this.#track.getSettings(),
      });
    } catch (error) {
      await this.stop();
      this.#onSnapshot({
        status: "error",
        message: error instanceof Error ? error.message : "Could not start microphone.",
      });
      throw error;
    }
  }

  setFftWindowMilliseconds(milliseconds: number): void {
    this.#fftWindowMilliseconds = milliseconds;
    this.#worker?.postMessage({
      type: "configure",
      fftWindowMilliseconds: milliseconds,
    });
  }

  async stop(): Promise<void> {
    this.#track?.removeEventListener("mute", this.#handleMute);
    this.#track?.removeEventListener("unmute", this.#handleUnmute);
    this.#track?.removeEventListener("ended", this.#handleEnded);
    this.#worker?.postMessage({ type: "stop" });
    this.#worker?.terminate();
    this.#source?.disconnect();
    this.#worklet?.disconnect();
    await this.#context?.close();
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#context = undefined;
    this.#stream = undefined;
    this.#track = undefined;
    this.#source = undefined;
    this.#worklet = undefined;
    this.#worker = undefined;
    this.#onSnapshot({ status: "stopped" });
  }

  #handleMute = () => this.#onSnapshot({ status: "muted" });
  #handleUnmute = () => this.#onSnapshot({ status: "running" });
  #handleEnded = () => this.#onSnapshot({ status: "ended" });
}
