// Pi-only: plays silence through additional dmix clients, not an audible latency test.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = await readFile(new URL("../deploy/asoundrc", import.meta.url), "utf8");
if ((source.match(/type dmix/g) ?? []).length !== 1 || !source.includes("pcm.alesis_cm108_dmix")) {
  throw new Error("Unexpected ALSA configuration; review diagnostic before running");
}
const directory = await mkdtemp(join(tmpdir(), "alesis-alignment-"));
const results = { no: [], rounddown: [] };
try {
  const configPath = join(directory, "asound.conf");
  const aliases = Object.keys(results).map((alignment) => source
    .replaceAll("alesis_cm108", `alesis_diag_${alignment}`)
    .replace(/^\s*hw_ptr_alignment\s+\S+\s*$/m, "")
    .replace("type dmix", `type dmix\n  hw_ptr_alignment ${alignment}`));
  await writeFile(configPath, `</usr/share/alsa/alsa.conf>\n${aliases.join("\n")}`);
  for (let run = 0; run < 40; run += 1) {
    const alignment = run % 2 ? "rounddown" : "no";
    const child = spawn("aplay", [
      "-q", "-D", `alesis_diag_${alignment}`, "-t", "raw", "-f", "S16_LE",
      "-r", "48000", "-c", "2", "--period-size=512", "--buffer-size=1024",
    ], { env: { ...process.env, ALSA_CONFIG_PATH: configPath }, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    let timedOut = false;
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-65536); });
    child.stdin.on("error", () => {});
    const deadline = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 5000);
    const started = performance.now();
    let code;
    let signal;
    try {
      const closed = once(child, "close");
      child.stdin.end(Buffer.alloc(48000 * 4));
      [code, signal] = await closed;
    } finally {
      clearTimeout(deadline);
    }
    if (timedOut || code !== 0) throw new Error(`aplay failed (${timedOut ? "timeout" : signal ?? code}): ${stderr}`);
    const underruns = (stderr.match(/underrun!!!/g) ?? []).length;
    results[alignment].push(underruns);
    console.log(JSON.stringify({ run, alignment, underruns, elapsedMs: performance.now() - started }));
  }
  const baselineReproduced = results.no.some((count) => count > 0);
  const candidateClean = results.rounddown.every((count) => count === 0);
  const verdict = !candidateClean ? "candidate-failed" : baselineReproduced ? "candidate-passed" : "inconclusive-no-baseline-xrun";
  console.log(JSON.stringify({ verdict, results }));
  process.exitCode = verdict === "candidate-passed" ? 0 : 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
