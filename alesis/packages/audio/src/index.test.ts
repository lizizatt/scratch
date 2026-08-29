import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { drainFluidSynthStdout, fluidSynthArguments, fluidSynthStdio, metronomeCommands, midiEventToFluidCommand, waitForFluidSynthShell } from "./index.js";

describe("FluidSynth output", () => {
  it("maps normalized MIDI events to FluidSynth commands", () => {
    expect(midiEventToFluidCommand({ type: "note-on", channel: 2, note: 64, velocity: 111 })).toBe("noteon 2 64 111");
    expect(midiEventToFluidCommand({ type: "note-off", channel: 2, note: 64 })).toBe("noteoff 2 64");
    expect(midiEventToFluidCommand({ type: "control-change", channel: 0, controller: 64, value: 127 })).toBe("cc 0 64 127");
    expect(midiEventToFluidCommand({ type: "pitch-bend", channel: 0, value: -1 })).toBe("pitch_bend 0 0");
    expect(midiEventToFluidCommand({ type: "pitch-bend", channel: 0, value: 0 })).toBe("pitch_bend 0 8192");
    expect(midiEventToFluidCommand({ type: "pitch-bend", channel: 0, value: 1 })).toBe("pitch_bend 0 16383");
    expect(midiEventToFluidCommand({ type: "channel-pressure", channel: 0, value: 80 })).toBeNull();
  });

  it("builds an explicit PulseAudio sink invocation", () => {
    expect(fluidSynthArguments("speaker-sink", "/sounds/gm.sf2", 0.25)).toEqual([
      "-q",
      "-a", "pulseaudio",
      "-o", "audio.pulseaudio.device=speaker-sink",
      "-o", "synth.gain=0.25",
      "/sounds/gm.sf2",
    ]);
  });

  it("uses audible host gain unless explicitly overridden", () => {
    const args = fluidSynthArguments("speaker-sink", "/sounds/gm.sf2", 0.6);
    expect(args).toContain("synth.gain=0.6");
  });

  it("cannot block synthesis on unread shell output", () => {
    const stdout = new PassThrough();
    drainFluidSynthStdout(stdout);
    expect(fluidSynthStdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(stdout.readableFlowing).toBe(true);
  });

  it("waits until the FluidSynth shell consumes commands", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdin.once("data", (chunk) => {
      const token = String(chunk).match(/echo (ALESIS_READY_[^\n]+)/)?.[1];
      setTimeout(() => stdout.write(`${token}\n`), 10);
    });

    await expect(waitForFluidSynthShell(stdin, stdout, 100)).resolves.toBeUndefined();
  });

  it("maps metronome accents and level to short GM percussion notes", () => {
    expect(metronomeCommands(true, 1)).toEqual({ noteOn: "noteon 9 76 127", noteOff: "noteoff 9 76" });
    expect(metronomeCommands(false, 0.4)).toEqual({ noteOn: "noteon 9 77 51", noteOff: "noteoff 9 77" });
    expect(metronomeCommands(false, 0)).toBeNull();
  });
});
