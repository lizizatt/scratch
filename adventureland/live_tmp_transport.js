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
    character._hold_escape = 1;
    var doors = (G.maps && G.maps.spookytown && G.maps.spookytown.doors) || [];
    game_log("T1 doors=" + doors.length + " first=" + JSON.stringify(doors[0]));
    var d = null;
    for (var i = 0; i < doors.length; i++) if (doors[i] && (doors[i][4] === "main" || doors[i][4] === "halloween")) { d = doors[i]; break; }
    if (!d) d = doors[0];
    game_log("T1 pick=" + JSON.stringify(d));
    if (d) {
      await smart_move({ x: d[0], y: d[1] });
      await sleep(500);
      game_log("T1 dist=" + Math.round(Math.hypot(character.real_x - d[0], character.real_y - d[1])));
    }
    try {
      parent.socket.emit("transport", { to: "main" });
      game_log("T1 socket transport main");
    } catch (e1) { game_log("T1 socket fail " + e1); }
    await sleep(3000);
    game_log("T1 map=" + character.map);
    if (character.map !== "main" && typeof transport === "function" && d) {
      transport(d[4], d[5] || 0);
      await sleep(2000);
      game_log("T1 transport2 map=" + character.map);
    }
  } catch (e) { game_log("T1 fatal " + ((e && e.reason) || e)); }
})();
`;
console.log(call("mainframe_code_eval", { character: "Sarene", code }));
