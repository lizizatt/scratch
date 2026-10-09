import { DrumPlaybackScheduler } from "../apps/server/src/drum-playback.js";
import { DrumPatternScheduler } from "../apps/server/src/drum-patterns.js";
import type { EngineSnapshot } from "@alesis/protocol";

// Silent comparison of old polling versus deadline scheduling on the same host.
// This fixture only supplies fields consumed by the two drum schedulers.
const bpm = 118;
let start = 0;
const snapshot = (time: number) => {
  const position = (time - start) / (60_000 / bpm * 16);
  return {
    settings: { bpm, beatsPerMeasure: 4, loopMeasures: 4, audioOutputId: "silent-probe" },
    drums: { enabled: true, pattern: "four-on-floor", volume: 0.45 },
    pads: { selectedDrumKitId: null },
    synth: { selectedId: "soundfont", selectedSoundFontId: "probe", selectedSoundFontPresetId: "0:0" },
    transport: { state: "playing", cycle: Math.floor(position), progress: position % 1 },
  } as EngineSnapshot;
};
const oldHits: number[] = [], newHits: number[] = [];
const old = new DrumPatternScheduler();
const next = new DrumPlaybackScheduler({ playDrum(note) { if (note === 42) newHits.push(performance.now() - start); } });
function update() {
  const time = performance.now(), state = snapshot(time);
  next.update(state, time);
  for (const hit of old.update(state)) if (hit.note === 42) oldHits.push(performance.now() - start);
}
start = performance.now();
update();
const timer = setInterval(update, 50);
setTimeout(() => {
  clearInterval(timer); next.dispose();
  function summary(hits: number[]) {
    const intervals = hits.slice(1).map((time, i) => time - hits[i]!);
    const errors = intervals.map((time) => Math.abs(time - 30_000 / bpm)).sort((a, b) => a - b);
    return { hits: hits.length, minIntervalMs: Math.min(...intervals), maxIntervalMs: Math.max(...intervals),
      p99ErrorMs: errors[Math.floor(errors.length * 0.99)], maxErrorMs: Math.max(...errors),
      gapsOver10ms: errors.filter((error) => error > 10).length };
  }
  const polling = summary(oldHits), deadlines = summary(newHits);
  console.log(JSON.stringify({ bpm, expectedIntervalMs: 30_000 / bpm, polling, deadlines }, null, 2));
  if (newHits.length < 60 || deadlines.maxErrorMs > 10) process.exitCode = 1;
}, 20_000);
