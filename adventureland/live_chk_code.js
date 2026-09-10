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
const r = call("get_code", { slot: "11" });
const code = r.code || r.source || r.contents || JSON.stringify(r);
console.log("keys", Object.keys(r));
console.log("len", typeof code === "string" ? code.length : -1);
console.log("has scoop_gold", /scoop_gold/.test(code));
console.log("has return float", /return \"float\"/.test(code));
console.log("has gold_offload", /gold_offload/.test(code));
const f = call("get_code", { slot: "10" });
const fc = f.code || f.source || "";
console.log("fighter has gold_offload", /gold_offload/.test(fc));
