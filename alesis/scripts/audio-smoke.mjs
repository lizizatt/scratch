import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const synthPeak = await runProbe(8791, true, async (port) => {
  await waitForSnapshot(port, (snapshot) => snapshot.engine.midiEventsReceived > 0);
});
const metronomePeak = await runProbe(8792, false, async (port) => {
  await sendCommands(port, [
    { type: "configure", settings: { bpm: 240, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false, metronomeEnabled: true, metronomeVolume: 1 } },
    { type: "play" },
  ]);
  await waitForSnapshot(port, (snapshot) => snapshot.transport.state === "playing");
});

console.log(`Synth peak: ${synthPeak.toFixed(1)} dB`);
console.log(`Metronome peak: ${metronomePeak.toFixed(1)} dB`);

async function runProbe(port, softwareDemo, afterStart) {
  const host = spawn("npm", ["run", "start", "--workspace", "@alesis/server"], {
    cwd: projectRoot,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      MIDI_MODE: "software",
      AUDIO_MODE: "native",
      SOFTWARE_VORTEX_DEMO: softwareDemo ? "1" : "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let hostOutput = "";
  host.stdout.on("data", (chunk) => { hostOutput += String(chunk); });
  host.stderr.on("data", (chunk) => { hostOutput += String(chunk); });

  try {
    await waitUntil(() => hostOutput.includes("Audio output: System Speakers"), 5_000, () => hostOutput);
    await afterStart?.(port);
    const peak = await capturePeak();
    if (peak <= -60) throw new Error(`Expected audible PCM above -60 dB, received ${peak.toFixed(1)} dB`);
    if (/Ringbuffer full|Failed to allocate a synthesis process/.test(hostOutput)) {
      throw new Error(`FluidSynth saturation detected:\n${hostOutput}`);
    }
    return peak;
  } finally {
    await stopProcess(host);
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
