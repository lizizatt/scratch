import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alsaPlaybackArguments, auxiliaryPercussionSelectionCommands, discoverCm108AudioDevice, discoverSoundFonts, drainFluidSynthStdout, drumCommands, FLUIDSYNTH_READY_TIMEOUT_MS, FluidSynthOutput, fluidSynthArguments, fluidSynthStdio, isFluidSynthRendererStalled, metronomeCommands, midiEventToFluidCommand, parseSoundFontPresets, preferredSoundFont, soundFontInitializationCommands, soundFontParameterCommands, stereoFloatToDualMonoS16, waitForFluidSynthShell } from "./index.js";

describe("FluidSynth output", () => {
  it("discovers the first CM108 playback device by USB identity and ALSA name", () => {
    const asoundRoot = mkdtempSync(join(tmpdir(), "alesis-asound-test-"));
    const deviceRoot = mkdtempSync(join(tmpdir(), "alesis-snd-test-"));
    try {
      for (const [card, id, usbId, name] of [
        ["card2", "Headphones", "", "bcm2835 Headphones"],
        ["card3", "Device", "0d8c:013c", "USB Audio"],
        ["card5", "Device_1", "0d8c:013c", "USB Audio"],
      ] as const) {
        mkdirSync(join(asoundRoot, card));
        writeFileSync(join(asoundRoot, card, "id"), `${id}\n`);
        writeFileSync(join(asoundRoot, card, "usbid"), `${usbId}\n`);
        mkdirSync(join(asoundRoot, card, "pcm0p"));
        writeFileSync(join(asoundRoot, card, "pcm0p", "info"), `name: ${name}\n`);
        writeFileSync(join(deviceRoot, `pcmC${card.slice(4)}D0p`), "");
      }

      expect(discoverCm108AudioDevice(asoundRoot, deviceRoot)).toEqual({
        id: "alsa:Device",
        name: "USB Audio",
        usbId: "0d8c:013c",
        cardId: "Device",
        pcm: "alesis_cm108",
      });
    } finally {
      rmSync(asoundRoot, { recursive: true, force: true });
      rmSync(deviceRoot, { recursive: true, force: true });
    }
  });

  it("maps normalized MIDI events to FluidSynth commands", () => {
    expect(midiEventToFluidCommand({ type: "note-on", channel: 2, note: 64, velocity: 111 })).toBe("noteon 2 64 111");
    expect(midiEventToFluidCommand({ type: "note-off", channel: 2, note: 64 })).toBe("noteoff 2 64");
    expect(midiEventToFluidCommand({ type: "control-change", channel: 0, controller: 64, value: 127 })).toBe("cc 0 64 127");
    expect(midiEventToFluidCommand({ type: "pitch-bend", channel: 0, value: -1 })).toBe("pitch_bend 0 0");
    expect(midiEventToFluidCommand({ type: "pitch-bend", channel: 0, value: 0 })).toBe("pitch_bend 0 8192");
    expect(midiEventToFluidCommand({ type: "pitch-bend", channel: 0, value: 1 })).toBe("pitch_bend 0 16383");
    expect(midiEventToFluidCommand({ type: "channel-pressure", channel: 0, value: 80 })).toBeNull();
  });

  it("panics every MIDI channel before accepting performance input", () => {
    const commands: string[] = [];
    const output = new FluidSynthOutput({ device: { id: "test", name: "Test", pcm: "test" }, commandObserver: (command) => commands.push(command) });

    output.panic();

    for (let channel = 0; channel < 16; channel += 1) {
      expect(commands).toContain(`cc ${channel} 64 0`);
      expect(commands).toContain(`cc ${channel} 120 0`);
      expect(commands).toContain(`cc ${channel} 121 0`);
      expect(commands).toContain(`cc ${channel} 123 0`);
      expect(commands).toContain(`pitch_bend ${channel} 8192`);
    }
  });

  it("builds an explicit direct ALSA invocation with conservative buffering", () => {
    expect(fluidSynthArguments("alesis_cm108", "/sounds/gm.sf2", 0.25)).toEqual([
      "-q",
      "-a", "alsa",
      "-o", "audio.alsa.device=alesis_cm108",
      "-r", "48000",
      "-z", "512",
      "-c", "2",
      "-o", "midi.autoconnect=0",
      "-o", "synth.gain=0.25",
      "/sounds/gm.sf2",
    ]);
  });

  it("converts stereo float samples to clipped 16-bit dual mono", () => {
    const converted = stereoFloatToDualMonoS16(new Float32Array([
      1, 0,
      -1, 0,
      1, 1,
    ]));

    expect(Array.from({ length: 6 }, (_, index) => converted.readInt16LE(index * 2))).toEqual([
      16_384, 16_384,
      -16_383, -16_383,
      32_767, 32_767,
    ]);
  });

  it("builds an explicit direct ALSA playback invocation for Neon Pressure", () => {
    expect(alsaPlaybackArguments("alesis_cm108")).toEqual([
      "-q",
      "-D", "alesis_cm108",
      "-t", "raw",
      "-f", "S16_LE",
      "-r", "48000",
      "-c", "2",
      "--period-size=512",
      "--buffer-size=1024",
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
    expect(isFluidSynthRendererStalled("Using ALSA driver")).toBe(false);
  });

  it("waits until the FluidSynth shell consumes commands", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdin.once("data", (chunk) => {
      const token = String(chunk).match(/echo (ALESIS_READY_[^\n]+)/)?.[1];
      setTimeout(() => stdout.write(`${token}\n`), 10);
    });

    await expect(waitForFluidSynthShell(stdin, stdout, 100)).resolves.toBeUndefined();
    expect(FLUIDSYNTH_READY_TIMEOUT_MS).toBe(30_000);
  });

  it("maps metronome accents and level to short bank-agnostic notes", () => {
    expect(metronomeCommands(true, 1)).toEqual({ noteOn: "noteon 15 76 127", noteOff: "noteoff 15 76" });
    expect(metronomeCommands(false, 0.25)).toEqual({ noteOn: "noteon 15 77 64", noteOff: "noteoff 15 77" });
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
    expect(soundFontParameterCommands("gain", 0.72)).toEqual(["gain 0.72"]);
    expect(soundFontParameterCommands("chorus-send", 0.5)).toContain("cc 0 93 64");
    expect(soundFontParameterCommands("chorus-rate", 1.2)).toEqual(["cho_set_speed 1.2"]);
    expect(soundFontParameterCommands("chorus-depth", 12)).toEqual(["cho_set_depth 12"]);
    expect(soundFontParameterCommands("chorus-voices", 4)).toEqual(["cho_set_nr 4"]);
    expect(soundFontParameterCommands("reverb-send", 0.5)).toContain("cc 14 91 64");
    expect(soundFontParameterCommands("reverb-room", 0.7)).toEqual(["rev_setroomsize 0.7"]);
    expect(soundFontParameterCommands("reverb-damping", 0.4)).toEqual(["rev_setdamp 0.4"]);
    expect(soundFontParameterCommands("reverb-width", 0.6)).toEqual(["rev_setwidth 60"]);
    expect(soundFontParameterCommands("chorus-send", 0)).toContain("chorus 0");
    expect(soundFontParameterCommands("reverb-send", 0)).toContain("reverb 0");
    expect(() => soundFontParameterCommands("chorus-send", 0.6)).toThrow(/out of range/);
    expect(() => soundFontParameterCommands("reverb-width", 2)).toThrow(/out of range/);
  });

  it("initializes every performance channel and all semantic effects", () => {
    const commands = soundFontInitializationCommands({
      bank: 0, program: 0, gain: 0.72,
      "chorus-send": 0.12, "reverb-send": 0.24,
      "chorus-rate": 0.3, "chorus-depth": 8, "chorus-voices": 3,
      "reverb-room": 0.2, "reverb-damping": 0, "reverb-width": 0.5,
    });
    const channels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14];
    expect(commands.filter((command) => command.startsWith("select "))).toHaveLength(14);
    for (const channel of channels) {
      expect(commands).toContain(`cc ${channel} 93 15`);
      expect(commands).toContain(`cc ${channel} 91 30`);
    }
    expect(commands.some((command) => command.startsWith("cc 9 "))).toBe(false);
    expect(commands.indexOf("gain 0.72")).toBeLessThan(commands.indexOf("cho_set_speed 0.3"));
    expect(auxiliaryPercussionSelectionCommands(true)).toEqual(["select 9 2 128 0", "select 15 2 128 0"]);
    expect(auxiliaryPercussionSelectionCommands(false)).toEqual(["select 9 1 128 0", "select 15 1 128 0"]);
  });

  it("releases each public drum hit after 80 milliseconds", () => {
    vi.useFakeTimers();
    try {
      const commands: string[] = [];
      const output = new FluidSynthOutput({ device: { id: "test", name: "Test", pcm: "test" }, commandObserver: (command) => commands.push(command) });
      output.playDrum(36, 100);
      expect(commands).toEqual(["noteon 9 36 100"]);
      vi.advanceTimersByTime(79);
      expect(commands).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(commands).toEqual(["noteon 9 36 100", "noteoff 9 36"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps public drum notes and velocities to the MIDI domain", () => {
    expect(drumCommands(200, 300)).toEqual({ noteOn: "noteon 9 127 127", noteOff: "noteoff 9 127" });
    expect(drumCommands(-1, 0)).toEqual({ noteOn: "noteon 9 0 1", noteOff: "noteoff 9 0" });
  });

  it("parses named bank/program presets from FluidSynth output", () => {
    expect(parseSoundFontPresets("000-000 Solar Winds (Pad)\n0-035 Computer Game Piano\n1200-056 S3 BPZ2P Trumpet\n20000-001 Invalid Bank\n000-128 Invalid Program\n> quit\n")).toEqual([
      { id: "0:0", bank: 0, program: 0, name: "Solar Winds (Pad)" },
      { id: "0:35", bank: 0, program: 35, name: "Computer Game Piano" },
      { id: "1200:56", bank: 1200, program: 56, name: "S3 BPZ2P Trumpet" },
    ]);
  });

});
