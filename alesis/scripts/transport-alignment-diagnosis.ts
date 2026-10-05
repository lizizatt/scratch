import { SimulatedHostEngine } from "../packages/engine/src/index.js";
import { TransportPlayback } from "../apps/server/src/transport-playback.js";

// Production transport adapter, silent callbacks only: no MIDI/audio device or control socket.
async function main() {
  const bpm = 118;
  const engine = new SimulatedHostEngine();
  await engine.execute({ type: "configure", settings: { bpm, countInEnabled: true, loopMeasures: 1 } });
  await engine.execute({ type: "configure-drums", settings: { enabled: true } });
  await engine.execute({ type: "configure-arpeggiator", settings: { enabled: true, rate: "1/8", swing: 0, gate: 0.5 } });
  const hats: number[] = [], notes: number[] = [];
  const playback = new TransportPlayback(engine, {
    playDrum(note) { if (note === 42) hats.push(performance.now()); },
  }, (event) => {
    playback.advance();
    if (event.type === "note-on") notes.push(performance.now());
  });
  await engine.execute({ type: "play" });
  // Enter during count-in rather than exactly on a transport boundary.
  const entry = setTimeout(() => {
    playback.advance();
    playback.handle({ type: "note-on", channel: 0, note: 60, velocity: 100 });
  }, 73);
  const poll = setInterval(() => playback.advance(), 50);
  setTimeout(() => {
    clearTimeout(entry); clearInterval(poll); playback.dispose();
    const differences = notes.map((time) => Math.min(...hats.map((hat) => Math.abs(hat - time))));
    const intervalErrors = notes.slice(1).map((time, i) => Math.abs(time - notes[i]! - 30_000 / bpm));
    const maxOffsetMs = Math.max(...differences);
    console.log(JSON.stringify({ bpm, hats: hats.length, arpeggioNotes: notes.length,
      maxOffsetMs, maxArpeggioIntervalErrorMs: Math.max(...intervalErrors),
      offsetsAbove5ms: differences.filter((difference) => difference > 5).length }, null, 2));
    if (notes.length < 60 || hats.length !== notes.length || maxOffsetMs > 5) process.exitCode = 1;
    void engine.dispose();
  }, 20_000);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
