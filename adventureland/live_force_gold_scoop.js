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
const id = "live_gold_" + Date.now();
const code = `(() => {
  const id = ${JSON.stringify(id)};
  send_cm("Puppygirl", {
    v: 1,
    job: "dlv_pots",
    id: id,
    who: character.name,
    items: [
      { name: "hpot1", q: 40 },
      { name: "mpot1", q: 40 },
    ],
    farm: "armadillo",
    map: character.map,
    x: character.real_x,
    y: character.real_y,
  });
  game_log("LIVE_GOLD_REQ " + id);
  return { id: id, gold: character.gold, x: Math.round(character.real_x), y: Math.round(character.real_y) };
})()`;
console.log("req", JSON.stringify(call("mainframe_code_eval", { character: "Jazwyn", code })));
console.log("waiting 90s for scoop/offload/buy...");
const t0 = Date.now();
while (Date.now() - t0 < 90000) {
  spawnSync(process.execPath, ["-e", ""], { timeout: 1000 });
}
for (const n of ["Puppygirl", "Jazwyn", "Sarene", "Zarook"]) {
  const r = call("mainframe_get_character", { character: n });
  const o = (r.runtime || {}).observation || {};
  console.log(n, "gold=" + o.gold, "xy=" + [Math.round(o.x), Math.round(o.y)].join(","));
}
for (const n of ["Puppygirl", "Jazwyn"]) {
  const logs = call("mainframe_get_logs", { character: n, limit: 100 });
  const lines = (logs.logs || []).map((row) => (row.values || []).join(" "));
  const hit = lines.filter((l) =>
    /LIVE_GOLD|gold_offload|scoop|buy_float|dlv:buy |dlv:done|dlv:active|dlv:approach|dlv:meet|dlv:send /i.test(l)
  );
  console.log("====", n);
  console.log(hit.slice(-25).join("\n") || "(none)");
}
