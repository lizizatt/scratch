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
  try { stop("smart"); } catch (e0) {}
  var party = get_party() || {};
  var keys = Object.keys(party);
  var p = party.Jazwyn;
  var vis = get_player("Jazwyn");
  game_log("SD1 party=" + keys.join(",") + " n=" + keys.length);
  game_log(
    "SD2 leadParty=" +
      (p
        ? p.map + " " + Math.round(p.real_x != null ? p.real_x : p.x) + "," + Math.round(p.real_y != null ? p.real_y : p.y)
        : "none")
  );
  game_log("SD3 leadVis=" + !!vis + " me=" + character.map + " " + Math.round(character.real_x) + "," + Math.round(character.real_y) + " moving=" + !!(typeof smart !== "undefined" && smart.moving));
})();
`;
console.log(call("mainframe_code_eval", { character: "Sarene", code }));
