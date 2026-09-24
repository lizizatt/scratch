#!/usr/bin/env node
/** Relink Puppygirl so deployed park fix is live; confirm bank:store not bank:full. */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
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
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-park-verify", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const listed = await tool("list_codes", {});
  let slot = null;
  for (const c of listed.codes || []) if (/puppygirl/i.test(c.name || "")) slot = String(c.slot);

  console.log("Disconnect Puppygirl...");
  try {
    await tool("mainframe_disconnect_character", { character: "Puppygirl" });
  } catch (e) {}
  await sleep(55000);
  console.log("Link slot", slot);
  await tool("mainframe_link_character", {
    character: "Puppygirl",
    request_id: "parkfix_" + Date.now(),
    code_slot: slot,
    server: SERVER,
  });
  for (let i = 0; i < 36; i++) {
    const ch = await tool("mainframe_get_character", { character: "Puppygirl" });
    if (ch.runtime && ch.runtime.game_connected) {
      console.log("CONNECTED");
      break;
    }
    await sleep(5000);
  }

  console.log("Observe logs 90s...");
  const cut = Date.now();
  await sleep(90000);
  const logs = await tool("mainframe_get_logs", { character: "Puppygirl", limit: 100 });
  const counts = { store: 0, full: 0, stuck: 0, store_fail: 0, not_mounted: 0 };
  for (const L of logs.logs || []) {
    const line = (L.values || []).join(" ");
    const at = L.at ? Date.parse(L.at) : 0;
    if (at && at < cut - 5000) continue;
    if (/bank:store /.test(line)) counts.store++;
    if (/bank:full/.test(line)) counts.full++;
    if (/bank:park_stuck/.test(line)) counts.stuck++;
    if (/bank:store_fail/.test(line)) counts.store_fail++;
    if (/bank:not_mounted/.test(line)) counts.not_mounted++;
    if (/bank:/.test(line)) console.log(L.at, line.slice(0, 120));
  }
  console.log("counts", counts);
  fs.writeFileSync(path.join(ROOT, "_bank_park_verify.json"), JSON.stringify(counts, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
