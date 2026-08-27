import type { ChordEstimate } from "../analysis/types";
import type { PianoFrame } from "../analysis/piano";

export type FileAnalysisProgress = {
  readonly phase: "decoding" | "analyzing";
  readonly fraction: number;
};

export type FileAnalysisResult = {
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly estimates: readonly ChordEstimate[];
  readonly pianoFrames: readonly PianoFrame[];
};

type WorkerMessage =
  | { readonly type: "progress"; readonly fraction: number }
  | { readonly type: "complete"; readonly estimates: readonly ChordEstimate[]; readonly pianoFrames: readonly PianoFrame[] }
  | { readonly type: "error"; readonly message: string };

export async function analyzeAudioFile(
  file: File,
  onProgress?: (progress: FileAnalysisProgress) => void,
): Promise<FileAnalysisResult> {
  onProgress?.({ phase: "decoding", fraction: 0 });
  const context = new AudioContext();
  try {
    const encoded = await file.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(encoded);
    const samples = downmix(audioBuffer);
    onProgress?.({ phase: "decoding", fraction: 1 });
    const analysis = await analyzeInWorker(
      samples,
      audioBuffer.sampleRate,
      (fraction) => onProgress?.({ phase: "analyzing", fraction }),
    );
    return {
      durationSeconds: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      estimates: analysis.estimates,
      pianoFrames: analysis.pianoFrames,
    };
  } finally {
    await context.close();
  }
}

function analyzeInWorker(
  samples: Float32Array,
  sampleRate: number,
  onProgress: (fraction: number) => void,
): Promise<Extract<WorkerMessage, { readonly type: "complete" }>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../analysis/analysis-worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === "progress") {
        onProgress(event.data.fraction);
      } else if (event.data.type === "complete") {
        worker.terminate();
        resolve(event.data);
      } else {
        worker.terminate();
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Audio analysis worker failed"));
    };
    worker.postMessage({ samples, sampleRate }, [samples.buffer]);
  });
}

function downmix(audioBuffer: AudioBuffer): Float32Array {
  const samples = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] =
        (samples[index] ?? 0) +
        (channelData[index] ?? 0) / audioBuffer.numberOfChannels;
    }
  }
  return samples;
}
