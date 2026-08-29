import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderNeonPressureFixture, renderSoundFontFixture, sampleDifference } from "./renderers.js";

const sonicPath = "/home/liz.izatt/Downloads/STH.sf2";

describe.skipIf(!existsSync(sonicPath))("deterministic synth renderers", () => {
  it("SoundFont gain changes rendered PCM", async () => {
    const quiet = await renderSoundFontFixture(sonicPath, { gain: 0 });
    const loud = await renderSoundFontFixture(sonicPath, { gain: 1 });

    expect(sampleDifference(quiet, loud)).toBeGreaterThan(0.25);
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

  it("SoundFont chorus changes rendered PCM", async () => {
    const dry = await renderSoundFontFixture(sonicPath, { chorus: 0, reverb: 0 });
    const wet = await renderSoundFontFixture(sonicPath, { chorus: 1, reverb: 0 });

    expect(sampleDifference(dry, wet)).toBeGreaterThan(0.01);
  }, 20_000);

  it("SoundFont reverb changes rendered PCM", async () => {
    const dry = await renderSoundFontFixture(sonicPath, { chorus: 0, reverb: 0 });
    const wet = await renderSoundFontFixture(sonicPath, { chorus: 0, reverb: 1 });

    expect(sampleDifference(dry, wet)).toBeGreaterThan(0.01);
  }, 20_000);
});

describe("Neon Pressure renderer", () => {
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
