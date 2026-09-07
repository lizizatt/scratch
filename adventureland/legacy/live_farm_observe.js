#!/usr/bin/env node
"use strict";
/**
 * Observe-verify farming: resume, hunt armadillo, watch pack arrival,
 * instrument world hops (exact region+id — never /US II/ prefix match).
 * Does NOT dispatch world overrides; reports unnecessary hops during farm.
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
      { hostname: "adventure.land", path: "/mcp", method: "POST", headers: Object.assign({}, headers, { "Content-Length": data.length }) },
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
async function rpc(m, p) {
  const r = await post({ jsonrpc: "2.0", id: id++, method: m, params: p });
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result;
}
async function tool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args || {} });
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
const ALL = ["Puppygirl", "Sarene", "Zarook", "Jazwyn"];
const FIGHTERS = ["Jazwyn", "Sarene", "Zarook"];
const ARM = { map: "main", x: 526, y: 1846, r: 500 };
const MERCHANT = path.join(ROOT, "merchant.js");
const WARRIOR = path.join(ROOT, "warrior.js");
const PRIEST = path.join(ROOT, "priest.js");
const MAGE = path.join(ROOT, "mage.js");
const MARK = "\n/*LIVE_FARM_OBS*/\n";

const HOP_WRAP =
  `(function(){if(typeof change_server!=="function"||change_server.__hopLog)return;var o=change_server;change_server=function(r,i){try{game_log("HOP "+r+"/"+i+" from "+(parent.server_region||"?")+"/"+(parent.server_identifier||"?")+" why="+((typeof gear_busy==="function"&&gear_busy())?"gear":(typeof hold!=="undefined"&&hold)?"hold":"other"))}catch(e){}return o.apply(this,arguments)};change_server.__hopLog=1})();\n`;

const GEAR_STUB =
  'setTimeout(function () { try{run_gear_session=async function(){return null}}catch(e){} if (!(typeof gear_busy === "function" && gear_busy())) resume(); }, 3500);';
const GEAR_NORM =
  'setTimeout(function () { if (!(typeof gear_busy === "function" && gear_busy())) resume(); }, 3500);';

// Keep merchant ≤176: swap resume line + tiny hunt inject via warrior set_hunt fallback.
const MERCHANT_INJECT =
  MARK +
  HOP_WRAP +
  [
    "try{if(typeof gear_clear===\"function\")gear_clear()}catch(e0){}",
    "setTimeout(function(){try{hunt(\"armadillo\");game_log(\"LIVE_HUNT_ARMADILLO\")}catch(e){game_log(\"LIVE_HUNT_FAIL \"+e)}},4000);",
    "",
  ].join("\n");

const WARRIOR_INJECT =
  MARK +
  HOP_WRAP +
  [
    "try{farm_ovr=farm=\"armadillo\";game_log(\"LIVE_HUNT_ARMADILLO\")}catch(eH){}",
    "setTimeout(function(){try{if(hold&&typeof set_hold===\"function\")set_hold(0,true)}catch(e0){}try{set_hunt(\"armadillo\",true)}catch(e1){}},3000);",
    "setInterval(function(){try{game_log(\"LIVE_SRV \"+(parent.server_region||\"?\")+\"/\"+(parent.server_identifier||\"?\")+\" hold=\"+(hold?1:0)+\" ovr=\"+(farm_ovr||\"-\")+\" q=\"+(psay_q?psay_q.length:0))}catch(e){}},15000);",
    "",
  ].join("\n");

const FOLLOWER_INJECT =
  MARK +
  HOP_WRAP +
  [
    "setTimeout(function(){try{if(hold&&typeof set_hold===\"function\")set_hold(0,false)}catch(e){}},3000);",
    "setInterval(function(){try{game_log(\"LIVE_SRV \"+(parent.server_region||\"?\")+\"/\"+(parent.server_identifier||\"?\")+\" hold=\"+(hold?1:0)+\" ovr=\"+(farm_ovr||\"-\"))}catch(e){}},15000);",
    "",
  ].join("\n");

