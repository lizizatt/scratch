import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

await settleAudioServer();
const { synthPeak, arpeggiatorPeak, drumPeak, neonPeak, metronomePeak } = await runProbe(8791, async (port) => {
  await sendCommands(port, [
    { type: "configure", settings: { bpm: 240, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false, metronomeEnabled: true, metronomeVolume: 0.25 } },
    { type: "play" },
  ]);
  await waitForSnapshot(port, (snapshot) => snapshot.transport.state === "playing" && snapshot.transport.progress >= 0.25);
  const metronomePeak = await capturePeak();
  await sendCommands(port, [
    { type: "configure", settings: { metronomeEnabled: false } },
    { type: "configure-drums", settings: { enabled: true, pattern: "four-on-floor", volume: 1 } },
  ]);
  const drumPeak = await capturePeak();
  await sendCommands(port, [
    { type: "stop" },
    { type: "configure-drums", settings: { enabled: false } },
    { type: "configure-arpeggiator", settings: { enabled: true, mode: "up", rate: "1/16", octaves: 2, gate: 0.5 } },
  ]);
  await waitForSnapshot(port, (snapshot) => snapshot.engine.midiEventsReceived >= 2);
  const arpeggiatorPeak = await capturePeak();
  await sendCommands(port, [{ type: "configure-arpeggiator", settings: { enabled: false } }]);
  await waitForSnapshot(port, (snapshot) => snapshot.engine.midiEventsReceived >= 4);
  const synthPeak = await capturePeak();
  await sendCommands(port, [{ type: "select-synth", synthId: "subtractive" }]);
  await waitForSnapshot(port, (snapshot) => snapshot.synth.selectedId === "subtractive" && snapshot.engine.midiEventsReceived >= 4);
  const neonPeak = await capturePeak();
  await sendCommands(port, [{ type: "select-synth", synthId: "soundfont" }]);
  return { synthPeak, arpeggiatorPeak, drumPeak, neonPeak, metronomePeak };
});

console.log(`Synth peak: ${synthPeak.toFixed(1)} dB`);
console.log(`Arpeggiator peak: ${arpeggiatorPeak.toFixed(1)} dB`);
console.log(`Drum peak: ${drumPeak.toFixed(1)} dB`);
console.log(`Neon peak: ${neonPeak.toFixed(1)} dB`);
console.log(`Metronome peak: ${metronomePeak.toFixed(1)} dB`);

async function runProbe(port, probe) {
  const host = spawn("npm", ["run", "start", "--workspace", "@alesis/server"], {
    cwd: projectRoot,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      MIDI_MODE: "software",
      AUDIO_MODE: "native",
      SOFTWARE_VORTEX_DEMO: "1",
      SOFTWARE_VORTEX_DEMO_DELAY_MS: "2500",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let hostOutput = "";
  host.stdout.on("data", (chunk) => { hostOutput += String(chunk); });
  host.stderr.on("data", (chunk) => { hostOutput += String(chunk); });

  try {
    await waitUntil(() => hostOutput.includes("Audio output: System Speakers"), 5_000, () => hostOutput);
    let peaks;
    try {
      peaks = await probe(port);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nAudio host output:\n${hostOutput.trim() || "(none)"}`);
    }
    if (peaks.synthPeak <= -60) throw new Error(`Expected audible synth PCM above -60 dB, received ${peaks.synthPeak.toFixed(1)} dB`);
    if (peaks.arpeggiatorPeak <= -60) throw new Error(`Expected audible arpeggiator PCM above -60 dB, received ${peaks.arpeggiatorPeak.toFixed(1)} dB`);
    if (peaks.drumPeak <= -60) throw new Error(`Expected audible drum PCM above -60 dB, received ${peaks.drumPeak.toFixed(1)} dB`);
    if (peaks.neonPeak <= -60) throw new Error(`Expected audible Neon PCM above -60 dB, received ${peaks.neonPeak.toFixed(1)} dB`);
    if (peaks.metronomePeak <= -60) throw new Error(`Expected audible metronome PCM above -60 dB, received ${peaks.metronomePeak.toFixed(1)} dB`);
    if (/Ringbuffer full|Failed to allocate a synthesis process|FluidSynth renderer stalled|audio recovery failed/i.test(hostOutput)) {
      throw new Error(`FluidSynth saturation detected:\n${hostOutput}`);
    }
    return peaks;
  } finally {
    await stopProcess(host);
    await settleAudioServer();
  }
}

async function sendCommands(port, commands) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/control`);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const pending = new Set();
  for (const command of commands) {
    const commandId = randomUUID();
    pending.add(commandId);
    socket.send(JSON.stringify({ protocolVersion: 1, commandId, command }));
  }
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for audio-host commands")), 3_000);
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.type !== "command-result") return;
      if (!message.accepted) {
        clearTimeout(timeout);
        reject(new Error(message.error ?? "Audio-host command was rejected"));
        return;
      }
      pending.delete(message.commandId);
      if (pending.size === 0) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  socket.close();
}

async function waitForSnapshot(port, predicate) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/control`);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for audio-host state")), 3_000);
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.type === "snapshot" && predicate(message.snapshot)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.once("error", reject);
  });
  socket.close();
}

async function capturePeak() {
  const sink = execFileSync("pactl", ["get-default-sink"], { encoding: "utf8" }).trim();
  const muteState = execFileSync("pactl", ["get-sink-mute", sink], { encoding: "utf8" });
  if (/\byes\b/i.test(muteState)) throw new Error(`System speaker sink is muted: ${sink}`);
  const failures = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await capturePeakOnce(sink);
    } catch (error) {
      failures.push(error.message);
    }
  }
  throw new Error(`No PCM frames received after three attempts:\n${failures.join("\n---\n")}`);
}

async function capturePeakOnce(sink) {
  const capture = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "info",
    "-f", "pulse", "-i", `${sink}.monitor`,
    "-t", "1", "-af", "volumedetect", "-f", "null", "-",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let output = "";
  capture.stderr.on("data", (chunk) => { output += String(chunk); });
  const timeout = setTimeout(() => capture.kill("SIGKILL"), 6_000);
  const exitCode = await new Promise((resolve) => capture.once("exit", resolve));
  clearTimeout(timeout);
  const match = output.match(/max_volume:\s*(-?[\d.]+) dB/);
  if (exitCode !== 0 || !match) throw new Error(`No PCM frames received from speaker monitor:\n${output}`);
  return Number(match[1]);
}

async function waitUntil(predicate, timeoutMs, details) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error(`Timed out waiting for audio host:\n${details()}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  signalProcessGroup(child.pid, "SIGTERM");
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const timeout = new Promise((resolve) => setTimeout(resolve, 2_000, "timeout"));
  if (await Promise.race([exited, timeout]) === "timeout") signalProcessGroup(child.pid, "SIGKILL");
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function settleAudioServer() {
  await new Promise((resolve) => setTimeout(resolve, 750));
}
