import { SimulatedHostEngine } from "@alesis/engine";
import { discoverDefaultPulseAudioDevice, discoverSoundFonts, FluidSynthOutput, preferredSoundFont, SilentAudioOutput } from "@alesis/audio";
import { AlsaSequencerMidiSource, discoverVortexSequencerPort, SoftwareVortex } from "@alesis/midi";
import type { EngineCommand } from "@alesis/protocol";
import { fileURLToPath } from "node:url";
import { createControlServer } from "./control-server.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import { MetronomeScheduler } from "./metronome.js";

let soundFonts = discoverSoundFonts();
const defaultSoundFont = preferredSoundFont(soundFonts);
let soundFontsById = new Map(soundFonts.map((soundFont) => [soundFont.id, soundFont]));
const engine = new SimulatedHostEngine({
  soundFonts: soundFonts.map(({ id, name }) => ({ id, name })),
  ...(defaultSoundFont ? { selectedSoundFontId: defaultSoundFont.id } : {}),
});
const hardware = process.env.MIDI_MODE === "software" ? null : discoverVortexSequencerPort();
const midi = hardware ? new AlsaSequencerMidiSource(hardware) : new SoftwareVortex();
const pulseDevice = process.env.AUDIO_MODE === "simulated" ? null : discoverDefaultPulseAudioDevice();
const audio = pulseDevice
  ? new FluidSynthOutput({ device: pulseDevice, ...(defaultSoundFont ? { soundFontPath: defaultSoundFont.path } : {}) })
  : new SilentAudioOutput();
const loops = new MidiLoopScheduler(audio);
const disconnectMidi = midi.subscribe((event) => {
  loops.record(event, engine.snapshot());
  engine.dispatchMidi(event);
  audio.dispatchMidi(event);
});
await midi.start();
await audio.start();
await engine.execute({ type: "configure", settings: { midiInputId: midi.id, audioOutputId: audio.id } });
if (audio instanceof FluidSynthOutput) {
  await engine.execute({ type: "select-synth", synthId: "soundfont" });
  for (const parameter of engine.snapshot().synth.parameters) audio.setSynthParameter("soundfont", parameter.id, parameter.value);
}
const webDirectory = fileURLToPath(new URL("../../web/dist", import.meta.url));
const executeCommand = async (command: EngineCommand) => {
  if (command.type === "select-synth") {
    if (!engine.snapshot().synth.available.some(({ id }) => id === command.synthId)) return engine.execute(command);
    try {
      await audio.selectSynth(command.synthId);
    } catch (error) {
      const snapshot = engine.snapshot();
      return { accepted: false, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle, error: `Unable to select synth: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  if (command.type === "refresh-soundfonts") {
    const refreshed = discoverSoundFonts();
    const currentId = engine.snapshot().synth.selectedSoundFontId;
    const selected = refreshed.find(({ id }) => id === currentId) ?? preferredSoundFont(refreshed);
    if (selected && selected.id !== currentId) {
      try {
        await audio.loadSoundFont(selected.path);
      } catch (error) {
        const snapshot = engine.snapshot();
        return {
          accepted: false,
          revision: snapshot.revision,
          appliedCycle: snapshot.transport.cycle,
          error: `Unable to load SoundFont: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    soundFonts = refreshed;
    soundFontsById = new Map(soundFonts.map((soundFont) => [soundFont.id, soundFont]));
    return engine.replaceSoundFonts(soundFonts.map(({ id, name }) => ({ id, name })), selected?.id ?? null);
  }
  if (command.type === "select-soundfont") {
    const soundFont = soundFontsById.get(command.soundFontId);
    if (!soundFont) return engine.execute(command);
    try {
      await audio.loadSoundFont(soundFont.path);
    } catch (error) {
      const snapshot = engine.snapshot();
      return {
        accepted: false,
        revision: snapshot.revision,
        appliedCycle: snapshot.transport.cycle,
        error: `Unable to load SoundFont: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (command.type === "set-synth-parameter" && engine.snapshot().synth.selectedId === "soundfont") {
    const parameter = engine.snapshot().synth.parameters.find(({ id }) => id === command.parameterId);
    if (!parameter || command.value < parameter.minimum || command.value > parameter.maximum) return engine.execute(command);
    try {
      audio.setSynthParameter("soundfont", command.parameterId, command.value);
    } catch (error) {
      const snapshot = engine.snapshot();
      return {
        accepted: false,
        revision: snapshot.revision,
        appliedCycle: snapshot.transport.cycle,
        error: `Unable to set SoundFont parameter: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (command.type === "set-synth-parameter" && engine.snapshot().synth.selectedId === "subtractive") {
    const parameter = engine.snapshot().synth.parameters.find(({ id }) => id === command.parameterId);
    if (!parameter || command.value < parameter.minimum || command.value > parameter.maximum) return engine.execute(command);
    audio.setSynthParameter("subtractive", command.parameterId, command.value);
  }
  return engine.execute(command);
};
const server = await createControlServer(engine, Number(process.env.PORT ?? 8787), webDirectory, executeCommand);
const metronome = new MetronomeScheduler(audio);
const timer = setInterval(() => {
  engine.advance(0.05);
  const snapshot = engine.snapshot();
  loops.update(snapshot);
  metronome.update(snapshot);
}, 50);
let demoNoteOn = false;
let demoNote = 60;
let midiDemo: ReturnType<typeof setInterval> | undefined;
const softwareMidi = midi instanceof SoftwareVortex ? midi : null;
const startMidiDemo = (): void => {
  if (!softwareMidi) return;
  midiDemo = setInterval(() => {
      demoNoteOn = !demoNoteOn;
      if (demoNoteOn) {
        demoNote = 60 + engine.snapshot().transport.cycle % 12;
        softwareMidi.keyDown(demoNote, 104);
      } else {
        softwareMidi.keyUp(demoNote);
      }
    }, 500);
};
const midiDemoStart = softwareMidi && process.env.SOFTWARE_VORTEX_DEMO === "1"
  ? setTimeout(startMidiDemo, Number(process.env.SOFTWARE_VORTEX_DEMO_DELAY_MS ?? 0))
  : undefined;

console.log(`Alesis control server listening on http://127.0.0.1:${server.port}`);
console.log(`MIDI input: ${midi.name} (${midi.id})`);
console.log(`Audio output: ${audio.name} (${audio.id})`);
console.log(`SoundFont: ${defaultSoundFont?.name ?? "none"}${defaultSoundFont ? ` (${defaultSoundFont.path})` : ""}`);

async function shutdown(): Promise<void> {
  clearInterval(timer);
  if (midiDemoStart) clearTimeout(midiDemoStart);
  if (midiDemo) clearInterval(midiDemo);
  disconnectMidi();
  await midi.close();
  await audio.close();
  await server.close();
  await engine.dispose();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