function stripMark(file) {
  let src = fs.readFileSync(file, "utf8");
  const i = src.indexOf(MARK);
  if (i >= 0) fs.writeFileSync(file, src.slice(0, i).replace(/\s+$/, "\n"));
}

function applyInjects(on) {
  for (const f of [MERCHANT, WARRIOR, PRIEST, MAGE]) stripMark(f);
  let mer = fs.readFileSync(MERCHANT, "utf8");
  if (mer.includes(GEAR_STUB)) mer = mer.replace(GEAR_STUB, GEAR_NORM);
  fs.writeFileSync(MERCHANT, mer.replace(/\s+$/, "\n"));
  if (!on) return;
  mer = fs.readFileSync(MERCHANT, "utf8");
  if (!mer.includes(GEAR_NORM)) throw new Error("merchant resume line missing");
  // Prefer gear stub swap (same line count); append only hop+hunt if still ≤176
  fs.writeFileSync(MERCHANT, mer.replace(GEAR_NORM, GEAR_STUB).replace(/\s+$/, "\n"));
  const huntOnly =
    MARK +
    [
      "setTimeout(function(){try{hunt(\"armadillo\");game_log(\"LIVE_HUNT_ARMADILLO\")}catch(e){game_log(\"LIVE_HUNT_FAIL \"+e)}},4000);",
      "",
    ].join("\n");
  const withHunt = fs.readFileSync(MERCHANT, "utf8") + huntOnly;
  const huntLines = withHunt.replace(/\s+$/, "").split(/\r?\n/).length;
  if (huntLines <= 176) fs.writeFileSync(MERCHANT, withHunt.replace(/\s+$/, "\n"));
  else {
    // warrior self-hunts; merchant only stubs gear
    console.log("merchant at cap; hunt via warrior inject only");
  }
  fs.appendFileSync(WARRIOR, WARRIOR_INJECT);
  fs.appendFileSync(PRIEST, FOLLOWER_INJECT);
  fs.appendFileSync(MAGE, FOLLOWER_INJECT);
  const mc = fs.readFileSync(MERCHANT, "utf8").replace(/\s+$/, "").split(/\r?\n/).length;
  if (mc > 176) throw new Error("merchant.js exceeds 176 lines: " + mc);
}

function deploy() {
  const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
  process.stdout.write(dep.stdout || "");
  if (dep.status) throw new Error("deploy failed");
}

function potCounts(inv) {
  let hp = 0, mp = 0;
  for (const it of inv || []) {
    if (!it || !it.name) continue;
    if (("" + it.name).indexOf("hpot") === 0) hp += it.q || 1;
    if (("" + it.name).indexOf("mpot") === 0) mp += it.q || 1;
  }
  return { hp, mp };
}

function posOf(ch) {
  const obs = (ch.runtime && ch.runtime.observation) || {};
  const p = ch.profile || {};
  const rt = ch.runtime || {};
  const serverStr = String(rt.server || "");
  let region = rt.server_region || null;
  let ident = rt.server_identifier || null;
  // Prefer exact fields; fall back to splitting "US III" (never treat "US III" as II)
  if ((!region || !ident) && serverStr) {
    const parts = serverStr.trim().split(/\s+/);
    if (parts.length >= 2) {
      region = region || parts[0];
      ident = ident || parts.slice(1).join(" ");
    }
  }
  return {
    map: obs.map || p.map,
    x: obs.x != null ? obs.x : p.x,
    y: obs.y != null ? obs.y : p.y,
    region,
    ident,
    serverKey: region && ident ? region + "/" + ident : serverStr || "?",
    msg: String(rt.message || rt.status_message || ""),
    connected: !!(rt.game_connected),
    pots: potCounts(obs.items || obs.inventory || p.inventory),
  };
}

function nearArm(pos) {
  return (
    pos &&
    pos.map === ARM.map &&
    Math.abs((pos.x || 0) - ARM.x) < ARM.r &&
    Math.abs((pos.y || 0) - ARM.y) < ARM.r
  );
}

function dist(a, b) {
  if (!a || !b || a.map !== b.map) return 1e9;
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
}


