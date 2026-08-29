import { SimulatedHostEngine } from "@alesis/engine";
import { discoverDefaultPulseAudioDevice, FluidSynthOutput, SilentAudioOutput } from "@alesis/audio";
import { AlsaSequencerMidiSource, discoverVortexSequencerPort, SoftwareVortex } from "@alesis/midi";
import { fileURLToPath } from "node:url";
import { createControlServer } from "./control-server.js";
import { MetronomeScheduler } from "./metronome.js";

const engine = new SimulatedHostEngine();
const hardware = process.env.MIDI_MODE === "software" ? null : discoverVortexSequencerPort();
const midi = hardware ? new AlsaSequencerMidiSource(hardware) : new SoftwareVortex();
const pulseDevice = process.env.AUDIO_MODE === "simulated" ? null : discoverDefaultPulseAudioDevice();
const audio = pulseDevice ? new FluidSynthOutput({ device: pulseDevice }) : new SilentAudioOutput();
const disconnectMidi = midi.subscribe((event) => {
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
  metronome.update(engine.snapshot());
}, 50);
let demoNoteOn = false;
const midiDemo = midi instanceof SoftwareVortex && process.env.SOFTWARE_VORTEX_DEMO === "1"
  ? setInterval(() => {
      demoNoteOn = !demoNoteOn;
      if (demoNoteOn) midi.keyDown(60 + engine.snapshot().transport.cycle % 12, 104);
      else midi.keyUp(60 + engine.snapshot().transport.cycle % 12);
    }, 500)
  : undefined;

console.log(`Alesis control server listening on http://127.0.0.1:${server.port}`);
console.log(`MIDI input: ${midi.name} (${midi.id})`);
console.log(`Audio output: ${audio.name} (${audio.id})`);

async function shutdown(): Promise<void> {
  clearInterval(timer);
  if (midiDemo) clearInterval(midiDemo);
  disconnectMidi();
  await midi.close();
  await audio.close();
  await server.close();
  await engine.dispose();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
