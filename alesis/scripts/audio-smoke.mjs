import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

await settleAudioServer();
const { synthPeak, arpeggiatorPeak, drumPeak, neonPeak, metronomePeak } = await runProbe(8791, async (port, capturePeak) => {
  await sendCommands(port, [
    { type: "configure", settings: { bpm: 240, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false, metronomeEnabled: true, metronomeVolume: 0.25 } },
    { type: "play" },
  ]);
  await waitForSnapshot(port, (snapshot) => snapshot.transport.state === "playing" && snapshot.transport.progress >= 0.25);
  const metronomePeak = await capturePeak("FluidSynth");
  await sendCommands(port, [
    { type: "configure", settings: { metronomeEnabled: false } },
    { type: "configure-drums", settings: { enabled: true, pattern: "four-on-floor", volume: 1 } },
  ]);
  const drumPeak = await capturePeak("FluidSynth");
  await sendCommands(port, [
    { type: "stop" },
    { type: "configure-drums", settings: { enabled: false } },
    { type: "configure-arpeggiator", settings: { enabled: true, mode: "up", rate: "1/16", octaves: 2, gate: 0.5 } },
  ]);
  await waitForSnapshot(port, (snapshot) => snapshot.engine.midiEventsReceived >= 2);
  const arpeggiatorPeak = await capturePeak("FluidSynth");
  await sendCommands(port, [{ type: "configure-arpeggiator", settings: { enabled: false } }]);
  await waitForSnapshot(port, (snapshot) => snapshot.engine.midiEventsReceived >= 4);
  const synthPeak = await capturePeak("FluidSynth");
  await sendCommands(port, [{ type: "select-synth", synthId: "subtractive" }]);
  await waitForSnapshot(port, (snapshot) => snapshot.synth.selectedId === "subtractive" && snapshot.engine.midiEventsReceived >= 4);
  const neonPeak = await capturePeak("pw-cat");
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
  let closeMonitors = () => {};
  host.stdout.on("data", (chunk) => { hostOutput += String(chunk); });
  host.stderr.on("data", (chunk) => { hostOutput += String(chunk); });

  try {
    await waitUntil(() => hostOutput.includes("Audio output: System Speakers"), 5_000, () => hostOutput);
    await waitForStableProducer("FluidSynth", 1_000, 5_000);
    const monitors = createProducerMonitors();
    closeMonitors = monitors.close;
    let peaks;
    try {
      peaks = await probe(port, monitors.capturePeak);
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
    closeMonitors();
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

function createProducerMonitors() {
  const sink = execFileSync("pactl", ["get-default-sink"], { encoding: "utf8" }).trim();
  const muteState = execFileSync("pactl", ["get-sink-mute", sink], { encoding: "utf8" });
  if (/\byes\b/i.test(muteState)) throw new Error(`System speaker sink is muted: ${sink}`);
  const monitors = new Map();
  const monitorFor = (producerName) => {
    const producer = pipeWireOutputStreams().find((stream) => stream.name === producerName && stream.target === sink);
    if (!producer) throw new Error(`No ${producerName} PipeWire stream routed to ${sink}`);
    const existing = monitors.get(producerName);
    if (existing?.serial === producer.serial && existing.process.exitCode === null) return existing;
    if (existing?.process.exitCode === null) existing.process.kill("SIGTERM");
    const process = spawn("pw-record", [
      `--target=${producer.serial}`,
      "--properties=stream.capture.sink=true",
      "--rate=48000", "--channels=2", "--format=f32", "-",
    ], { stdio: ["ignore", "pipe", "ignore"] });
    const monitor = { serial: producer.serial, process, active: false, peak: 0, samples: 0 };
    process.stdout.on("data", (chunk) => {
      if (!monitor.active) return;
      for (let offset = 0; offset + 4 <= chunk.length; offset += 4) {
        monitor.peak = Math.max(monitor.peak, Math.abs(chunk.readFloatLE(offset)));
        monitor.samples += 1;
      }
    });
    monitors.set(producerName, monitor);
    return monitor;
  };
  return {
    capturePeak: async (producerName) => {
      const monitor = monitorFor(producerName);
      monitor.peak = 0;
      monitor.samples = 0;
      monitor.active = true;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      monitor.active = false;
      if (monitor.process.exitCode !== null || monitor.samples === 0) throw new Error(`No PCM frames received from ${producerName} stream`);
      return 20 * Math.log10(Math.min(1, monitor.peak));
    },
    close: () => {
      for (const monitor of monitors.values()) if (monitor.process.exitCode === null) monitor.process.kill("SIGTERM");
    },
  };
}

function pipeWireOutputStreams() {
  const nodes = JSON.parse(execFileSync("pw-dump", { encoding: "utf8" }));
  return nodes.flatMap((node) => {
    const props = node.info?.props;
    if (props?.["media.class"] !== "Stream/Output/Audio") return [];
    return [{
      serial: String(props["object.serial"]),
      name: props["node.name"] ?? props["application.name"],
      target: props["target.object"],
    }];
  });
}

async function waitForStableProducer(producerName, stableMs, timeoutMs) {
  const sink = execFileSync("pactl", ["get-default-sink"], { encoding: "utf8" }).trim();
  const started = Date.now();
  let stableSince = 0;
  let serial = null;
  while (Date.now() - started < timeoutMs) {
    const producer = pipeWireOutputStreams().find((stream) => stream.name === producerName && stream.target === sink);
    if (producer?.serial !== serial) {
      serial = producer?.serial ?? null;
      stableSince = serial ? Date.now() : 0;
    }
    if (stableSince && Date.now() - stableSince >= stableMs) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${producerName} PipeWire stream did not stabilize on ${sink}`);
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
