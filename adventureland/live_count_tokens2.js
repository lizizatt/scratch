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
  let bag = 0;
  for (const it of character.items || []) {
    if (it && it.name === "monstertoken") bag += it.q == null ? 1 : it.q;
  }
  let bank = 0;
  const src = [];
  const b = character.bank || character._bank;
  if (b) {
    for (const k of Object.keys(b)) {
      if (k === "gold" || !Array.isArray(b[k])) continue;
      for (const it of b[k]) {
        if (it && it.name === "monstertoken") {
          const q = it.q == null ? 1 : it.q;
          bank += q;
          src.push(k + ":" + q);
        }
      }
    }
  }
  game_log("TOKENS2 bag=" + bag + " bank=" + bank + " map=" + character.map + " " + src.join(","));
  return { bag, bank, map: character.map };
})()`;
for (const name of ["Jazwyn", "Sarene", "Zarook", "Puppygirl"]) {
  call("mainframe_code_eval", { character: name, code });
}
spawnSync(process.execPath, ["-e", ""], { timeout: 5000 });
for (const name of ["Jazwyn", "Sarene", "Zarook", "Puppygirl"]) {
  const logs = call("mainframe_get_logs", { character: name, limit: 40 });
  const hit = (logs.logs || [])
    .map((r) => (r.values || []).join(" "))
    .filter((l) => /TOKENS2 /.test(l));
  console.log(name, hit.slice(-1)[0] || "(none)");
}
