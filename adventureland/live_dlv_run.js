#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = __dirname;
const token = fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8").trim();
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

function flattenLogs(logs) {
  return ((logs && logs.logs) || []).map((x) =>
    typeof x === "string" ? x : (x.message || x.text || x.line || (x.values && x.values.join(" ")) || JSON.stringify(x))
  );
}

const SLOTS = {
  Jazwyn: "CH_xOVr1MS2DN8qlv1ntZ0VB1IEy3Sp9",
  Sarene: "CH_0EquGf0dJfIrmvKmlb5pa6KfSITh3",
  Zarook: "CH_d4UbsANUGP3e4HGOB2DrwV3uLyeLz",
  Puppygirl: "CH_q7h90Mhg5era0mD5DBIMAKFcLp9xe",
};
const ORDER = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];

async function disconnectAll() {
  for (const c of ORDER) {
    try {
      const r = await tool("mainframe_disconnect_character", { character: c });
      console.log("disconnect", c, r.success || r.queued || true);
    } catch (e) {
      console.log("disconnect", c, e.message.slice(0, 120));
    }
  }
}

async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    const rt = ch.runtime || {};
    if (rt.game_connected) {
      console.log("[%s] CONNECTED map=%s", name, rt.map);
      return true;
    }
    console.log("[%s] waiting phase=%s", name, rt.phase);
    await sleep(6000);
  }
  return false;
}

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-live5", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  console.log("Reload CODE via disconnect/relink...");
  await disconnectAll();
  console.log("Waiting 45s for auth release...");
  await sleep(45000);

  const stamp = Date.now();
  for (const c of ORDER) {
    const r = await tool("mainframe_link_character", {
      character: c,
      request_id: "live5-" + c + "-" + stamp,
      code_slot: SLOTS[c],
      server: "US III",
    });
    console.log("link", c, r.success, r.queued);
    await waitConnected(c, 150000);
    await sleep(4000);
  }

  const seen = {};
  let dlvOk = false;
  let farming = false;
  const deadline = Date.now() + 18 * 60 * 1000;

  while (Date.now() < deadline) {
    let up = 0;
    for (const c of ORDER) {
      const ch = await tool("mainframe_get_character", { character: c });
      const rt = ch.runtime;
      if (rt && rt.game_connected) up++;
      if (rt && rt.performance && rt.performance.session && (rt.performance.session.kills > 0 || rt.performance.session.xp_gained > 0))
        farming = true;
      const sources = [flattenLogs({ logs: (rt && rt.logs) || [] }), flattenLogs(await tool("mainframe_get_logs", { character: c, limit: 80 }))];
      for (const lines of sources) {
        for (const line of lines) {
          const s = String(line);
          const sk = c + "|" + s;
          if (seen[sk]) continue;
          seen[sk] = 1;
          if (/dlv:|LIVE_DLV|party:|go_s:|Form|Hunt |Wait party|cm fail|Off to |Hold|ReferenceError|TypeError|Dlv |hop /i.test(s))
            console.log("[%s] %s", c, s.slice(0, 280));
          if (/LIVE_DLV_OK|dlv:done id=.* ok=1/.test(s)) dlvOk = true;
          if (/Hunt |Form|Off to /.test(s)) farming = true;
        }
      }
    }
    console.log("--- up=%s/4 dlvOk=%s farming=%s ---", up, dlvOk, farming);
    if (dlvOk && farming) break;
    await sleep(12000);
  }

  fs.writeFileSync(path.join(ROOT, "_live_result.json"), JSON.stringify({ dlvOk, farming, at: new Date().toISOString() }, null, 2));
  if (!dlvOk) {
    console.error("FAIL: no successful potion delivery");
    process.exit(2);
  }
  console.log("SUCCESS potion delivery; farming=%s", farming);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
