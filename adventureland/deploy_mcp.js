#!/usr/bin/env node
/**
 * Deploy V2 dist/*.js into Adventure Land CODE slots via MCP.
 * Auth: adventureland/.al_mcp_token or AL_MCP_TOKEN
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const TOKEN_FILE = path.join(ROOT, ".al_mcp_token");
const DIST = path.join(ROOT, "dist");

const UPLOADS = [
  { file: "v2_lib.js", name: "v2_lib", match: /^v2_lib$/i },
  { file: "v2_fighter.js", name: "v2_fighter", match: /^v2_fighter$/i },
  { file: "v2_merchant.js", name: "v2_merchant", match: /^v2_merchant$/i },
  { file: "warrior.js", name: "Jazwyn", match: /jazwyn/i },
  { file: "mage.js", name: "Sarene", match: /sarene/i },
  { file: "priest.js", name: "Zarook", match: /zarook/i },
  { file: "merchant.js", name: "Puppygirl", match: /puppygirl/i },
];

function readToken() {
  if (process.env.AL_MCP_TOKEN && process.env.AL_MCP_TOKEN.trim()) return process.env.AL_MCP_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  return null;
}

function httpJson(method, body, headers) {
  const data = body == null ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "adventure.land",
        path: "/mcp",
        method,
        headers: Object.assign(
          {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
          },
          headers || {},
          data ? { "Content-Length": data.length } : {}
        ),
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          const sid = res.headers["mcp-session-id"];
          if (!buf) return resolve({ status: res.statusCode, sid, body: "" });
          resolve({ status: res.statusCode, sid, body: buf });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const token = readToken();
  if (!token) {
    console.error("Missing adventureland/.al_mcp_token (or AL_MCP_TOKEN).");
    process.exit(1);
  }

  console.log("Building dist...");
  const built = spawnSync("node", [path.join(ROOT, "tools/compress_code.js")], { encoding: "utf8" });
  process.stdout.write(built.stdout || "");
  if (built.status) {
    process.stderr.write(built.stderr || "");
    throw new Error("compress failed");
  }

  const headers = { Authorization: "Bearer " + token };
  let id = 1;

  async function rpc(method, params) {
    const r = await httpJson("POST", { jsonrpc: "2.0", id: id++, method, params }, headers);
    if (r.sid) headers["mcp-session-id"] = r.sid;
    let parsed;
    try {
      parsed = JSON.parse(r.body.replace(/^\uFEFF/, ""));
    } catch (e) {
      throw new Error("bad json: " + r.body.slice(0, 200));
    }
    if (parsed.error) throw new Error(method + ": " + JSON.stringify(parsed.error));
    return parsed.result;
  }

  async function tool(name, args) {
    const result = await rpc("tools/call", { name, arguments: args || {} });
    if (result.isError) throw new Error(name + " error: " + JSON.stringify(result));
    const text = (result.content || []).map((c) => c.text || "").join("\n");
    try {
      return JSON.parse(text);
    } catch (e) {
      return { raw: text, structured: result.structuredContent };
    }
  }

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-deploy-v2", version: "2.0" },
  });
  await httpJson("POST", { jsonrpc: "2.0", method: "notifications/initialized" }, headers).catch(() => {});

  console.log("Reading dashboard...");
  const dash = await tool("mainframe_get_dashboard", {});
  console.log(
    "online=%s shells=%s free=%s",
    dash.online,
    dash.shells,
    dash.free_time && dash.free_time.remaining_hours
  );

  console.log("Listing CODE slots...");
  const listed = await tool("list_codes", {});
  const slots = listed.codes || [];
  for (const s of slots) console.log("  slot=%s name=%s", s.slot, s.name);

  function usedSlots() {
    const used = new Set();
    for (const s of slots) used.add(String(s.slot));
    return used;
  }

  function nextFreeSlot() {
    const used = usedSlots();
    for (let i = 1; i <= 100; i++) if (!used.has(String(i))) return String(i);
    throw new Error("No free CODE slot (1-100)");
  }

  function findSlot(upload) {
    const hit = slots.find((s) => upload.match.test(s.name || ""));
    if (hit) return hit;
    const slot = nextFreeSlot();
    const created = { slot, name: upload.name };
    slots.push(created);
    console.log("  allocating new slot=%s name=%s", slot, upload.name);
    return created;
  }

  let failed = 0;
  for (const u of UPLOADS) {
    const filePath = path.join(DIST, u.file);
    if (!fs.existsSync(filePath)) {
      console.error("missing " + filePath);
      failed++;
      continue;
    }
    const code = fs.readFileSync(filePath, "utf8");
    const lines = code.replace(/\s+$/, "").split(/\r?\n/).filter(Boolean).length;
    if (lines > 176) {
      console.error("FAIL %s lines=%s", u.file, lines);
      failed++;
      continue;
    }
    const target = findSlot(u);
    console.log("Saving %s → slot=%s name=%s lines=%s", u.file, target.slot, u.name, lines);
    try {
      await tool("save_code", { slot: String(target.slot), name: u.name, code });
      target.name = u.name;
    } catch (e) {
      console.error("  save failed:", e.message || e);
      failed++;
    }
  }

  if (failed) {
    console.error("Deploy finished with %s failures", failed);
    process.exit(1);
  }
  console.log("Deploy OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
