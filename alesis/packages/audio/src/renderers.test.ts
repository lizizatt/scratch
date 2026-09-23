import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NeonPressureSynth, renderNeonPressureFixture, renderSoundFontFixture, sampleDifference } from "./renderers.js";

const sonicPath = process.env.ALESIS_TEST_SOUNDFONT ?? join(homedir(), "Downloads", "STH.sf2");

function monoRms(samples: Float32Array, fromSeconds: number, toSeconds: number): number {
  const from = Math.round(fromSeconds * 48_000) * 2;
  const to = Math.round(toSeconds * 48_000) * 2;
  let energy = 0;
  for (let index = from; index < to; index += 2) {
    energy += ((samples[index]! + samples[index + 1]!) / 2) ** 2;
  }
  return Math.sqrt(energy / ((to - from) / 2));
}

function monoPeak(samples: Float32Array, fromSeconds: number, toSeconds: number): number {
  const from = Math.round(fromSeconds * 48_000) * 2;
  const to = Math.round(toSeconds * 48_000) * 2;
  let peak = 0;
  for (let index = from; index < to; index += 2) peak = Math.max(peak, Math.abs((samples[index]! + samples[index + 1]!) / 2));
  return peak;
}

function monoDifference(left: Float32Array, right: Float32Array): number {
  const frames = Math.min(left.length, right.length) / 2;
  let differenceEnergy = 0;
  let referenceEnergy = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const leftMono = (left[frame * 2]! + left[frame * 2 + 1]!) / 2;
    const rightMono = (right[frame * 2]! + right[frame * 2 + 1]!) / 2;
    differenceEnergy += (leftMono - rightMono) ** 2;
    referenceEnergy += Math.max(leftMono ** 2, rightMono ** 2);
  }
  return Math.sqrt(differenceEnergy / Math.max(referenceEnergy, Number.EPSILON));
}

describe.skipIf(!existsSync(sonicPath))("deterministic synth renderers", () => {
  it("preserves a decaying reverb tail after note-off through the Pi mono mix", async () => {
    const parameters = { bank: 3, program: 27, chorusSend: 0, reverbSend: 0.24, reverbRoom: 0.7 };
    const centered = await renderSoundFontFixture(sonicPath, { ...parameters, reverbWidth: 0 });
    const stereo = await renderSoundFontFixture(sonicPath, parameters);
    const dry = await renderSoundFontFixture(sonicPath, { ...parameters, reverbSend: 0 });

    // The fixture releases at 0.5 s; the Pi route averages left and right.
    const earlyTail = monoRms(stereo, 0.6, 0.7);
    expect(earlyTail).toBeGreaterThan(monoRms(centered, 0.6, 0.7) * 0.5);
    expect(earlyTail).toBeGreaterThan(monoRms(dry, 0.6, 0.7) * 10);
    expect(monoRms(stereo, 1.5, 1.6)).toBeLessThan(earlyTail * 0.3);
  }, 20_000);

  it("SoundFont gain changes rendered PCM", async () => {
    const quiet = await renderSoundFontFixture(sonicPath, { gain: 0 });
    const loud = await renderSoundFontFixture(sonicPath, { gain: 1 });

    expect(sampleDifference(quiet, loud)).toBeGreaterThan(0.25);
  }, 20_000);

  it("higher note velocity makes the initial SoundFont transient materially louder", async () => {
    const linear = await renderSoundFontFixture(sonicPath, { velocity: 72, reverbSend: 0 });
    const strong = await renderSoundFontFixture(sonicPath, { velocity: 118, reverbSend: 0 });

    expect(monoRms(strong, 0, 0.05)).toBeGreaterThan(monoRms(linear, 0, 0.05) * 1.2);
    expect(monoPeak(strong, 0, 0.05)).toBeGreaterThan(monoPeak(linear, 0, 0.05) * 1.15);
  }, 20_000);

  it("SoundFont bank changes rendered PCM", async () => {
    const minimum = await renderSoundFontFixture(sonicPath, { bank: 0, program: 56 });
    const maximum = await renderSoundFontFixture(sonicPath, { bank: 12, program: 56 });

    expect(sampleDifference(minimum, maximum)).toBeGreaterThan(0.25);
  }, 20_000);

  it("SoundFont program changes rendered PCM", async () => {
    const minimum = await renderSoundFontFixture(sonicPath, { bank: 0, program: 0 });
    const maximum = await renderSoundFontFixture(sonicPath, { bank: 0, program: 121 });

    expect(sampleDifference(minimum, maximum)).toBeGreaterThan(0.25);
  }, 20_000);

  it("SoundFont reverb send measurably changes Pi mono output", async () => {
    const dry = await renderSoundFontFixture(sonicPath, { chorusSend: 0, reverbSend: 0 });
    const wet = await renderSoundFontFixture(sonicPath, { chorusSend: 0, reverbSend: 1 });

    expect(monoDifference(dry, wet)).toBeGreaterThan(0.04);
  }, 20_000);

  for (const [name, parameterId, minimum, maximum, minimumDifference, effects] of [
    ["reverb room size", "reverbRoom", 0, 1, 0.15, { chorusSend: 0, reverbSend: 1 }],
    ["reverb damping", "reverbDamping", 0, 1, 0.02, { chorusSend: 0, reverbSend: 1 }],
    ["reverb width", "reverbWidth", 0, 1, 0.005, { chorusSend: 0, reverbSend: 1 }],
  ] as const) {
    it(`SoundFont ${name} measurably changes Pi mono output`, async () => {
      const low = await renderSoundFontFixture(sonicPath, { ...effects, [parameterId]: minimum });
      const high = await renderSoundFontFixture(sonicPath, { ...effects, [parameterId]: maximum });

      expect(monoDifference(low, high)).toBeGreaterThan(minimumDifference);
    }, 20_000);
  }
});

