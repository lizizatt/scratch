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
  var p = (get_party() || {}).Jazwyn;
  var keys = p ? Object.keys(p) : [];
  game_log("SPJ keys=" + keys.join(","));
  game_log(
    "SPJ val=" +
      (p
        ? [p.map, p.x, p.y, p.real_x, p.real_y, p.in, p.share].join(":")
        : "none")
  );
  var d = p
    ? Math.hypot(
        character.real_x - (p.real_x != null ? p.real_x : p.x),
        character.real_y - (p.real_y != null ? p.real_y : p.y)
      )
    : -1;
  game_log("SPJ dist=" + Math.round(d) + " me=" + Math.round(character.real_x) + "," + Math.round(character.real_y));
})();
`;
console.log(call("mainframe_code_eval", { character: "Sarene", code }));
