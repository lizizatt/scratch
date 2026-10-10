import { describe, expect, it } from "vitest";
import { sampleOnsetTrimFrame } from "./sample-onset.js";

describe("sample onset trim", () => {
  it.each([0, 1])("detects a quiet attack in channel %i and retains 5 ms of pre-roll", (channel) => {
    const pcm = Buffer.alloc(4 * 2400);
    for (let offset = 0; offset < pcm.length; offset += 2) pcm.writeInt16LE(-3, offset);
    pcm.writeInt16LE(channel === 0 ? 4 : -4, 1200 * 4 + channel * 2);
    expect(sampleOnsetTrimFrame(pcm)).toBe(960);
  });

  it.each([0, 1, 239, 479])("leaves an immediate attack at frame %i unchanged", (frame) => {
    const pcm = Buffer.alloc(480 * 4);
    pcm.writeInt16LE(100, frame * 4);
    expect(sampleOnsetTrimFrame(pcm)).toBe(0);
  });

  it("keeps frame alignment and detects a final-frame attack", () => {
    const pcm = Buffer.alloc(1000 * 4);
    pcm.writeInt16LE(-32768, 999 * 4 + 2);
    expect(sampleOnsetTrimFrame(pcm)).toBe(759);
  });

  it("rejects empty, silent and incomplete PCM instead of publishing an empty sample", () => {
    expect(() => sampleOnsetTrimFrame(Buffer.alloc(0))).toThrow("No audible sample material");
    expect(() => sampleOnsetTrimFrame(Buffer.alloc(400))).toThrow("No audible sample material");
    expect(() => sampleOnsetTrimFrame(Buffer.alloc(5))).toThrow("Incomplete sample PCM frame");
  });

  it("preserves delayed wrapped reflections before the first attack without disabling legacy cold-onset trim", () => {
    const pcm = Buffer.alloc(4 * 4800);
    pcm.writeInt16LE(100, 1200 * 4);
    expect(sampleOnsetTrimFrame(pcm, 2400)).toBe(0);
    expect(sampleOnsetTrimFrame(pcm, 1200)).toBe(960);
    expect(sampleOnsetTrimFrame(pcm)).toBe(960);
  });
});
