#!/usr/bin/env node
"use strict";
/**
 * Live prove: Puppygirl walks to each fighter, loot_q's them, confirms bag gains.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const token = fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8").trim();
let headers = {
  Authorization: "Bearer " + token,
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};
let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(body) {
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "adventure.land",
        path: "/mcp",
        method: "POST",
        headers: Object.assign({}, headers, { "Content-Length": data.length }),
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (res.headers["mcp-session-id"]) headers["mcp-session-id"] = res.headers["mcp-session-id"];
          resolve(b ? JSON.parse(b.replace(/^\uFEFF/, "")) : {});
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function rpc(method, params) {
  const r = await post({ jsonrpc: "2.0", id: id++, method, params });
  if (r.error) throw new Error(method + ": " + JSON.stringify(r.error));
  return r.result;
}

async function tool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args || {} });
  if (result && result.isError) throw new Error(name + ": " + JSON.stringify(result));
  const text = ((result && result.content) || []).map((c) => c.text || "").join("\n");
  try {
    return JSON.parse(text);
  } catch (e) {
    return { raw: text };
  }
}

const SLOTS = {
  Jazwyn: "CH_xOVr1MS2DN8qlv1ntZ0VB1IEy3Sp9",
  Sarene: "CH_0EquGf0dJfIrmvKmlb5pa6KfSITh3",
  Zarook: "CH_d4UbsANUGP3e4HGOB2DrwV3uLyeLz",
  Puppygirl: "CH_q7h90Mhg5era0mD5DBIMAKFcLp9xe",
};
const ALL = ["Puppygirl", "Jazwyn", "Sarene", "Zarook"];
const FIGHTERS = ["Jazwyn", "Sarene", "Zarook"];
const MERCH_PATH = path.join(ROOT, "merchant.js");
const BEGIN = "\n/*LIVE_LOOT_PROVE_BEGIN*/\n";
const END = "\n/*LIVE_LOOT_PROVE_END*/\n";
const INJECT =
  BEGIN +
  "setTimeout(function(){(async function(){try{var job={id:\"lootprove\"+Date.now(),t0:Date.now()},i,w,p,es0,dest;" +
  "var LOOT_DEST=__LOOT_DEST__;" +
  "if(typeof ensure_stand===\"function\")await ensure_stand(false);" +
  "es0=character.esize||0;game_log(\"LIVE_LOOT_PROVE start esize=\"+es0);" +
  "for(i=0;i<FIGHTERS.length;i++){w=FIGHTERS[i];dest=LOOT_DEST[w];p=get_player(w);" +
  "if(!p&&dest){game_log(\"LIVE_LOOT_PROVE goto \"+w+\" @\"+dest.map+\",\"+dest.x+\",\"+dest.y);" +
  "try{await smart_move({map:dest.map,x:dest.x,y:dest.y})}catch(e0){game_log(\"LIVE_LOOT_PROVE move \"+((e0&&e0.reason)||e0))}" +
  "await sleep(1000);p=get_player(w)}" +
  "else if(p){game_log(\"LIVE_LOOT_PROVE see \"+w);try{await smart_move({map:p.map,x:p.real_x,y:p.real_y})}catch(e1){}" +
  "await sleep(500)}" +
  "if(!get_player(w)){game_log(\"LIVE_LOOT_PROVE miss \"+w);continue}" +
  "await dlv_loot_from(job,w);await sleep(500)}" +
  "game_log(\"LIVE_LOOT_PROVE done es0=\"+es0+\" esize=\"+character.esize+\" got=\"+(es0-(character.esize||0)));" +
  "}catch(e){game_log(\"LIVE_LOOT_PROVE fail \"+((e&&e.message)||e))}})()},5000);" +
  END;

function enableLootProve(on, dests) {
  let src = fs.readFileSync(MERCH_PATH, "utf8");
  const re = /\n\/\*LIVE_LOOT_PROVE_BEGIN\*\/[\s\S]*?\/\*LIVE_LOOT_PROVE_END\*\/\n/;
  src = src.replace(re, "\n");
  if (on) {
    const body = INJECT.replace("__LOOT_DEST__", JSON.stringify(dests || {}));
    src = src.replace(/\n$/, "") + body;
  }
  fs.writeFileSync(MERCH_PATH, src);
}

function flat(logs) {
  return (logs || []).map((x) => (Array.isArray(x.values) ? x.values.join(" ") : String(x.message || x)));
}

