#!/usr/bin/env node
/**
 * V2 publish pipeline
 *
 *   readable src/  →  compress  →  dist/  →  Mainframe CODE slots
 *
 * Usage:
 *   node publish.js              # build + upload
 *   node publish.js --build      # compress only (no MCP)
 *   node publish.js --upload     # build then upload
 *   node publish.js --test       # run tests/run.js before build
 *   node publish.js --dry-run    # build; print upload plan; no save_code
 *   node publish.js --list       # show slot map
 *   node publish.js --help
 *
 * Auth for upload: adventureland/.al_mcp_token or AL_MCP_TOKEN
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");
const { SLOTS, uploadsFromManifest, MAX_LINES } = require("./publish.manifest");
const { buildAll, printManifest } = require("./tools/compress_code");

const ROOT = __dirname;
const TOKEN_FILE = path.join(ROOT, ".al_mcp_token");
const DIST = path.join(ROOT, "dist");

function usage() {
  console.log(`Adventure Land V2 publish

  node publish.js [options]

Options:
  --build       Compress src/ → dist/ only (default if no upload flags)
  --upload      After build, save_code each slot via MCP
  --test        Run node tests/run.js before build (fail → abort)
  --dry-run     Build + list MCP targets; do not call save_code
  --list        Print slot → source → upload map and exit
  --help        This help

With no flags, runs: build + upload (same as --upload).

Source of truth: publish.manifest.js
Compressor:      tools/compress_code.js  (comments/whitespace stripped; ≤${MAX_LINES} lines)
`);
}

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

function runTests() {
  console.log("Running tests...");
  const r = spawnSync("node", [path.join(ROOT, "tests/run.js")], {
    encoding: "utf8",
    cwd: ROOT,
  });
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  if (r.status) throw new Error("tests failed");
}

function build() {
  console.log("Compressing src/ → dist/ ...");
  const report = buildAll(ROOT);
  for (const k of Object.keys(report)) console.log("  %s.js lines=%s", k, report[k]);
  console.log("OK all slots ≤%s", MAX_LINES);
  return report;
}

async function uploadAll(opts) {
  opts = opts || {};
  const dry = !!opts.dryRun;
  const token = readToken();
  if (!token) throw new Error("Missing .al_mcp_token or AL_MCP_TOKEN");

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
    clientInfo: { name: "al-publish-v2", version: "2.0" },
  });
  await httpJson("POST", { jsonrpc: "2.0", method: "notifications/initialized" }, headers).catch(() => {});

  const dash = await tool("mainframe_get_dashboard", {});
  console.log(
    "dashboard online=%s shells=%s free_h=%s",
    dash.online,
    dash.shells,
    dash.free_time && dash.free_time.remaining_hours
  );

  const listed = await tool("list_codes", {});
  const slots = listed.codes || [];
  for (const s of slots) console.log("  existing slot=%s name=%s", s.slot, s.name);

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

  const uploads = uploadsFromManifest();
  let failed = 0;
  console.log(dry ? "Dry-run upload plan:" : "Uploading:");

  for (const u of uploads) {
    const filePath = path.join(DIST, u.file);
    if (!fs.existsSync(filePath)) {
      console.error("  missing %s — run build first", filePath);
      failed++;
      continue;
    }
    const code = fs.readFileSync(filePath, "utf8");
    const lines = code.replace(/\s+$/, "").split(/\r?\n/).filter(Boolean).length;
    if (lines > MAX_LINES) {
      console.error("  FAIL %s lines=%s (max %s)", u.file, lines, MAX_LINES);
      failed++;
      continue;
    }
    const target = findSlot(u);
    console.log(
      "  %s → slot=%s name=%s lines=%s chars=%s%s",
      u.file,
      target.slot,
      u.name,
      lines,
      code.length,
      dry ? " (dry-run)" : ""
    );
    if (dry) continue;
    try {
      await tool("save_code", { slot: String(target.slot), name: u.name, code });
      target.name = u.name;
    } catch (e) {
      console.error("  save failed:", e.message || e);
      failed++;
    }
  }

  if (failed) throw new Error("Upload finished with " + failed + " failures");
  console.log(dry ? "Dry-run OK" : "Upload OK");
  console.log("Note: save_code does not restart running CODE — disconnect/relink characters to load new slots.");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }
  if (args.includes("--list")) {
    printManifest(ROOT);
    return;
  }

  const wantTest = args.includes("--test");
  const wantDry = args.includes("--dry-run");
  const wantBuildOnly = args.includes("--build");
  const wantUpload = args.includes("--upload") || wantDry || (!wantBuildOnly && !args.length);
  // bare `node publish.js` → build+upload; `--build` alone → build only

  if (wantTest) runTests();
  build();

  if (wantUpload || wantDry) {
    await uploadAll({ dryRun: wantDry });
  } else {
    console.log("Build only. Pass --upload to push to Mainframe.");
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
