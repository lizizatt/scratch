#!/usr/bin/env node
/**
 * Deploy local adventureland/*.js into the account CODE slots via Adventure Land MCP.
 *
 * Auth: adventureland/.al_mcp_token  (Bearer token from Mainframe → Connect an AI)
 *    or env AL_MCP_TOKEN
 *
 * Usage: node adventureland/deploy_mcp.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = __dirname;
const TOKEN_FILE = path.join(ROOT, ".al_mcp_token");

const UPLOADS = [
  { file: "warrior.js", name: "Jazwyn", match: /jazwyn/i },
  { file: "mage.js", name: "Sarene", match: /sarene/i },
  { file: "priest.js", name: "Zarook", match: /zarook/i },
  { file: "merchant.js", name: "Puppygirl", match: /puppygirl/i },
  { file: "merchant_plan.js", name: "merchant_plan", match: /merchant_plan/i },
  { file: "merchant_ponty.js", name: "merchant_ponty", match: /merchant_ponty/i },
  { file: "merchant_ops.js", name: "merchant_ops", match: /merchant_ops/i },
  { file: "merchant_craft.js", name: "merchant_craft", match: /merchant_craft/i },
  { file: "merchant_combine.js", name: "merchant_combine", match: /merchant_combine/i },
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
  const headers = { Authorization: "Bearer " + token };
  let id = 1;

  async function rpc(method, params) {
    const r = await httpJson(
      "POST",
      { jsonrpc: "2.0", id: id++, method, params },
      headers
    );
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
    clientInfo: { name: "al-deploy", version: "1.0" },
  });
  await httpJson("POST", { jsonrpc: "2.0", method: "notifications/initialized" }, headers).catch(() => {});

  console.log("Reading dashboard...");
  const dash = await tool("mainframe_get_dashboard", {});
  console.log(
    "online=%s shells=%s chars=%s",
    dash.online,
    dash.shells,
    (dash.characters || dash.owned_characters || []).length || "?"
  );

  console.log("Listing CODE slots...");
  const listed = await tool("list_codes", {});
  const slots = listed.codes || [];
  for (const s of slots) console.log("  slot=%s name=%s v=%s", s.slot, s.name, s.version);

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
    const slot = findSlot(u);
    const filePath = path.join(ROOT, u.file);
    const code = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
    const lines = code.replace(/\s+$/, "").split("\n").length;
    console.log("Saving %s -> slot %s (%s lines)...", u.file, slot.slot, lines);
    let before = 0;
    try {
      const existing = await tool("get_code", { slot: String(slot.slot) });
      before =
        (existing.code && existing.code.code && existing.code.code.length) ||
        (typeof existing.code === "string" && existing.code.length) ||
        0;
    } catch (e) {
      console.log("  (new slot, no existing code)");
    }
    console.log("  existing bytes=%s", before);
    const saved = await tool("save_code", {
      slot: String(slot.slot),
      name: u.name,
      code,
    });
    const verify = await tool("get_code", { slot: String(slot.slot) });
    const src =
      (verify.code && typeof verify.code.code === "string" && verify.code.code) ||
      (typeof verify.code === "string" && verify.code) ||
      "";
    if (src !== code) {
      console.log("  WARN: readback mismatch (got %s bytes, expected %s)", src.length, code.length);
      failed++;
    } else {
      console.log("  save_code ok v%s verified name=%s", (saved.code && saved.code.version) || "?", u.name);
    }
  }

  if (failed) {
    console.error("\n" + failed + " slot(s) failed verification.");
    process.exit(1);
  }
  console.log("\nDone. Browser/Mainframe CODE must reload the slot (Stop/Run or load_code).");
  console.log("Not starting Mainframe (would spend Shells/time).");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
