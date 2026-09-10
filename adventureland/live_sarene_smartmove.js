#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
function call(n, a) {
  const r = spawnSync("node", ["live_mcp.js", "call", n, JSON.stringify(a)], {
    encoding: "utf8",
  });
  if (!r.stdout || !r.stdout.trim()) throw new Error("empty");
  return JSON.parse(r.stdout);
}
const code = `
(async function () {
  try {
    try { stop("smart"); } catch (e0) {}
    game_log("SM1 start " + character.map + " " + Math.round(character.real_x) + "," + Math.round(character.real_y));
    var r = await smart_move({ map: "main", x: 526, y: 1846 });
    game_log("SM1 done failed=" + !!(r && r.failed) + " reason=" + ((r && r.reason) || "-") + " at=" + Math.round(character.real_x) + "," + Math.round(character.real_y));
  } catch (e) {
    game_log("SM1 err " + ((e && e.reason) || (e && e.message) || e));
  }
})();
`;
console.log(call("mainframe_code_eval", { character: "Sarene", code }));
