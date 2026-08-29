import { SimulatedHostEngine } from "@alesis/engine";
import { AlsaRawMidiSource, discoverVortexDevice, SoftwareVortex } from "@alesis/midi";
import { fileURLToPath } from "node:url";
import { createControlServer } from "./control-server.js";

const engine = new SimulatedHostEngine();
const hardware = process.env.MIDI_MODE === "software" ? null : discoverVortexDevice();
const midi = hardware ? new AlsaRawMidiSource(hardware) : new SoftwareVortex();
const disconnectMidi = midi.subscribe((event) => engine.dispatchMidi(event));
await midi.start();
await engine.execute({ type: "configure", settings: { midiInputId: midi.id } });
const webDirectory = fileURLToPath(new URL("../../web/dist", import.meta.url));
const server = await createControlServer(engine, Number(process.env.PORT ?? 8787), webDirectory);
const timer = setInterval(() => engine.advance(0.05), 50);
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

async function shutdown(): Promise<void> {
  clearInterval(timer);
  if (midiDemo) clearInterval(midiDemo);
  disconnectMidi();
  await midi.close();
  await server.close();
  await engine.dispose();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
