#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
const ROOT = __dirname;
const code = "try{hunt_quest();game_log('LIVE_HQ_ON')}catch(e){game_log('LIVE_HQ_FAIL '+((e&&e.message)||e))}";
const r = spawnSync(
  "node",
  ["live_mcp.js", "call", "mainframe_code_eval", JSON.stringify({ character: "Puppygirl", code })],
  { cwd: ROOT, encoding: "utf8" }
);
process.stdout.write(r.stdout || "");
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.status == null ? 1 : r.status);
