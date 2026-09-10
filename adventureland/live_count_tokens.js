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
  let n = 0;
  const stacks = [];
  for (const it of character.items || []) {
    if (!it) continue;
    if (it.name === "monstertoken" || /token/i.test(it.name)) {
      const q = it.q == null ? 1 : it.q;
      n += it.name === "monstertoken" ? q : 0;
      stacks.push(it.name + "x" + q);
    }
  }
  game_log("TOKENS bag=" + n + " " + stacks.join(","));
  return { name: character.name, monstertoken: n, tokenish: stacks };
})()`;
for (const name of ["Jazwyn", "Sarene", "Zarook", "Puppygirl"]) {
  call("mainframe_code_eval", { character: name, code });
}
spawnSync(process.execPath, ["-e", ""], { timeout: 5000 });
for (const name of ["Jazwyn", "Sarene", "Zarook", "Puppygirl"]) {
  const logs = call("mainframe_get_logs", { character: name, limit: 30 });
  const hit = (logs.logs || [])
    .map((r) => (r.values || []).join(" "))
    .filter((l) => /TOKENS /.test(l));
  console.log(name, hit.slice(-1)[0] || "(no TOKENS log)");
}
const b = call("get_bank", {});
let bank = 0;
const hits = [];
function walk(arr, label) {
  for (const it of arr || []) {
    if (!it) continue;
    if (it.name === "monstertoken") {
      const q = it.q == null ? 1 : it.q;
      bank += q;
      hits.push(label + ":" + q);
    }
  }
}
const packs = b.packs || b.bank || {};
for (const k of Object.keys(packs)) {
  if (k === "gold") continue;
  if (Array.isArray(packs[k])) walk(packs[k], k);
}
console.log("bank_snapshot monstertoken=", bank, hits.join(", ") || "(none)");
console.log("bank note:", b.note || b.freshness || "");
