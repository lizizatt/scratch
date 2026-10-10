import { afterEach, expect, it, vi } from "vitest";
import { PcmLoopOutput } from "./loop-output.js";
import { SamplePlayer } from "./samples.js";

afterEach(() => vi.restoreAllMocks());

it("never starts an output canceled before its startup continuation", async () => {
  const start = vi.spyOn(SamplePlayer.prototype, "start").mockResolvedValue();
  vi.spyOn(SamplePlayer.prototype, "close").mockResolvedValue();
  const output = new PcmLoopOutput("null");
  const starting = output.start(Buffer.alloc(8), Buffer.alloc(1), () => {}).catch((error) => error);
  await output.close();
  await starting;
  expect(start).not.toHaveBeenCalled();
});
