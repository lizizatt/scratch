#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
function call(n, a) {
  const r = spawnSync("node", ["live_mcp.js", "call", n, JSON.stringify(a)], {
    encoding: "utf8",
  });
  if (!r.stdout || !r.stdout.trim()) throw new Error("empty " + (r.stderr || ""));
  return JSON.parse(r.stdout);
}
const code = `
(async function () {
  try {
    try { stop("smart"); } catch (e0) {}
    var doors = (G.maps && G.maps.spookytown && G.maps.spookytown.doors) || [];
    game_log("DOOR n=" + doors.length);
    for (var i = 0; i < Math.min(doors.length, 8); i++) game_log("DOOR " + i + " " + JSON.stringify(doors[i]));
    var d = null;
    for (var j = 0; j < doors.length; j++) if (doors[j] && doors[j][4] === "main") { d = doors[j]; break; }
    if (!d && doors[0]) d = doors[0];
    if (!d) { game_log("DOOR none"); return; }
    game_log("DOOR go " + d[0] + "," + d[1] + " -> " + d[4] + " spawn=" + d[5]);
    try { await smart_move({ x: d[0], y: d[1] }); } catch (e1) { game_log("DOOR move fail " + ((e1 && e1.reason) || e1)); }
    game_log("DOOR at " + Math.round(character.x) + "," + Math.round(character.y) + " map=" + character.map);
    try {
      var r = transport(d[4], d[5] == null ? 0 : d[5]);
      game_log("DOOR transport r=" + JSON.stringify(r) + " map=" + character.map);
    } catch (e2) { game_log("DOOR transport err " + ((e2 && e2.message) || e2)); }
    await sleep(2500);
    game_log("DOOR final map=" + character.map);
  } catch (e) { game_log("DOOR fatal " + e); }
})();
`;
console.log(JSON.stringify(call("mainframe_code_eval", { character: "Sarene", code }), null, 2));
