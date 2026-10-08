import { describe, expect, it } from "vitest";
import { commandEnvelopeSchema, PROTOCOL_VERSION } from "./index.js";

const parse = (command: unknown) => commandEnvelopeSchema.safeParse({
  protocolVersion: PROTOCOL_VERSION, commandId: "90786ed3-b479-4417-959f-36b31834a659", command,
}).success;
const base = { type: "configure-pad", mode: "samples", page: 0, pad: 7 };

describe("pad assignments", () => {
  it("accepts saved sample IDs, controls, and reset on the empty first page", () => {
    expect(parse({ ...base, action: { kind: "sample", sampleId: "sample-abc" } })).toBe(true);
    for (const target of ["transport", "drums", "metronome", "arpeggiator"]) {
      for (const operation of ["toggle", "on", "off"]) {
        expect(parse({ ...base, action: { kind: "control", target, operation } })).toBe(true);
      }
    }
    expect(parse({ ...base, action: null })).toBe(true);
  });

  it("rejects unsafe indices, paths, unsupported targets, and extra fields", () => {
    const action = { kind: "sample", sampleId: "sample-abc" };
    for (const page of [-1, 0.5, 512, Number.MAX_SAFE_INTEGER]) expect(parse({ ...base, page, action })).toBe(false);
    for (const pad of [-1, 0.5, 8]) expect(parse({ ...base, pad, action })).toBe(false);
    for (const sampleId of ["", "../secret", "/private/loop.mp3", "a".repeat(257)]) {
      expect(parse({ ...base, action: { ...action, sampleId } })).toBe(false);
    }
    expect(parse({ ...base, action: { kind: "control", target: "mic", operation: "toggle" } })).toBe(false);
    expect(parse({ ...base, action: { ...action, path: "/private/file" } })).toBe(false);
    expect(parse({ ...base, action, longPress: true })).toBe(false);
  });
});