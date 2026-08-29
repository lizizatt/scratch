import { SimulatedHostEngine } from "@alesis/engine";
import { discoverDefaultPulseAudioDevice, FluidSynthOutput, SilentAudioOutput } from "@alesis/audio";
import { AlsaSequencerMidiSource, discoverVortexSequencerPort, SoftwareVortex } from "@alesis/midi";
import { fileURLToPath } from "node:url";
import { createControlServer } from "./control-server.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import { MetronomeScheduler } from "./metronome.js";

const engine = new SimulatedHostEngine();
const hardware = process.env.MIDI_MODE === "software" ? null : discoverVortexSequencerPort();
const midi = hardware ? new AlsaSequencerMidiSource(hardware) : new SoftwareVortex();
const pulseDevice = process.env.AUDIO_MODE === "simulated" ? null : discoverDefaultPulseAudioDevice();
const audio = pulseDevice ? new FluidSynthOutput({ device: pulseDevice }) : new SilentAudioOutput();
const loops = new MidiLoopScheduler(audio);
const disconnectMidi = midi.subscribe((event) => {
  loops.record(event, engine.snapshot());
  engine.dispatchMidi(event);
  audio.dispatchMidi(event);
});
await midi.start();
await audio.start();
await engine.execute({ type: "configure", settings: { midiInputId: midi.id, audioOutputId: audio.id } });
if (audio instanceof FluidSynthOutput) await engine.execute({ type: "select-synth", synthId: "soundfont" });
const webDirectory = fileURLToPath(new URL("../../web/dist", import.meta.url));
const server = await createControlServer(engine, Number(process.env.PORT ?? 8787), webDirectory);
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
