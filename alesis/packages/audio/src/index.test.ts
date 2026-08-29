import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSoundFonts, drainFluidSynthStdout, fluidSynthArguments, fluidSynthStdio, isFluidSynthRendererStalled, metronomeCommands, midiEventToFluidCommand, preferredSoundFont, soundFontParameterCommands, waitForFluidSynthShell } from "./index.js";

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

  it("recognizes renderer failures that require a fresh FluidSynth process", () => {
    expect(isFluidSynthRendererStalled("fluidsynth: warning: Ringbuffer full, try increasing synth.polyphony!")).toBe(true);
    expect(isFluidSynthRendererStalled("Failed to allocate a synthesis process. (chan=9,key=77)")).toBe(true);
    expect(isFluidSynthRendererStalled("Using PulseAudio driver")).toBe(false);
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

  it("maps metronome accents and level to short bank-agnostic notes", () => {
    expect(metronomeCommands(true, 1)).toEqual({ noteOn: "noteon 15 96 127", noteOff: "noteoff 15 96" });
    expect(metronomeCommands(false, 0.4)).toEqual({ noteOn: "noteon 15 84 51", noteOff: "noteoff 15 84" });
    expect(metronomeCommands(false, 0)).toBeNull();
  });

  it("prefers HS Synthetic Electronic, then Sonic, FluidR3, and the first available file", () => {
    const electronic = { id: "hs", name: "HS Synthetic Electronic", path: "/fonts/HS Synthetic Electronic.sf2" };
    const fluid = { id: "fluid", name: "FluidR3_GM", path: "/fonts/FluidR3_GM.sf2" };
    const sonic = { id: "sth", name: "STH", path: "/fonts/STH.sf2" };
    const piano = { id: "piano", name: "Piano", path: "/fonts/Piano.sf2" };

    expect(preferredSoundFont([piano, fluid, sonic, electronic])).toBe(electronic);
    expect(preferredSoundFont([piano, fluid, sonic])).toBe(sonic);
    expect(preferredSoundFont([piano, fluid])).toBe(fluid);
    expect(preferredSoundFont([piano])).toBe(piano);
    expect(preferredSoundFont([])).toBeNull();
  });

  it("discovers SF2 and SF3 files without exposing unrelated files", () => {
    const directory = mkdtempSync(join(tmpdir(), "alesis-soundfonts-"));
    try {
      writeFileSync(join(directory, "Sonic Bank.sf2"), "fixture");
      writeFileSync(join(directory, "Compact.sf3"), "fixture");
      writeFileSync(join(directory, "notes.txt"), "fixture");
      mkdirSync(join(directory, "nested"));
      writeFileSync(join(directory, "nested", "Strings.sf2"), "fixture");

      expect(discoverSoundFonts([directory])).toEqual([
        { id: "compact-sf3", name: "Compact", path: join(directory, "Compact.sf3") },
        { id: "sonic-bank-sf2", name: "Sonic Bank", path: join(directory, "Sonic Bank.sf2") },
        { id: "strings-sf2", name: "Strings", path: join(directory, "nested", "Strings.sf2") },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("maps every SoundFont control to real-time FluidSynth commands", () => {
    expect(soundFontParameterCommands("bank", 2, { bank: 0, program: 7 })).toContain("select 0 1 2 7");
    expect(soundFontParameterCommands("program", 7, { bank: 2, program: 0 })).toContain("select 14 1 2 7");
    expect(soundFontParameterCommands("gain", 0.72)).toEqual(["gain 0.72"]);
    expect(soundFontParameterCommands("chorus", 0.4)).toContain("cho_set_level 4");
    expect(soundFontParameterCommands("chorus", 0.4)).toContain("cc 0 93 51");
    expect(soundFontParameterCommands("chorus", 0)).toContain("chorus 0");
    expect(soundFontParameterCommands("reverb", 0.6)).toContain("rev_setlevel 0.6");
    expect(soundFontParameterCommands("reverb", 0.6)).toContain("cc 14 91 76");
    expect(soundFontParameterCommands("reverb", 0)).toContain("reverb 0");
  });

});
