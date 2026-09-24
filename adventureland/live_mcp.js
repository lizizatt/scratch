#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = __dirname;
const TOKEN_FILE = path.join(ROOT, ".al_mcp_token");
const token = (process.env.AL_MCP_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, "utf8") : "")).trim();
if (!token) {
  console.error("Missing .al_mcp_token");
  process.exit(1);
}

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
          if (!b) return resolve({});
          try {
            resolve(JSON.parse(b.replace(/^\uFEFF/, "")));
          } catch (e) {
            resolve({ raw: b.slice(0, 2000) });
          }
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
  if (result && result.isError) throw new Error(name + " error: " + JSON.stringify(result));
  const text = ((result && result.content) || []).map((c) => c.text || "").join("\n");
  try {
    return JSON.parse(text);
  } catch (e) {
    return { raw: text, structured: result && result.structuredContent };
  }
}

async function main() {
  const cmd = process.argv[2] || "help";
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-live", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  if (cmd === "tools") {
    const listed = await rpc("tools/list", {});
    const tools = (listed && listed.tools) || [];
    for (const t of tools) {
      console.log(t.name);
      if (t.description) console.log("  " + String(t.description).slice(0, 160).replace(/\n/g, " "));
      if (t.inputSchema && t.inputSchema.properties) {
        console.log("  args: " + Object.keys(t.inputSchema.properties).join(", "));
      }
    }
    return;
  }

  if (cmd === "dash") {
    console.log(JSON.stringify(await tool("mainframe_get_dashboard", {}), null, 2));
    return;
  }

  if (cmd === "call") {
    const name = process.argv[3];
    const args = process.argv[4] ? JSON.parse(process.argv[4]) : {};
    console.log(JSON.stringify(await tool(name, args), null, 2));
    return;
  }

  console.log("Usage: node live_mcp.js tools|dash|call <tool> '{json}'");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
