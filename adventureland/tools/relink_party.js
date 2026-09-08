"use strict";
/** Relink V2 party to US III after explorers. */
const fs = require("fs");
const path = require("path");
const https = require("https");
const ROOT = path.join(__dirname, "..");
const token = fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8").trim();
const SERVER = process.env.AL_SERVER || "US III";
const ALL = ["Zarook", "Puppygirl", "Sarene", "Jazwyn"];
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
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result;
}
async function tool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args || {} });
  return JSON.parse(((result && result.content) || []).map((c) => c.text || "").join("\n"));
}
(async () => {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "relink-v2", version: "1" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});
  const listed = await tool("list_codes", {});
  const byName = {};
  for (const c of listed.codes || []) byName[(c.name || "").toLowerCase()] = c.slot;
  for (const n of ALL) {
    try {
      await tool("mainframe_disconnect_character", { character: n });
    } catch (e) {}
  }
  console.log("Wait 55s...");
  await sleep(55000);
  for (const n of ALL) {
    const slot = byName[n.toLowerCase()];
    if (!slot) throw new Error("no slot " + n);
    console.log("Link", n, slot, SERVER);
    await tool("mainframe_link_character", {
      character: n,
      request_id: "relink-" + n + "-" + Date.now(),
      code_slot: String(slot),
      server: SERVER,
    });
  }
  for (const n of ALL) {
    const t0 = Date.now();
    let ok = false;
    while (Date.now() - t0 < 180000) {
      const ch = await tool("mainframe_get_character", { character: n });
      if (ch.runtime && ch.runtime.game_connected) {
        ok = true;
        break;
      }
      await sleep(5000);
    }
    console.log(n, ok ? "CONNECTED" : "TIMEOUT");
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
