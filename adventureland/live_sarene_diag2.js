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
  var p = get_party() || {};
  var j = p.Jazwyn;
  var vis = get_player("Jazwyn");
  game_log("SD party=" + Object.keys(p).join("|"));
  game_log(
    "SD lead=" +
      (j
        ? j.map + " " + Math.round(j.x || j.real_x || 0) + "," + Math.round(j.y || j.real_y || 0)
        : "none") +
      " vis=" +
      !!vis
  );
  game_log(
    "SD me=" +
      character.map +
      " " +
      Math.round(character.real_x) +
      "," +
      Math.round(character.real_y) +
      " moving=" +
      !!(typeof smart !== "undefined" && smart.moving) +
      " rip=" +
      !!character.rip
  );
})();
`;
console.log(call("mainframe_code_eval", { character: "Sarene", code }));
