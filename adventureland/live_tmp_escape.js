#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
function call(n, a) {
  return JSON.parse(
    spawnSync("node", ["live_mcp.js", "call", n, JSON.stringify(a)], { encoding: "utf8" }).stdout
  );
}
const code = `
(async function () {
  try {
    game_log("ESCAPE try map=" + character.map);
    try {
      if (typeof leave === "function") {
        await leave();
        game_log("ESCAPE leave ok map=" + character.map);
      }
    } catch (e1) {
      game_log("ESCAPE leave fail " + ((e1 && e1.message) || e1));
    }
    await sleep(2000);
    try {
      use("town");
      game_log("ESCAPE town map=" + character.map);
    } catch (e2) {
      game_log("ESCAPE town fail " + ((e2 && e2.message) || e2));
    }
    await sleep(2500);
    try {
      var ents = parent.entities || {};
      var keys = Object.keys(ents).slice(0, 40);
      game_log(
        "ESCAPE ents " +
          keys
            .map(function (k) {
              var e = ents[k];
              return (e && e.type) + ":" + (e && (e.name || e.npc || e.id || k));
            })
            .join("|")
      );
    } catch (e3) {
      game_log("ESCAPE ents fail");
    }
    try {
      await smart_move({ map: "main", x: 0, y: 0 });
      game_log("ESCAPE smart main=" + character.map);
    } catch (e4) {
      game_log("ESCAPE smart fail " + ((e4 && e4.reason) || (e4 && e4.message) || e4));
    }
  } catch (e) {
    game_log("ESCAPE fatal " + e);
  }
})();
`;
console.log(call("mainframe_code_eval", { character: "Sarene", code }));
