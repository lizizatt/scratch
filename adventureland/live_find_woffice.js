#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
function call(n, a) {
  const r = spawnSync("node", ["live_mcp.js", "call", n, JSON.stringify(a || {})], {
    encoding: "utf8",
  });
  const out = (r.stdout || "").trim();
  if (!out) throw new Error("empty " + n);
  return JSON.parse(out);
}
const main = call("get_game_data", { section: "maps", name: "main" });
const d = main.data;
console.log(
  "doors woffice",
  JSON.stringify((d.doors || []).filter((x) => String(x).includes("woffice")))
);
console.log(
  "transporter npc",
  JSON.stringify((d.npcs || []).find((n) => n && n.id === "transporter"))
);
const s = call("search_game_data", { query: "woffice" });
for (const h of s.results || []) {
  console.log(
    h.section,
    h.name,
    (h.matched_fields || [])
      .slice(0, 4)
      .map((m) => m.path + "=" + JSON.stringify(m.value))
      .join("; ")
  );
}
const places = call("get_game_data", { section: "npcs", name: "transporter" });
console.log("transporter npc data keys", Object.keys(places.data || places));
console.log(JSON.stringify(places.data || places, null, 2).slice(0, 2000));