function isUSIII(pos) {
  return pos && pos.region === "US" && pos.ident === "III";
}

async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    if (ch.runtime && ch.runtime.game_connected) {
      console.log("[%s] CONNECTED %s", name, JSON.stringify(posOf(ch)));
      return true;
    }
    console.log("[%s] waiting %s", name, (ch.runtime && ch.runtime.phase) || "?");
    await sleep(4000);
  }
  return false;
}

async function main() {
  const farmMs = Number(process.env.FARM_MS || 12 * 60 * 1000);
  const noDeploy = process.argv.includes("--no-deploy");
  const noRelink = process.argv.includes("--no-relink");
  const result = {
    started: new Date().toISOString(),
    hunt: { dispatched: false, huntingMsgs: 0, onPack: 0, allHunting: false, farmOk: false, statusOut: 0 },
    cohesion: {
      togetherPolls: 0,
      splitPolls: 0,
      maxSameMapSpread: 0,
      attendanceMiss: 0,
      partyHere: 0,
      waitTimeout: 0,
      restockFail: 0,
      announces: 0,
    },
    worlds: { hops: [], byChar: {}, unnecessary: [], notes: [] },
    chat: { throttle: 0, psayOut: 0, psayDrop: 0, psayFail: 0, samples: [] },
    stuck: {},
    chatThrottle: 0,
    errs: [],
  };

  applyInjects(true);
  try {
    if (!noDeploy) deploy();

    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "al-farm-obs", version: "1" },
    });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

    const dash = await tool("mainframe_get_dashboard", {});
    console.log(
      "dash free=",
      dash.free_time && dash.free_time.remaining_hours,
      "shells=",
      dash.shells
    );

    let needLink = !noRelink;
    if (noRelink) {
      needLink = false;
      for (const c of ALL) {
        const ch = await tool("mainframe_get_character", { character: c });
        if (!(ch.runtime && ch.runtime.game_connected)) needLink = true;
      }
    }
    if (needLink) {
      for (let round = 0; round < 3; round++) {
        for (const c of ALL) {
          try {
            await tool("mainframe_disconnect_character", { character: c });
          } catch (e) {}
        }
        console.log("wait 60s (round " + (round + 1) + ")...");
        await sleep(60000);
        const stamp = Date.now();
        let ok = 0;
        for (const c of ALL) {
          const link = await tool("mainframe_link_character", {
            character: c,
            request_id: "farm-" + c + "-" + stamp,
            code_slot: SLOTS[c],
            server: "US III",
          });
          console.log("link", c, link.failed ? link.reason : "ok");
          if (!link.failed) ok++;
          await sleep(1500);
        }
        if (ok === 4) break;
      }
    }
    for (const c of ALL) {
      if (!(await waitConnected(c, 180000))) throw new Error(c + " connect fail");
    }

    const cut = Date.now() - 2000;
    const seen = {};
    const lastPos = {};
    const stuckHits = {};
    const farmEnd = Date.now() + farmMs;
    console.log("=== FARM OBSERVE", Math.round(farmMs / 60000), "m armadillo pack @", ARM.x, ARM.y, "===");

    while (Date.now() < farmEnd) {
      let hunting = 0;
      let onPack = 0;
      let connected = 0;
      const bits = [];
      const row = { t: new Date().toISOString(), chars: {} };
      const fpos = [];

      for (const c of ALL) {
        const ch = await tool("mainframe_get_character", { character: c });
        const pos = posOf(ch);
        row.chars[c] = pos;
        if (pos.connected) connected++;
        result.worlds.byChar[c] = result.worlds.byChar[c] || [];
        const prev = result.worlds.byChar[c][result.worlds.byChar[c].length - 1];
        if (!prev || prev.serverKey !== pos.serverKey) {
          result.worlds.byChar[c].push({ t: row.t, serverKey: pos.serverKey, map: pos.map });
          if (prev) {
            const hop = { who: c, from: prev.serverKey, to: pos.serverKey, t: row.t, map: pos.map };
            result.worlds.hops.push(hop);
            console.log("WORLD_CHANGE", JSON.stringify(hop));
            if (isUSIII({ region: (prev.serverKey || "").split("/")[0], ident: (prev.serverKey || "").split("/")[1] }) && !isUSIII(pos)) {
              result.worlds.unnecessary.push(hop);
              result.worlds.notes.push(c + " left US/III -> " + pos.serverKey);
            }
          }
        }

        const key = [pos.map, Math.round(pos.x || 0), Math.round(pos.y || 0)].join(",");
        stuckHits[c] = lastPos[c] === key ? (stuckHits[c] || 0) + 1 : 0;
        lastPos[c] = key;
        if (stuckHits[c] >= 8) result.stuck[c] = (result.stuck[c] || 0) + 1;

        if (FIGHTERS.indexOf(c) >= 0) {
          fpos.push({ name: c, pos });
          if (/armadillo/i.test(pos.msg) || nearArm(pos)) hunting++;
          if (nearArm(pos)) onPack++;
        }

        const logs = await tool("mainframe_get_logs", { character: c, limit: 80 });
        for (const e of logs.logs || []) {
          const at = Date.parse(e.at || 0);
          if (!(at >= cut)) continue;
          const sLog = Array.isArray(e.values) ? e.values.join(" ") : String(e.message || e);
          const sk = c + "|" + e.at + "|" + sLog;
          if (seen[sk]) continue;
          seen[sk] = 1;
          if (
            /HOP |LIVE_|Hunt |Off to|Form|Chase|Port town|Transfer |wait party|party here|World |go_s|restock fail|gear:hop|Resume|Hold|dlv:|cm fail|ReferenceError|TypeError|You can't chat|chat this fast|busy timeout|logistics fail|psay /i.test(
              sLog
            )
          ) {
            console.log("LOG", c, sLog.slice(0, 220));
          }
          if (/LIVE_HUNT_ARMADILLO|Hunt armadillo|Let's kill armadillo|Transfer armadillo/i.test(sLog)) result.hunt.dispatched = true;
          if (/Hunt armadillo/i.test(sLog)) result.hunt.huntingMsgs++;
          if (/You can't chat|chat this fast/i.test(sLog)) {
            result.chat.throttle++;
            result.chatThrottle++;
            result.chat.samples.push(c + ":" + sLog.slice(0, 100));
          }
          if (/psay out /i.test(sLog)) {
            result.chat.psayOut++;
            if (/psay out ~s /i.test(sLog)) result.hunt.statusOut++;
          }
          if (/psay drop /i.test(sLog)) result.chat.psayDrop++;
          if (/psay fail/i.test(sLog)) result.chat.psayFail++;
          if (/party here/i.test(sLog)) result.cohesion.partyHere++;
          if (/wait party timeout/i.test(sLog)) result.cohesion.waitTimeout++;
          if (/restock fail/i.test(sLog)) result.cohesion.restockFail++;
          if (/Port town|Transfer |psay out (Port town|Transfer |World )/i.test(sLog)) result.cohesion.announces++;
          if (/ReferenceError|TypeError|logistics fail|busy timeout/i.test(sLog)) result.errs.push(c + ":" + sLog.slice(0, 120));
          const hm = sLog.match(/HOP\s+(\w+)\/(\w+)\s+from\s+(\S+)\s+why=(\w+)/);
          if (hm) {
            result.worlds.hops.push({
              who: c,
              to: hm[1] + "/" + hm[2],
              from: hm[3],
              why: hm[4],
              t: new Date(at).toISOString(),
              src: "HOP_LOG",
            });
            if (hm[4] === "gear" || hm[4] === "hold") {
              result.worlds.notes.push(c + " hop why=" + hm[4] + " " + hm[3] + "->" + hm[1] + "/" + hm[2]);
            }
          }
          const gm = sLog.match(/go_s:([A-Z]+)\/([A-Z0-9]+)\s+from\s+([A-Z]+)\/([A-Z0-9]+)/);
          if (gm) {
            result.worlds.hops.push({
              who: c,
              to: gm[1] + "/" + gm[2],
              from: gm[3] + "/" + gm[4],
              why: "go_s",
              t: new Date(at).toISOString(),
              src: "GO_S",
            });
          }
        }

        bits.push(
          c.slice(0, 3) +
            ":" +
            (pos.msg || "-").slice(0, 12) +
            "@" +
            (pos.map || "?") +
            " " +
            Math.round(pos.x || 0) +
            "," +
            Math.round(pos.y || 0) +
            " " +
            pos.serverKey +
            " p=" +
            pos.pots.hp +
            "/" +
            pos.pots.mp +
            " st=" +
            (stuckHits[c] || 0)
        );
      }

      if (connected < 4) result.cohesion.attendanceMiss++;
      const maps = {};
      for (const f of fpos) {
        const m = (f.pos && f.pos.map) || "?";
        maps[m] = (maps[m] || 0) + 1;
      }
      const together = Object.keys(maps).length === 1 && fpos.length === 3;
      if (together) {
        result.cohesion.togetherPolls++;
        let spread = 0;
        for (let i = 0; i < fpos.length; i++) {
          for (let j = i + 1; j < fpos.length; j++) {
            spread = Math.max(spread, dist(fpos[i].pos, fpos[j].pos));
          }
        }
        result.cohesion.maxSameMapSpread = Math.max(result.cohesion.maxSameMapSpread, Math.min(spread, 1e5));
      } else if (fpos.length === 3) {
        result.cohesion.splitPolls++;
      }

      result.hunt.onPack = Math.max(result.hunt.onPack, onPack);
      if (hunting >= 3) result.hunt.allHunting = true;
      if (onPack >= 3) result.hunt.farmOk = true;

      const cohPolls = result.cohesion.togetherPolls + result.cohesion.splitPolls;
      console.log(
        "farm hunt=%s pack=%s together=%s/%s spread=%s hops=%s chatThr=%s errs=%s | %s",
        hunting,
        onPack,
        result.cohesion.togetherPolls,
        cohPolls,
        Math.round(result.cohesion.maxSameMapSpread),
        result.worlds.hops.length,
        result.chat.throttle,
        result.errs.length,
        bits.join(" || ")
      );

      const chatClean = result.chat.throttle === 0 && result.chat.psayFail === 0;
      const cohOk =
        cohPolls >= 4 &&
        result.cohesion.togetherPolls / cohPolls >= 0.7 &&
        result.cohesion.restockFail === 0 &&
        result.cohesion.waitTimeout <= 2;
      if (result.hunt.farmOk && result.hunt.dispatched && chatClean && cohOk && Date.now() - (cut + 2000) > 120000) {
        console.log("early pass: pack + cohesion + chat clean");
        break;
      }
      await sleep(15000);
    }

    const cohPolls = result.cohesion.togetherPolls + result.cohesion.splitPolls;
    result.cohesion.togetherRatio = cohPolls ? result.cohesion.togetherPolls / cohPolls : 0;
    result.finished = new Date().toISOString();
    result.chatPass = result.chat.throttle === 0 && result.chat.psayFail === 0;
    result.worldPass = result.worlds.unnecessary.length === 0;
    result.cohesionPass =
      result.cohesion.togetherRatio >= 0.7 &&
      result.cohesion.attendanceMiss === 0 &&
      result.cohesion.restockFail === 0 &&
      result.cohesion.waitTimeout <= 2 &&
      result.errs.length === 0;
    result.pass = !!(
      result.hunt.farmOk &&
      result.hunt.dispatched &&
      result.chatPass &&
      result.worldPass &&
      result.cohesionPass
    );
    fs.writeFileSync(path.join(ROOT, "_live_farm_observe.json"), JSON.stringify(result, null, 2));
    console.log("RESULT", JSON.stringify(result, null, 2));
    if (!result.pass) process.exitCode = 1;
    if (result.chat.psayDrop) console.log("NOTE psay drops (non-fatal):", result.chat.psayDrop);

  } finally {
    applyInjects(false);
    try {
      deploy();
      console.log("cleaned inject; redeployed");
    } catch (e) {
      console.log("cleanup warn", e.message || e);
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  try {
    applyInjects(false);
  } catch (e2) {}
  process.exit(1);
});
