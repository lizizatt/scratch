declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(
    inputs: Float32Array<ArrayBufferLike>[][],
    outputs?: Float32Array<ArrayBufferLike>[][],
    parameters?: Record<string, Float32Array<ArrayBufferLike>>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;
