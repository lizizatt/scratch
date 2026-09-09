#!/usr/bin/env node
/**
 * Publish, relink Puppygirl only, sample map for ~2m, score bank-linger.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");
const { bankLingerScore } = require("./tests/test_bank_linger");

const ROOT = __dirname;
const token = (process.env.AL_MCP_TOKEN || fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8")).trim();
let headers = {
  Authorization: "Bearer " + token,
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};
let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER = process.env.AL_SERVER || "US III";

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

async function main() {
  const skipPub = process.argv.includes("--no-publish");
  if (!skipPub) {
    console.log("Publish...");
    const pub = spawnSync("node", [path.join(ROOT, "publish.js"), "--upload"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    process.stdout.write(pub.stdout || "");
    process.stderr.write(pub.stderr || "");
    if (pub.status) throw new Error("publish failed");
  }

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-bank-linger-live", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const listed = await tool("list_codes", {});
  let slot = null;
  for (const c of listed.codes || []) if (/puppygirl/i.test(c.name || "")) slot = String(c.slot);

  console.log("Disconnect/relink Puppygirl...");
  try {
    await tool("mainframe_disconnect_character", { character: "Puppygirl" });
  } catch (e) {}
  await sleep(55000);
  await tool("mainframe_link_character", {
    character: "Puppygirl",
    request_id: "linger_" + Date.now(),
    code_slot: slot,
    server: SERVER,
  });
  let connectedAt = 0;
  for (let i = 0; i < 36; i++) {
    const ch = await tool("mainframe_get_character", { character: "Puppygirl" });
    if (ch.runtime && ch.runtime.game_connected) {
      connectedAt = Date.now();
      console.log("CONNECTED");
      break;
    }
    await sleep(5000);
  }
  // Include boot logs that fire in the first seconds after connect.
  const cut = connectedAt ? connectedAt - 5000 : Date.now() - 5000;
  const samples = [];
  const minutes = Number(process.env.OBSERVE_MIN || 2);
  console.log("Sample %sm...", minutes);
  while (Date.now() - cut < minutes * 60000) {
    const ch = await tool("mainframe_get_character", { character: "Puppygirl" });
    const rt = ch.runtime || {};
    const obs = rt.observation || ch.profile || {};
    samples.push({
      t: Date.now(),
      map: obs.map,
      x: obs.x,
      y: obs.y,
      msg: rt.message || rt.status_message || "",
      connected: !!rt.game_connected,
      stand: !!(obs.shop && obs.shop.open),
      trade_n: obs.shop && obs.shop.trade_slots ? Object.keys(obs.shop.trade_slots).length : 0,
    });
    console.log(
      "[+%ss] map=%s xy=%s,%s stand=%s trades=%s msg=%s",
      Math.round((Date.now() - cut) / 1000),
      obs.map,
      obs.x != null ? Math.round(obs.x) : "?",
      obs.y != null ? Math.round(obs.y) : "?",
      obs.shop && obs.shop.open ? 1 : 0,
      obs.shop && obs.shop.trade_slots ? Object.keys(obs.shop.trade_slots).length : 0,
      (rt.message || "").slice(0, 40)
    );
    await sleep(10000);
  }

  const logs = await tool("mainframe_get_logs", { character: "Puppygirl", limit: 80 });
  const lines = [];
  for (const L of logs.logs || []) {
    const at = L.at ? Date.parse(L.at) : 0;
    if (at && at < cut - 2000) continue;
    const line = (L.values || []).join(" ");
    lines.push(line);
    if (/stall:|bank:|gear:|mtick:|dlv:/.test(line)) console.log("LOG", line.slice(0, 140));
  }

  const late = samples.slice(Math.floor(samples.length / 2));
  const linger = bankLingerScore(late);
  const stallOk =
    lines.some(
      (m) =>
        /^stall:open/.test(m) ||
        /stall:pull/.test(m) ||
        /stall:list/.test(m) ||
        /stall:no_junk_live/.test(m) ||
        /bank:prime_ok/.test(m) ||
        /bank:prime /.test(m) ||
        m === "bank:prime"
    ) || samples.some((s) => s.stand);
  // Live regression: stall:open then bank:store of the listed item = park ate the stall.
  let rebankAfterStall = false;
  let stallItem = null;
  for (const m of lines) {
    const pull = /^stall:pull (\S+)/.exec(m);
    if (pull) stallItem = pull[1];
    const open = /^stall:open/.test(m);
    if (open && !stallItem) stallItem = "*";
    if (stallItem && new RegExp("^bank:store " + (stallItem === "*" ? "\\S+" : stallItem) + "@").test(m)) {
      rebankAfterStall = true;
    }
  }
  const last = samples.length ? samples[samples.length - 1] : null;
  const stallListed = !!(last && last.stand && last.trade_n > 0);
  // Strong gate: plaza + real listing (stand open with trade slot), no linger, no re-park.
  const out = {
    at: new Date().toISOString(),
    samples: samples.length,
    late_linger: linger,
    stall_progress: stallOk,
    rebank_after_stall: rebankAfterStall,
    last_map: last && last.map,
    last_stand: last && last.stand,
    last_trade_n: last && last.trade_n,
    pass: linger < 0.5 && stallOk && !rebankAfterStall && last && last.map === "main" && stallListed,
  };
  fs.writeFileSync(path.join(ROOT, "_live_bank_linger.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!out.pass) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
