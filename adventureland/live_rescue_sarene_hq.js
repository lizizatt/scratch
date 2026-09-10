#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
const ROOT = __dirname;
function call(tool, args) {
  const r = spawnSync(
    "node",
    ["live_mcp.js", "call", tool, JSON.stringify(args)],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (r.status) {
    console.error(r.stderr || r.stdout);
    throw new Error("call failed " + tool);
  }
  return JSON.parse(r.stdout);
}

const rescue = `
(async function(){
  try {
    if (character.map !== "main") {
      try { use("town"); } catch (e0) {}
      await sleep(2500);
    }
    if (character.map !== "main") {
      await smart_move({ map: "main", x: 0, y: 0 });
    }
    game_log("LIVE_MAIN_RESCUE map=" + character.map);
  } catch (e) {
    game_log("LIVE_MAIN_FAIL " + ((e && (e.reason || e.message)) || e));
  }
})();
`;

const hq = `
try {
  send_cm("Jazwyn", { hunt_quest: 1 });
  send_cm("Sarene", { hunt_quest: 1 });
  send_cm("Zarook", { hunt_quest: 1 });
  game_log("LIVE_CM_HQ");
} catch (e) {
  game_log("LIVE_CM_FAIL " + ((e && e.message) || e));
}
`;

console.log("rescue", call("mainframe_code_eval", { character: "Sarene", code: rescue }));
console.log("hq", call("mainframe_code_eval", { character: "Puppygirl", code: hq }));
