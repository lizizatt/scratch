import { describe, expect, it } from "vitest";
import { expectExactBuffer } from "./exact-buffer.js";

describe("expectExactBuffer", () => {
  it("rejects a length mismatch even when all shared bytes match", () => {
    expect(() => expectExactBuffer(Buffer.from([1, 2]), Buffer.from([1, 2, 3]), "preview"))
      .toThrow("preview: byte length mismatch (actual 2, expected 3)");
  });

  it("rejects extra trailing bytes", () => {
    expect(() => expectExactBuffer(Buffer.from([1, 2, 3]), Buffer.from([1, 2])))
      .toThrow("Buffer: byte length mismatch (actual 3, expected 2)");
  });

  it("accepts independently allocated identical bytes", () => {
    expect(() => expectExactBuffer(Buffer.from([0, 127, 128, 255]), Buffer.from([0, 127, 128, 255])))
      .not.toThrow();
  });

  it("accepts empty buffers", () => {
    expect(() => expectExactBuffer(Buffer.alloc(0), Buffer.alloc(0))).not.toThrow();
  });

  it("compares only the supplied views, not their backing buffers", () => {
    const actual = Buffer.from([99, 1, 2, 3, 98]).subarray(1, 4);
    const expected = Buffer.from([97, 96, 1, 2, 3, 95]).subarray(2, 5);
    expect(() => expectExactBuffer(actual, expected)).not.toThrow();
  });

  it.each([0, 524_288, 1_048_575])("rejects a single changed byte at offset %i in a large buffer", (offset) => {
    const expected = Buffer.alloc(1_048_576, 0x80);
    const actual = Buffer.from(expected);
    actual[offset] = 0x81;
    expect(() => expectExactBuffer(actual, expected, "preview pass 2"))
      .toThrow(new Error(`preview pass 2: first byte difference at offset ${offset} (actual 0x81, expected 0x80; length 1048576)`));
  });

  it("bounds diagnostics to the first difference even when every byte differs", () => {
    expect(() => expectExactBuffer(Buffer.alloc(1_048_576, 0xff), Buffer.alloc(1_048_576)))
      .toThrow(new Error("Buffer: first byte difference at offset 0 (actual 0xff, expected 0x00; length 1048576)"));
  });
});