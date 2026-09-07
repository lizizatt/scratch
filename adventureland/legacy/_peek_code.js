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
          resolve(JSON.parse(b || "{}"));
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
(async () => {
  await post({
    jsonrpc: "2.0",
    id: id++,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "peek", version: "1" } },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  const slot = process.argv[2] || "CH_q7h90Mhg5era0mD5DBIMAKFcLp9xe";
  const r = await post({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: "get_code", arguments: { slot } } });
  const text = ((r.result && r.result.content) || []).map((c) => c.text || "").join("");
  const j = JSON.parse(text);
  let src = j.code;
  if (src && typeof src === "object") src = src.source || src.code || src.text || JSON.stringify(src);
  src = String(src);
  console.log("slot", slot, "len", src.length, "lines", src.split(/\r?\n/).length);
  console.log("head:\n" + src.slice(0, 500));
  console.log("has typeof mssince", src.includes("typeof mssince"));
  console.log("has HOME III", src.includes('HOME = ["US", "III"]') || src.includes('HOME=["US","III"]'));
  const lines = src.split(/\r?\n/);
  const ui = lines.findIndex((l) => l.includes("function use_pots"));
  console.log("use_pots line", ui, ui >= 0 ? lines[ui].slice(0, 120) : "");
  if (ui >= 0 && lines[ui + 1]) console.log("next", lines[ui + 1].slice(0, 120));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
