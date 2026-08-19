import type { ChordEstimate } from "./types";

export class ChordSmoother {
  readonly #requiredFrames: number;
  #accepted: ChordEstimate | undefined;
  #candidateKey = "";
  #candidateFrames = 0;

  constructor(requiredFrames = 3) {
    if (!Number.isInteger(requiredFrames) || requiredFrames < 1) {
      throw new RangeError("requiredFrames must be a positive integer");
    }
    this.#requiredFrames = requiredFrames;
  }

  update(estimate: ChordEstimate): ChordEstimate {
    if (estimate.state !== "chord") {
      this.reset();
      this.#accepted = estimate;
      return estimate;
    }

    const key = `${estimate.rootPitchClass}:${estimate.quality}`;
    if (key === estimateKey(this.#accepted)) {
      this.#accepted = estimate;
      this.#candidateFrames = 0;
      return estimate;
    }
    if (key !== this.#candidateKey) {
      this.#candidateKey = key;
      this.#candidateFrames = 1;
    } else {
      this.#candidateFrames += 1;
    }

    if (this.#candidateFrames >= this.#requiredFrames) {
      this.#accepted = estimate;
      this.#candidateFrames = 0;
      return estimate;
    }
    return this.#accepted ?? {
      state: "uncertain",
      candidateRootPitchClass: estimate.rootPitchClass,
      timestampSeconds: estimate.timestampSeconds,
      confidence: estimate.confidence,
      chroma: estimate.chroma,
    };
  }

  reset(): void {
    this.#candidateKey = "";
    this.#candidateFrames = 0;
  }
}

function estimateKey(estimate: ChordEstimate | undefined): string {
  return estimate?.state === "chord"
    ? `${estimate.rootPitchClass}:${estimate.quality}`
    : "";
}