function invNames(ch) {
  const inv = (ch.runtime && ch.runtime.observation && ch.runtime.observation.inventory) || [];
  return inv.filter((it) => it && it.name).map((it) => it.name + (it.level != null ? "@" + it.level : "") + "x" + (it.q || 1));
}

function obsPos(ch) {
  const o = (ch.runtime && ch.runtime.observation) || {};
  const p = ch.profile || {};
  return {
    map: o.map || p.map || "main",
    x: Math.round(o.x != null ? o.x : p.x || 0),
    y: Math.round(o.y != null ? o.y : p.y || 0),
  };
}

async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    if (ch.runtime && ch.runtime.game_connected) {
      console.log("[%s] CONNECTED", name);
      return true;
    }
    await sleep(4000);
  }
  return false;
}

async function deploy() {
  const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
  process.stdout.write(dep.stdout || "");
  if (dep.status) throw new Error("deploy failed");
}

async function main() {
  let ok = false;
  enableLootProve(false);
  try {
    console.log("Deploy fighter/merchant loot fixes...");
    await deploy();

    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "al-loot-prove", version: "1" },
    });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

    console.log("Relink all...");
    for (const c of ALL) {
      try {
        await tool("mainframe_disconnect_character", { character: c });
      } catch (e) {}
    }
    await sleep(20000);
    const stamp = Date.now();
    for (const c of ALL) {
      await tool("mainframe_link_character", {
        character: c,
        request_id: "lootprove-" + c + "-" + stamp,
        code_slot: SLOTS[c],
        server: "US III",
      });
      console.log("link queued", c);
      await sleep(1200);
    }
    for (const c of ALL) {
      if (!(await waitConnected(c, 180000))) throw new Error(c + " connect fail");
    }

    const dests = {};
    for (const c of FIGHTERS) {
      dests[c] = obsPos(await tool("mainframe_get_character", { character: c }));
      console.log("dest", c, dests[c]);
    }

    console.log("Inject LIVE_LOOT_PROVE with coords; relink Puppygirl...");
    enableLootProve(true, dests);
    await deploy();
    try {
      await tool("mainframe_disconnect_character", { character: "Puppygirl" });
    } catch (e) {}
    await sleep(8000);
    await tool("mainframe_link_character", {
      character: "Puppygirl",
      request_id: "lootprove-pup-" + Date.now(),
      code_slot: SLOTS.Puppygirl,
      server: "US III",
    });
    if (!(await waitConnected("Puppygirl", 120000))) throw new Error("Puppygirl reconnect fail");

    const before = {};
    for (const c of ALL) {
      before[c] = invNames(await tool("mainframe_get_character", { character: c }));
      console.log("BEFORE", c, before[c].join(", ") || "(empty)");
    }

    const deadline = Date.now() + 12 * 60 * 1000;
    let done = null;
    const seen = {};
    while (Date.now() < deadline) {
      for (const c of ALL) {
        const raw = await tool("mainframe_get_logs", { character: c, limit: 100 });
        for (const s of flat(raw.logs)) {
          const k = c + "|" + s;
          if (seen[k]) continue;
          seen[k] = 1;
          if (/LIVE_LOOT_PROVE|dlv:loot|dlv:toss|toss /.test(s)) console.log("[" + c.slice(0, 3) + "]", s.slice(0, 220));
          if (c === "Puppygirl" && /LIVE_LOOT_PROVE done/.test(s)) done = s;
        }
      }
      if (done) break;
      await sleep(5000);
    }

    for (const c of ALL) {
      const after = invNames(await tool("mainframe_get_character", { character: c }));
      console.log("AFTER", c, after.join(", ") || "(empty)");
    }

    console.log(done || "NO_DONE_LINE");
    ok = !!(done && /got=[1-9]/.test(done));
    if (!ok) {
      const pup = invNames(await tool("mainframe_get_character", { character: "Puppygirl" }));
      const gained = pup.filter((x) => !before.Puppygirl.includes(x) && !/^[hm]pot/.test(x) && x !== "stand0x1");
      ok = gained.length > 0;
      if (ok) console.log("fallback gained", gained.join(", "));
    }
    console.log(ok ? "LIVE_LOOT_OK" : "LIVE_LOOT_FAIL");
    if (!ok) process.exitCode = 1;
  } finally {
    enableLootProve(false);
    console.log("Redeploy clean merchant...");
    try {
      await deploy();
    } catch (e) {}
  }
}


main().catch((e) => {
  try {
    enableLootProve(false);
  } catch (e2) {}
  console.error(e);
  process.exit(1);
});
