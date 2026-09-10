#!/usr/bin/env node
"use strict";
/** Short Mainframe stability poll after interval-dedupe deploy. */
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = __dirname;
const MINUTES = Number(process.env.STABILITY_MIN || 5);
const WATCH = ["Jazwyn", "Puppygirl", "Zarook", "Sarene"];
const token = (() => {
  if (process.env.AL_MCP_TOKEN && process.env.AL_MCP_TOKEN.trim()) return process.env.AL_MCP_TOKEN.trim();
  return fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8").trim();
})();
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
      { hostname: "adventure.land", path: "/mcp", method: "POST", headers: Object.assign({}, headers, { "Content-Length": data.length }) },
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
  return JSON.parse(text);
}

async function main() {
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "al-stability", version: "1.0" } });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const t0 = Date.now();
  const samples = [];
  const failures = [];
  const codeErrs = [];

  console.log("Stability poll %sm for %s...", MINUTES, WATCH.join(", "));
  while (Date.now() - t0 < MINUTES * 60000) {
    const snap = { t: Date.now(), chars: {} };
    for (const name of WATCH) {
      const ch = await tool("mainframe_get_character", { character: name });
      const rt = ch.runtime || {};
      snap.chars[name] = {
        connected: !!rt.game_connected,
        phase: rt.phase,
        map: rt.observation && rt.observation.map,
      };
      const ev = await tool("mainframe_get_events", { character: name, limit: 15 });
      for (const e of ev.events || []) {
        if (/worker_failure|worker_restart|MAINFRAME_SESSION_FAILED/i.test((e.code || "") + (e.detail || ""))) {
          const key = name + "|" + e.at + "|" + e.code;
          if (!failures.some((f) => f.key === key)) failures.push({ key, name, at: e.at, code: e.code, detail: e.detail });
        }
      }
      const logs = await tool("mainframe_get_logs", { character: name, limit: 40 });
      for (const row of logs.logs || []) {
        const line = (row.values || []).join(" ");
        if (/ReferenceError|TypeError|SyntaxError|mtick:|tick:/i.test(line)) codeErrs.push({ name, at: row.at, line: line.slice(0, 120) });
      }
    }
    samples.push(snap);
    const j = snap.chars.Jazwyn;
    const p = snap.chars.Puppygirl;
    console.log(
      "[+%ss] J=%s/%s P=%s/%s fail=%s err=%s",
      Math.round((Date.now() - t0) / 1000),
      j.connected ? 1 : 0,
      j.phase,
      p.connected ? 1 : 0,
      p.phase,
      failures.length,
      codeErrs.length
    );
    await sleep(20000);
  }

  let connectedPct = 0;
  for (const s of samples) {
    const ok = WATCH.every((n) => s.chars[n] && s.chars[n].connected);
    if (ok) connectedPct++;
  }
  connectedPct = samples.length ? (100 * connectedPct) / samples.length : 0;

  const result = {
    minutes: MINUTES,
    samples: samples.length,
    connected_pct: connectedPct,
    worker_failures: failures,
    code_err_samples: codeErrs.slice(-20),
    pass: connectedPct >= 95 && failures.length === 0 && codeErrs.filter((e) => /ReferenceError|TypeError|SyntaxError/.test(e.line)).length === 0,
  };
  const out = path.join(ROOT, "_live_stability.json");
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ pass: result.pass, connected_pct: result.connected_pct, failures: failures.length }, null, 2));
  console.log("wrote", out);
  if (!result.pass) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
