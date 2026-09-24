#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
function call(n, a) {
  const r = spawnSync("node", ["live_mcp.js", "call", n, JSON.stringify(a)], {
    encoding: "utf8",
  });
  if (!r.stdout || !r.stdout.trim()) throw new Error(r.stderr || "empty");
  return JSON.parse(r.stdout);
}
const code = `(() => {
  const items = character.items || [];
  let h = 0, m = 0, n = 0;
  for (const it of items) {
    if (!it) continue;
    n++;
    if (/^hpot/.test(it.name)) h += it.q || 1;
    if (/^mpot/.test(it.name)) m += it.q || 1;
  }
  const party = get_party() || {};
  const j = party.Jazwyn;
  const s = typeof smart !== "undefined" ? smart : null;
  return {
    name: character.name,
    map: character.map,
    x: Math.round(character.real_x),
    y: Math.round(character.real_y),
    gold: character.gold,
    esize: character.esize,
    items: n,
    hpot: h,
    mpot: m,
    partyKeys: Object.keys(party),
    J: j ? { x: Math.round(j.x), y: Math.round(j.y), map: j.map } : null,
    distJ: j ? Math.round(Math.hypot(character.real_x - j.x, character.real_y - j.y)) : null,
    smartMoving: s ? !!s.moving : null,
    rip: !!character.rip,
  };
})()`;
for (const name of ["Sarene", "Zarook", "Jazwyn", "Puppygirl"]) {
  const r = call("mainframe_code_eval", { character: name, code });
  const out = r.result !== undefined ? r.result : r;
  console.log(JSON.stringify(out));
}
