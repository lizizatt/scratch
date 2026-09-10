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
    game_log("ESC2 map=" + character.map + " xy=" + Math.round(character.real_x) + "," + Math.round(character.real_y));
    var ents = parent.entities || {};
    var out = [];
    for (var id in ents) {
      var e = ents[id];
      if (!e) continue;
      out.push([e.type, e.npc || e.name || e.mtype || id, Math.round(e.x || e.real_x || 0), Math.round(e.y || e.real_y || 0)].join(":"));
      if (out.length >= 25) break;
    }
    game_log("ESC2 ents " + out.join(" | "));
    if (typeof leave === "function") {
      try { var lr = await leave(); game_log("ESC2 leave " + JSON.stringify(lr) + " map=" + character.map); } catch (e1) { game_log("ESC2 leave err " + ((e1 && e1.message) || e1)); }
    }
    await sleep(2000);
    game_log("ESC2 afterleave map=" + character.map);
  } catch (e) { game_log("ESC2 fatal " + e); }
})();
`;
console.log(call("mainframe_code_eval", { character: "Sarene", code }));
