#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
function call(n, a) {
  return JSON.parse(
    spawnSync("node", ["live_mcp.js", "call", n, JSON.stringify(a || {})], {
      encoding: "utf8",
    }).stdout
  );
}
function countMonstertoken(items) {
  let n = 0;
  for (const it of items || []) {
    if (it && it.name === "monstertoken") n += it.q == null ? 1 : it.q;
  }
  return n;
}
const byChar = {};
for (const name of ["Jazwyn", "Sarene", "Zarook", "Puppygirl"]) {
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
    game_log("MT " + bag + "/" + bank);
    return { bag, bank, map: character.map };
  })()`;
  call("mainframe_code_eval", { character: name, code });
}
spawnSync(process.execPath, ["-e", ""], { timeout: 6000 });
for (const name of ["Jazwyn", "Sarene", "Zarook", "Puppygirl"]) {
  const logs = call("mainframe_get_logs", { character: name, limit: 100 });
  const hit = (logs.logs || [])
    .map((r) => (r.values || []).join(" "))
    .filter((l) => /^MT /.test(l) || /TOKENS bag=/.test(l));
  const line = hit.slice(-1)[0] || "";
  let bag = null,
    bank = null;
  const m = line.match(/^MT (\d+)\/(\d+)/);
  if (m) {
    bag = +m[1];
    bank = +m[2];
  } else {
    const m2 = line.match(/TOKENS bag=(\d+)/);
    if (m2) bag = +m2[1];
  }
  byChar[name] = { bag, bank, line };
  console.log(name, line || "(no log)");
}
const snap = call("get_bank", {});
let snapBank = 0;
const packs = snap.packs || {};
for (const k of Object.keys(packs)) {
  if (Array.isArray(packs[k])) snapBank += countMonstertoken(packs[k]);
}
console.log("get_bank snapshot monstertoken:", snapBank, "(may be stale)");
const bagSum = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"].reduce(
  (a, n) => a + (byChar[n].bag || 0),
  0
);
console.log("bag total:", bagSum);
fs.writeFileSync(
  "_live_monstertoken.json",
  JSON.stringify({ at: new Date().toISOString(), byChar, snapBank, bagSum }, null, 2)
);
