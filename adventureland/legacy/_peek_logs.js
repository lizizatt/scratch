#!/usr/bin/env node
"use strict";
const fs = require("fs");
const https = require("https");
const path = require("path");
const token = fs.readFileSync(path.join(__dirname, ".al_mcp_token"), "utf8").trim();
let headers = {
  Authorization: "Bearer " + token,
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};
let id = 1;
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
          resolve(b ? JSON.parse(b) : {});
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
function flatten(logs) {
  return (logs || []).map((x) =>
    typeof x === "string" ? x : (x.values && x.values.join(" ")) || x.message || x.text || JSON.stringify(x)
  );
}
(async () => {
  await post({
    jsonrpc: "2.0",
    id: id++,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "logs", version: "1" } },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  for (const c of ["Jazwyn", "Sarene", "Zarook", "Puppygirl"]) {
    const r = await post({
      jsonrpc: "2.0",
      id: id++,
      method: "tools/call",
      params: { name: "mainframe_get_logs", arguments: { character: c, limit: 50 } },
    });
    const text = ((r.result && r.result.content) || []).map((x) => x.text || "").join("");
    const j = JSON.parse(text);
    const logs = flatten(j.logs);
    const re = /dlv:|LIVE_DLV|mssince|ReferenceError|Hunt |Form|cm fail|go_s|party:|deliver|Wait party|Combine|Stand|Off to/i;
    console.log("===" + c + "===");
    logs.filter((s) => re.test(String(s))).slice(-20).forEach((s) => console.log(String(s).slice(0, 220)));
    const ch = await post({
      jsonrpc: "2.0",
      id: id++,
      method: "tools/call",
      params: { name: "mainframe_get_character", arguments: { character: c } },
    });
    const ct = ((ch.result && ch.result.content) || []).map((x) => x.text || "").join("");
    const cj = JSON.parse(ct);
    const rt = cj.runtime || {};
    console.log(
      "runtime conn=" + rt.game_connected + " map=" + rt.map + " phase=" + rt.phase + " kills=" + (rt.performance && rt.performance.session && rt.performance.session.kills)
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
