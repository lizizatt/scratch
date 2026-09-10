#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
function call(n, a) {
  const r = spawnSync("node", ["live_mcp.js", "call", n, JSON.stringify(a)], {
    encoding: "utf8",
  });
  if (!r.stdout || !r.stdout.trim()) throw new Error("empty");
  return JSON.parse(r.stdout);
}

const jaz = `
game_log("JP1");
var p = get_party() || {};
game_log("JP2 keys=" + Object.keys(p).join("|"));
try {
  send_party_invite("Sarene");
  game_log("JP3 invited");
} catch (e) {
  game_log("JP3 fail");
}
`;

const sar = `
game_log("SP1");
var p = get_party() || {};
game_log("SP2 keys=" + Object.keys(p).join("|"));
try {
  accept_party_invite("Jazwyn");
  game_log("SP3 accepted");
} catch (e) {
  game_log("SP3 fail " + e);
}
`;

console.log("jaz", call("mainframe_code_eval", { character: "Jazwyn", code: jaz }));
console.log("sar", call("mainframe_code_eval", { character: "Sarene", code: sar }));
