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
(function () {
  var m = get_nearest_monster({ type: "phoenix" });
  var ents = [];
  for (var id in parent.entities) {
    var e = parent.entities[id];
    if (e && e.type === "monster" && e.mtype === "phoenix")
      ents.push({
        x: Math.round(e.real_x || e.x),
        y: Math.round(e.real_y || e.y),
        hp: e.hp,
        max: e.max_hp,
      });
  }
  game_log(
    "PHOENIX_SNAP " +
      JSON.stringify({
        xy: [Math.round(character.real_x), Math.round(character.real_y)],
        map: character.map,
        nearest: m
          ? {
              x: Math.round(m.real_x || m.x),
              y: Math.round(m.real_y || m.y),
              hp: m.hp,
              in_range: is_in_range(m),
              dist: Math.round(
                Math.hypot(character.real_x - (m.real_x || m.x), character.real_y - (m.real_y || m.y))
              ),
            }
          : null,
        ents: ents,
      })
  );
})();
`;
for (const name of ["Jazwyn", "Sarene", "Zarook"]) {
  console.log(name, call("mainframe_code_eval", { character: name, code }).success);
}
