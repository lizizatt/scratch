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
  const keys = Object.keys(p);
  const rows = {};
  for (const n of keys) {
    const e = p[n];
    rows[n] = {
      x: e ? Math.round(e.x) : null,
      y: e ? Math.round(e.y) : null,
      map: e && e.map,
      d: e ? Math.round(Math.hypot(character.real_x - e.x, character.real_y - e.y)) : null,
      vision: !!get_player(n),
    };
  }
  let h = 0, m = 0;
  for (const it of character.items || []) {
    if (!it) continue;
    if (/^hpot/.test(it.name)) h += it.q || 1;
    if (/^mpot/.test(it.name)) m += it.q || 1;
  }
  const r = {
    me: character.name,
    xy: [Math.round(character.real_x), Math.round(character.real_y)],
    keys: keys,
    rows: rows,
    hpot: h,
    mpot: m,
    smartMoving: typeof smart !== "undefined" ? !!smart.moving : null,
  };
  game_log("TOWNCHK " + JSON.stringify(r));
  return r;
})()`;
for (const n of ["Jazwyn", "Sarene", "Zarook"]) {
  call("mainframe_code_eval", { character: n, code });
}
spawnSync(process.execPath, ["-e", ""], { timeout: 5000 });
for (const n of ["Jazwyn", "Sarene", "Zarook"]) {
  const logs = call("mainframe_get_logs", { character: n, limit: 50 });
  const hit = (logs.logs || [])
    .map((r) => (r.values || []).join(" "))
    .filter((l) => /TOWNCHK|wait_timeout|smart_fail|Hunt |mhunt|hold|Transfer|far_pack|dlv:|soft_/i.test(l));
  console.log("====", n);
  console.log(hit.slice(-10).join("\n") || "(none)");
}
