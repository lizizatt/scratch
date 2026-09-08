"use strict";

/**
 * Live explorer stubs — run on Mainframe via MCP once bots are deployed.
 * Measures facts not in server source (V2_PLAN §12.3 / LESSONS).
 *
 *   node tools/explore_live.js vision   # ASSUMED VISION_PX until filled
 *   node tools/explore_live.js path     # compare live ms to data/path_bands.sim.json
 *
 * Requires .al_mcp_token or AL_MCP_TOKEN. Writes data/path_bands.live.json /
 * data/vision.live.json when measurements succeed.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TOKEN_FILE = path.join(ROOT, ".al_mcp_token");

function readToken() {
  if (process.env.AL_MCP_TOKEN && process.env.AL_MCP_TOKEN.trim()) return process.env.AL_MCP_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  return null;
}

function usage() {
  console.log(`Usage:
  node tools/explore_live.js vision
  node tools/explore_live.js path

Sim baseline (no auth):
  node tools/explore_routes.js

Live protocol (manual / future automation):
  vision — park two chars, walk apart until get_player null; record px
  path   — time smart_move per route class in data/path_bands.sim.json; record ms/fail
`);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    return;
  }
  const token = readToken();
  if (!token) {
    console.error("No MCP token (.al_mcp_token or AL_MCP_TOKEN). Sim baseline only:");
    console.error("  node tools/explore_routes.js");
    process.exit(2);
  }

  if (cmd === "vision") {
    const out = {
      generatedAt: new Date().toISOString(),
      source: "live-stub",
      status: "not_measured",
      assumedVisionPx: 600,
      note: "Automate: party member walk-away until get_player fails; write measuredVisionPx.",
    };
    const file = path.join(ROOT, "data", "vision.live.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log("Stub wrote", file, "(assumed 600px — measure on Mainframe next)");
    return;
  }

  if (cmd === "path") {
    const simFile = path.join(ROOT, "data", "path_bands.sim.json");
    if (!fs.existsSync(simFile)) {
      console.error("Missing sim bands. Run: node tools/explore_routes.js");
      process.exit(1);
    }
    const sim = JSON.parse(fs.readFileSync(simFile, "utf8"));
    const out = {
      generatedAt: new Date().toISOString(),
      source: "live-stub",
      status: "not_measured",
      simBands: sim.bands,
      note: "Automate per-route smart_move timing on Mainframe; fill liveMs/failRate.",
      routes: Object.keys(sim.bands || {}).map((id) => ({
        id,
        liveMs: null,
        failRate: null,
        samples: 0,
      })),
    };
    const file = path.join(ROOT, "data", "path_bands.live.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log("Stub wrote", file, "(" + out.routes.length + " routes from sim bands)");
    return;
  }

  usage();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
