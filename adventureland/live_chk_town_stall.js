#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
function call(n, a) {
  return JSON.parse(
    spawnSync("node", ["live_mcp.js", "call", n, JSON.stringify(a || {})], {
      encoding: "utf8",
    }).stdout
  );
}
const code = `(() => {
  const p = get_party() || {};
  const out = {
    name: character.name,
    map: character.map,
    x: Math.round(character.real_x),
    y: Math.round(character.real_y),
    gold: character.gold,
    partyKeys: Object.keys(p),
    party: {},
  };
  for (const n of Object.keys(p)) {
    const e = p[n];
    const pl = get_player(n);
    out.party[n] = {
      px: e ? Math.round(e.x) : null,
      py: e ? Math.round(e.y) : null,
      pmap: e && e.map,
      vision: !!pl,
      d: e ? Math.round(Math.hypot(character.real_x - e.x, character.real_y - e.y)) : null,
    };
  }
  return out;
})()`;
for (const n of ["Jazwyn", "Sarene", "Zarook"]) {
  const r = call("mainframe_code_eval", { character: n, code });
  console.log(JSON.stringify(r.result != null ? r.result : r));
}
const logs = call("mainframe_get_logs", { character: "Jazwyn", limit: 100 });
const lines = (logs.logs || []).map((row) => (row.values || []).join(" "));
console.log("--- jazwyn ---");
console.log(
  lines
    .filter((l) => /wait_|smart_|Transfer|Hunt |town|hold|mhunt|soft|croc|armadillo|timeout|far_pack/i.test(l))
    .slice(-35)
    .join("\n")
);
