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
  var z = p.Zarook;
  game_log(
    "CHK me=" +
      Math.round(character.real_x) +
      "," +
      Math.round(character.real_y) +
      " keys=" +
      Object.keys(p).join("|")
  );
  game_log(
    "CHK J=" +
      (j ? Math.round(j.x) + "," + Math.round(j.y) + " map=" + j.map : "none") +
      " Z=" +
      (z ? Math.round(z.x) + "," + Math.round(z.y) : "none")
  );
  if (j) {
    var d = Math.hypot(character.real_x - j.x, character.real_y - j.y);
    game_log("CHK distJ=" + Math.round(d));
  }
})();
`;
for (const name of ["Sarene", "Zarook", "Jazwyn"]) {
  call("mainframe_code_eval", { character: name, code: code.replace(/CHK/g, "CHK" + name[0]) });
}
