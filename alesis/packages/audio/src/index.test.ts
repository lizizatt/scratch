import { describe, expect, it } from "vitest";
import { fluidSynthArguments, midiEventToFluidCommand } from "./index.js";

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
      "-a", "pulseaudio",
      "-o", "audio.pulseaudio.device=speaker-sink",
      "-o", "synth.gain=0.25",
      "/sounds/gm.sf2",
    ]);
  });
});
