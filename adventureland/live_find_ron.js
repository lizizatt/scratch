#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
function call(n, a) {
  const r = spawnSync("node", ["live_mcp.js", "call", n, JSON.stringify(a || {})], {
    encoding: "utf8",
  });
  const out = (r.stdout || "").trim();
  if (!out) throw new Error("empty " + n + " stderr=" + (r.stderr || "").slice(0, 200));
  return JSON.parse(out);
}
const code = `(() => {
  const hits = [];
  const npcs = (G && G.npcs) || {};
  for (const id of Object.keys(npcs)) {
    const n = npcs[id];
    const blob = JSON.stringify(n).toLowerCase();
    if (
      /ron/.test(id) ||
      /ron/.test((n && n.name) || "") ||
      /donate|gum|secret/.test(blob)
    ) {
      hits.push({
        id: id,
        name: n.name,
        role: n.role,
        type: n.type,
        places: n.places,
      });
    }
  }
  // also find on maps
  const places = [];
  const maps = (G && G.maps) || {};
  for (const map of Object.keys(maps)) {
    for (const n of (maps[map] && maps[map].npcs) || []) {
      if (!n) continue;
      if (/ron/i.test(n.id || "") || /ron/i.test(n.name || "")) {
        places.push({ map: map, id: n.id, name: n.name, position: n.position });
      }
    }
  }
  game_log("RON " + JSON.stringify({ hits: hits, places: places }).slice(0, 900));
  return { hits: hits, places: places };
})()`;
call("mainframe_code_eval", { character: "Jazwyn", code });
spawnSync(process.execPath, ["-e", ""], { timeout: 5000 });
const logs = call("mainframe_get_logs", { character: "Jazwyn", limit: 50 });
console.log(
  (logs.logs || [])
    .map((r) => (r.values || []).join(" "))
    .filter((l) => /RON /.test(l))
    .slice(-3)
    .join("\n") || "(no RON log)"
);