describe("Neon Pressure renderer", () => {
  it("holds released notes until sustain is lifted", () => {
    const synth = new NeonPressureSynth(48_000, { attack: 0.001, release: 0.001 });
    synth.dispatchMidi({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    synth.render(100);
    synth.dispatchMidi({ type: "control-change", channel: 0, controller: 64, value: 127 });
    synth.dispatchMidi({ type: "note-off", channel: 0, note: 60 });

    expect(Math.max(...synth.render(100).map(Math.abs))).toBeGreaterThan(0.01);
    synth.dispatchMidi({ type: "control-change", channel: 0, controller: 64, value: 0 });
    const released = synth.render(2_000);
    expect(Math.max(...released.slice(-200).map(Math.abs))).toBeLessThan(0.001);
  });

  it("silences held voices immediately on panic", () => {
    const synth = new NeonPressureSynth(1_000, { attack: 0.001 });
    synth.dispatchMidi({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    synth.render(100);

    synth.panic();

    expect(Math.max(...synth.render(100).map(Math.abs))).toBe(0);
  });

  it("cutoff changes rendered PCM", () => {
    const dark = renderNeonPressureFixture({ cutoff: 40 });
    const bright = renderNeonPressureFixture({ cutoff: 18_000 });

    expect(sampleDifference(dark, bright)).toBeGreaterThan(0.1);
  });

  it("resonance changes rendered PCM", () => {
    const flat = renderNeonPressureFixture({ resonance: 0 });
    const resonant = renderNeonPressureFixture({ resonance: 1 });

    expect(sampleDifference(flat, resonant)).toBeGreaterThan(0.1);
  });

  it("attack changes rendered PCM", () => {
    const immediate = renderNeonPressureFixture({ attack: 0.001 });
    const slow = renderNeonPressureFixture({ attack: 3 });

    expect(sampleDifference(immediate, slow)).toBeGreaterThan(0.1);
  });

  it("release changes rendered PCM", () => {
    const short = renderNeonPressureFixture({ release: 0.01 });
    const long = renderNeonPressureFixture({ release: 8 });

    expect(sampleDifference(short, long)).toBeGreaterThan(0.1);
  });

  it("LFO rate changes rendered PCM", () => {
    const slow = renderNeonPressureFixture({ "lfo-rate": 0.05 });
    const fast = renderNeonPressureFixture({ "lfo-rate": 20 });

    expect(sampleDifference(slow, fast)).toBeGreaterThan(0.1);
  });

  it("drive changes rendered PCM", () => {
    const clean = renderNeonPressureFixture({ drive: 0 });
    const driven = renderNeonPressureFixture({ drive: 1 });

    expect(sampleDifference(clean, driven)).toBeGreaterThan(0.1);
  });

  it.skipIf(!existsSync(sonicPath))("switching from SoundFont Player to Neon Pressure changes rendered PCM", async () => {
    const soundFont = await renderSoundFontFixture(sonicPath);
    const neon = renderNeonPressureFixture();

    expect(sampleDifference(soundFont, neon)).toBeGreaterThan(0.25);
  }, 20_000);
});
