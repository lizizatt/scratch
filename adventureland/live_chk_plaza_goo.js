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

const map = call("get_game_data", { section: "maps", name: "main" });
const data = map.data || {};
const monsters = data.monsters || [];
const goos = monsters.filter((m) => m && m.type === "goo");
console.log("goo spawns on main:", goos.length);
console.log(
  goos
    .slice(0, 15)
    .map((m) => "(" + Math.round(m.boundary ? (m.boundary[0] + m.boundary[2]) / 2 : m.x) + "," + Math.round(m.boundary ? (m.boundary[1] + m.boundary[3]) / 2 : m.y) + ") boundary=" + JSON.stringify(m.boundary || null))
    .join("\n")
);

const npcs = data.npcs || [];
const daisy = npcs.filter((n) => n && (n.id === "monsterhunter" || /monsterhunt|daisy/i.test(n.id || "") || /monsterhunt|daisy/i.test(n.name || "")));
console.log(
  "daisy-ish npcs:",
  daisy.map((n) => n.id + " " + JSON.stringify(n.position || n)).join(" | ")
);

const code = `(() => {
  const goos = [];
  for (const id in parent.entities) {
    const e = parent.entities[id];
    if (e && e.type === "monster" && e.mtype === "goo") {
      goos.push([Math.round(e.real_x || e.x), Math.round(e.real_y || e.y)]);
    }
  }
  const near = get_nearest_monster();
  const r = {
    me: [Math.round(character.real_x), Math.round(character.real_y)],
    gooN: goos.length,
    goos: goos.slice(0, 8),
    near: near
      ? {
          mtype: near.mtype,
          x: Math.round(near.real_x || near.x),
          y: Math.round(near.real_y || near.y),
        }
      : null,
  };
  game_log("PLAZA " + JSON.stringify(r));
  return r;
})()`;
call("mainframe_code_eval", { character: "Jazwyn", code });
spawnSync(process.execPath, ["-e", ""], { timeout: 4000 });
const logs = call("mainframe_get_logs", { character: "Jazwyn", limit: 30 });
console.log(
  "--- logs ---",
  (logs.logs || [])
    .map((r) => (r.values || []).join(" "))
    .filter((l) => /PLAZA|wait_party|Hunt |MH |goo/i.test(l))
    .slice(-12)
    .join("\n")
);

for (const n of ["Jazwyn", "Sarene", "Zarook"]) {
  const r = call("mainframe_get_character", { character: n });
  const o = (r.runtime || {}).observation || {};
  console.log(n, Math.round(o.x), Math.round(o.y));
}
