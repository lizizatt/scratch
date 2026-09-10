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
    var doors = (G.maps && G.maps.spookytown && G.maps.spookytown.doors) || [];
    game_log("T2 doors=" + doors.length + " xy=" + Math.round(character.real_x) + "," + Math.round(character.real_y));
    game_log("T2 door0=" + JSON.stringify(doors[0]));
    try {
      parent.socket.emit("transport", { to: "main" });
      game_log("T2 emit main");
    } catch (e1) { game_log("T2 emit fail " + e1); }
    await sleep(2500);
    game_log("T2 after emit map=" + character.map);
    if (character.map === "spookytown") {
      try { use("town"); game_log("T2 town"); } catch (e2) { game_log("T2 town fail"); }
      await sleep(3000);
      game_log("T2 after town map=" + character.map + " xy=" + Math.round(character.real_x) + "," + Math.round(character.real_y));
    }
    if (character.map === "spookytown" && doors[0]) {
      var d = doors[0];
      for (var i = 0; i < 40; i++) {
        var dx = d[0] - character.real_x;
        var dy = d[1] - character.real_y;
        var len = Math.hypot(dx, dy) || 1;
        if (len < 40) break;
        move(character.real_x + (dx / len) * 30, character.real_y + (dy / len) * 30);
        await sleep(350);
      }
      game_log("T2 walked dist=" + Math.round(Math.hypot(character.real_x - d[0], character.real_y - d[1])));
      try { transport(d[4], d[5] || 0); } catch (e3) { game_log("T2 tr " + e3); }
      try { parent.socket.emit("transport", { to: d[4] }); } catch (e4) {}
      await sleep(2500);
      game_log("T2 final map=" + character.map);
    }
  } catch (e) { game_log("T2 fatal " + ((e && e.reason) || e)); }
})();
`;
console.log(call("mainframe_code_eval", { character: "Sarene", code }));
