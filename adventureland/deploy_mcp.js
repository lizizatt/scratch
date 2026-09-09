#!/usr/bin/env node
/**
 * Deploy V2 dist/*.js into Adventure Land CODE slots via MCP.
 *
 * Prefer:  node publish.js
 * This file remains as a thin wrapper for older scripts (live_observe_v2, etc.).
 *
 * Auth: adventureland/.al_mcp_token or AL_MCP_TOKEN
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = __dirname;
const args = process.argv.slice(2);
const pubArgs = args.includes("--dry-run") ? ["--dry-run"] : ["--upload"];
if (args.includes("--test")) pubArgs.unshift("--test");

const r = spawnSync("node", [path.join(ROOT, "publish.js"), ...pubArgs], {
  encoding: "utf8",
  cwd: ROOT,
  stdio: "inherit",
});
process.exit(r.status == null ? 1 : r.status);
