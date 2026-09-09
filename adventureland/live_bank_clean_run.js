#!/usr/bin/env node
/**
 * Temporary bank clean on Puppygirl only:
 *   1) Pack code/bank_clean.js → save over Puppygirl slot (restore after)
 *   2) Relink Puppygirl, wait CLEAN:done
 *   3) deploy_mcp restore V2 merchant
 *   4) OBSERVE_MIN=5 live_observe_v2 --no-deploy (or deploy if needed for float)
 *
 * Does not touch other slots permanently. V2 slots restored via deploy_mcp.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");
const { packToBudget, assertLineBudget, MAX_LINES } = require("./tools/compress_code");

const ROOT = __dirname;
const TOKEN_FILE = path.join(ROOT, ".al_mcp_token");
const CLEAN_SRC = path.join(ROOT, "code", "bank_clean.js");
const SERVER = process.env.AL_SERVER || "US III";
const CLEAN_TIMEOUT_MS = Number(process.env.CLEAN_TIMEOUT_MS || 12 * 60 * 1000);

const token = (() => {
  if (process.env.AL_MCP_TOKEN && process.env.AL_MCP_TOKEN.trim()) return process.env.AL_MCP_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  return null;
})();
if (!token) {
  console.error("Need .al_mcp_token or AL_MCP_TOKEN");
  process.exit(1);
}

let headers = {
  Authorization: "Bearer " + token,
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};
let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(body) {
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "adventure.land",
        path: "/mcp",
        method: "POST",
        headers: Object.assign({}, headers, { "Content-Length": data.length }),
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (res.headers["mcp-session-id"]) headers["mcp-session-id"] = res.headers["mcp-session-id"];
          resolve(b ? JSON.parse(b.replace(/^\uFEFF/, "")) : {});
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function rpc(method, params) {
  const r = await post({ jsonrpc: "2.0", id: id++, method, params });
  if (r.error) throw new Error(method + ": " + JSON.stringify(r.error));
  return r.result;
}

async function tool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args || {} });
  if (result && result.isError) throw new Error(name + ": " + JSON.stringify(result));
  const text = ((result && result.content) || []).map((c) => c.text || "").join("\n");
  try {
    return JSON.parse(text);
  } catch (e) {
    return { raw: text };
  }
}

function flattenLines(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

function packCleanCode() {
  const raw = fs.readFileSync(CLEAN_SRC, "utf8");
  const out = packToBudget(flattenLines(raw), MAX_LINES, "bank_clean");
  const n = assertLineBudget(out, "bank_clean");
  console.log("bank_clean packed lines=%s chars=%s", n, out.length);
  return out;
}

function flattenLogs(raw) {
  const out = [];
  const logs = (raw && raw.logs) || (Array.isArray(raw) ? raw : []);
  for (const L of logs) {
    if (typeof L === "string") out.push(L);
    else if (L && Array.isArray(L.values)) out.push(L.values.map(String).join(" "));
    else if (L && L.message) out.push(String(L.message));
    else if (L && L.text) out.push(String(L.text));
    else if (L && L.line) out.push(String(L.line));
  }
  return out;
}

async function resolvePuppySlot() {
  const listed = await tool("list_codes", {});
  const codes = listed.codes || [];
  for (const c of codes) {
    if (/puppygirl/i.test(c.name || "")) return String(c.slot);
  }
  throw new Error("Puppygirl CODE slot not found — run deploy_mcp.js once first");
}

async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    const rt = ch.runtime || {};
    if (rt.game_connected) {
      console.log("[%s] CONNECTED msg=%s", name, rt.message || rt.status_message || "");
      return true;
    }
    console.log("[%s] waiting %s", name, rt.phase || "?");
    await sleep(5000);
  }
  return false;
}

async function waitCleanDone(cutIso) {
  const t0 = Date.now();
  const seen = new Set();
  while (Date.now() - t0 < CLEAN_TIMEOUT_MS) {
    const raw = await tool("mainframe_get_logs", { character: "Puppygirl", limit: 80 });
    const lines = flattenLogs(raw);
    for (const line of lines) {
      if (!/CLEAN:/.test(line)) continue;
      if (seen.has(line)) continue;
      // Prefer lines after cut when timestamps exist; otherwise dedupe by text.
      seen.add(line);
      console.log("  log", line.slice(0, 160));
      if (/CLEAN:done/.test(line)) return true;
      if (/CLEAN:err/.test(line)) throw new Error("clean failed: " + line);
    }
    const ch = await tool("mainframe_get_character", { character: "Puppygirl" });
    const msg = (ch.runtime && (ch.runtime.message || ch.runtime.status_message)) || "";
    if (/Clean OK/i.test(msg)) {
      console.log("  status Clean OK");
      return true;
    }
    process.stdout.write(".");
    await sleep(8000);
  }
  throw new Error("CLEAN:done timeout after " + CLEAN_TIMEOUT_MS + "ms (cut=" + cutIso + ")");
}

function restoreV2() {
  console.log("Restoring V2 via deploy_mcp.js...");
  const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8", cwd: ROOT });
  process.stdout.write(dep.stdout || "");
  process.stderr.write(dep.stderr || "");
  if (dep.status) throw new Error("deploy restore failed");
}

function observe5() {
  console.log("Observe 5m (with deploy for 100k float)...");
  const env = Object.assign({}, process.env, { OBSERVE_MIN: "5" });
  const obs = spawnSync("node", [path.join(ROOT, "live_observe_v2.js")], {
    encoding: "utf8",
    cwd: ROOT,
    env,
  });
  process.stdout.write(obs.stdout || "");
  process.stderr.write(obs.stderr || "");
  if (obs.status) throw new Error("observe failed status=" + obs.status);
}

async function main() {
  const skipObserve = process.argv.includes("--no-observe");
  const cleanOnly = process.argv.includes("--clean-only");

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-bank-clean", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const dash = await tool("mainframe_get_dashboard", {});
  console.log("dash shells=%s free_h=%s", dash.shells, dash.free_time && dash.free_time.remaining_hours);

  const slot = await resolvePuppySlot();
  const code = packCleanCode();
  console.log("Temp upload bank_clean → Puppygirl slot=%s", slot);
  await tool("save_code", { slot: String(slot), name: "Puppygirl", code });

  console.log("Disconnect Puppygirl...");
  try {
    await tool("mainframe_disconnect_character", { character: "Puppygirl" });
  } catch (e) {}
  console.log("Wait 55s auth release...");
  await sleep(55000);

  const cut = new Date().toISOString();
  console.log("Link Puppygirl slot=%s server=%s", slot, SERVER);
  await tool("mainframe_link_character", {
    character: "Puppygirl",
    request_id: "clean_" + Date.now(),
    code_slot: String(slot),
    server: SERVER,
  });

  if (!(await waitConnected("Puppygirl", 180000))) throw new Error("Puppygirl connect fail");

  console.log("Waiting CLEAN:done (timeout %sm)...", Math.round(CLEAN_TIMEOUT_MS / 60000));
  await waitCleanDone(cut);

  // Always restore merchant CODE even if later steps fail
  try {
    restoreV2();
  } catch (e) {
    console.error("RESTORE FAILED — re-run deploy_mcp.js manually:", e.message || e);
    throw e;
  }

  if (cleanOnly || skipObserve) {
    console.log("Done (skip observe). Relink party when ready.");
    return;
  }

  observe5();
  console.log("bank_clean + observe complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
