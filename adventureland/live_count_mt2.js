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
const marker = "MTCOUNT_" + Date.now();
for (const name of ["Puppygirl", "Jazwyn", "Sarene", "Zarook"]) {
  const code = `(() => {
    let bag = 0;
    for (const it of character.items || []) {
      if (it && it.name === "monstertoken") bag += it.q == null ? 1 : it.q;
    }
    let bank = 0;
    const b = character.bank;
    if (b) {
      for (const k of Object.keys(b)) {
        if (k === "gold" || !Array.isArray(b[k])) continue;
        for (const it of b[k]) {
          if (it && it.name === "monstertoken") bank += it.q == null ? 1 : it.q;
        }
      }
    }
    game_log(${JSON.stringify(marker)} + " " + character.name + " bag=" + bag + " bank=" + bank);
  })()`;
  call("mainframe_code_eval", { character: name, code });
}
spawnSync(process.execPath, ["-e", ""], { timeout: 8000 });
let bagTotal = 0,
  bankTotal = 0;
for (const name of ["Puppygirl", "Jazwyn", "Sarene", "Zarook"]) {
  const logs = call("mainframe_get_logs", { character: name, limit: 100 });
  const hit = (logs.logs || [])
    .map((r) => (r.values || []).join(" "))
    .filter((l) => l.indexOf(marker) >= 0);
  const line = hit.slice(-1)[0] || "";
  console.log(line || name + ": (eval log missing)");
  const m = line.match(/bag=(\d+) bank=(\d+)/);
  if (m) {
    bagTotal += +m[1];
    bankTotal += +m[2];
  }
}
console.log("total bag", bagTotal, "mounted-bank", bankTotal, "combined", bagTotal + bankTotal);
