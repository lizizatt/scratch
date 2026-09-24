#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
function call(n, a) {
  return JSON.parse(
    spawnSync("node", ["live_mcp.js", "call", n, JSON.stringify(a)], { encoding: "utf8" }).stdout
  );
}
const code = `
(async function () {
  try {
    try { stop("smart"); } catch (e0) {}
    var doors = (G.maps.spookytown && G.maps.spookytown.doors) || [];
    game_log("ESC3 doors n=" + doors.length + " " + JSON.stringify(doors.slice(0, 6)));
    var door = null;
    for (var i = 0; i < doors.length; i++) {
      var d = doors[i];
      if (d && d[4] === "main") { door = d; break; }
    }
    if (!door && doors[0]) door = doors[0];
    if (!door) { game_log("ESC3 no door"); return; }
    game_log("ESC3 pick " + JSON.stringify(door));
    var dx = door[0], dy = door[1], dest = door[4], spawn = door[5];
    await smart_move({ map: "spookytown", x: dx, y: dy });
    game_log("ESC3 at door xy=" + Math.round(character.real_x) + "," + Math.round(character.real_y));
    if (typeof transport === "function") {
      var tr = transport(dest, spawn == null ? 0 : spawn);
      game_log("ESC3 transport " + dest + " " + spawn + " -> " + JSON.stringify(tr) + " map=" + character.map);
    } else {
      game_log("ESC3 no transport fn");
    }
    await sleep(2000);
    game_log("ESC3 done map=" + character.map);
  } catch (e) {
    game_log("ESC3 fatal " + ((e && (e.reason || e.message)) || e));
  }
})();
`;
console.log(call("mainframe_code_eval", { character: "Sarene", code }));
