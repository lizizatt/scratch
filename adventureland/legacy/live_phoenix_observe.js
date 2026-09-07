#!/usr/bin/env node
"use strict";
/**
 * Live-verify party cohesion on a phoenix hunt.
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
const MERCHANT = path.join(ROOT, "merchant.js");
const WARRIOR = path.join(ROOT, "warrior.js");
const PRIEST = path.join(ROOT, "priest.js");
const MAGE = path.join(ROOT, "mage.js");
const MARK = "\n/*LIVE_PHOENIX*/\n";

// Multi-line injects (AL dumps failing long lines). Hunt via leader set_hunt — keep merchant ≤176.
const WARRIOR_INJECT =
  MARK +
  [
    "try{farm_ovr=farm=\"phoenix\";game_log(\"LIVE_HUNT_PHOENIX\")}catch(eH){}",
    "setTimeout(function(){",
    "  try{if(typeof hold!==\"undefined\"&&hold&&typeof set_hold===\"function\")set_hold(0,true)}catch(e0){}",
    "  try{set_hunt(\"phoenix\",true)}catch(e1){game_log(\"LIVE_HUNT_FAIL \"+e1)}",
    "},3000);",
    "setInterval(function(){",
    "  try{",
    "    var m=get_nearest_monster({type:\"phoenix\"});",
    "    if(!m){",
    "      if(character._phx){game_log((character._phxDmg?\"LIVE_PHOENIX_KILL \":\"LIVE_PHOENIX_GONE \")+\"id=\"+character._phx);character._phx=0;character._phxDmg=0}",
    "      return;",
    "    }",
    "    if(character._phx!==m.id){game_log(\"LIVE_PHOENIX_SEEN id=\"+m.id+\" hp=\"+Math.floor(m.hp||0)+\" map=\"+character.map);character._phxDmg=0;character._phxHp=m.hp}",
    "    else if(character._phxHp&&m.hp<character._phxHp-50)character._phxDmg=1;",
    "    character._phx=m.id;character._phxHp=m.hp||0;",
    "    game_log(\"LIVE_PHOENIX_HP \"+Math.floor(character._phxHp)+\" dmg=\"+(character._phxDmg?1:0));",
    "  }catch(e){game_log(\"LIVE_PHOENIX_ERR \"+e)}",
    "},3000);",
    "",
  ].join("\n");

const FOLLOWER_INJECT =
  MARK +
  [
    "setTimeout(function(){",
    "  try{if(typeof hold!==\"undefined\"&&hold&&typeof set_hold===\"function\")set_hold(0,false)}catch(e){}",
    "},4000);",
    "",
  ].join("\n");

const MERCHANT_INJECT =
  MARK +
  [
    "try{if(typeof gear_clear===\"function\")gear_clear()}catch(e0){}",
    "try{run_gear_session=async function(){return null}}catch(e1){}",
    "",
  ].join("\n");

function stripMark(file) {
  let src = fs.readFileSync(file, "utf8");
  const i = src.indexOf(MARK);
  if (i >= 0) fs.writeFileSync(file, src.slice(0, i).replace(/\s+$/, "\n"));
}

function applyInjects(on) {
  for (const f of [MERCHANT, WARRIOR, PRIEST, MAGE]) stripMark(f);
  // Restore merchant gear stub swap
  let mer = fs.readFileSync(MERCHANT, "utf8");
  const gearStub =
    "setTimeout(function () { try{run_gear_session=async function(){return null}}catch(e){} if (!(typeof gear_busy === \"function\" && gear_busy())) resume(); }, 3500);";
  const gearNorm =
    "setTimeout(function () { if (!(typeof gear_busy === \"function\" && gear_busy())) resume(); }, 3500);";
  if (mer.includes(gearStub)) mer = mer.replace(gearStub, gearNorm);
  fs.writeFileSync(MERCHANT, mer.replace(/\s+$/, "\n"));
  if (!on) return;
  mer = fs.readFileSync(MERCHANT, "utf8");
  if (!mer.includes(gearNorm)) throw new Error("merchant resume timeout line missing");
  fs.writeFileSync(MERCHANT, mer.replace(gearNorm, gearStub).replace(/\s+$/, "\n"));
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

function posOf(ch) {
  const obs = (ch.runtime && ch.runtime.observation) || {};
  const p = ch.profile || {};
  const rt = ch.runtime || {};
  const serverStr = String(rt.server || "");
  let region = rt.server_region || null;
  let ident = rt.server_identifier || null;
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
  };
}

function dist(a, b) {
  if (!a || !b || a.map !== b.map) return 1e9;
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function interestingLog(s) {
  if (/code\/main\.js:|function\(\)|setInterval\(function/i.test(s)) return false;
  return /LIVE_|Port town|Transfer |wait party|party here|Hunt |Off to|Form|Chase|World |go_s|ReferenceError|TypeError|You can't chat/i.test(
    s
  );
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
  const farmMs = Number(process.env.PHOENIX_MS || 18 * 60 * 1000);
  const result = {
    started: new Date().toISOString(),
    hunt: { dispatched: false, huntingMsgs: 0, seen: 0, gone: 0, killLikely: false },
    cohesion: {
      announces: [],
      waitParty: 0,
      partyHere: 0,
      waitTimeout: 0,
      splitPolls: 0,
      togetherPolls: 0,
      maxSameMapSpread: 0,
      samples: [],
    },
    errs: [],
  };

  applyInjects(true);
  try {
    deploy();
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "al-phoenix-obs", version: "2" },
    });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

    const dash = await tool("mainframe_get_dashboard", {});
    console.log("dash free=", dash.free_time && dash.free_time.remaining_hours, "shells=", dash.shells);

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
          request_id: "phx2-" + c + "-" + stamp,
          code_slot: SLOTS[c],
          server: "US III",
        });
        console.log("link", c, link.failed ? link.reason : "ok");
        if (!link.failed) ok++;
        await sleep(1500);
      }
      if (ok === 4) break;
    }
    for (const c of ALL) {
      if (!(await waitConnected(c, 180000))) throw new Error(c + " connect fail");
    }

    const cut = Date.now() - 2000;
    const seen = {};
    const farmEnd = Date.now() + farmMs;
    console.log("=== PHOENIX OBSERVE", Math.round(farmMs / 60000), "m ===");

    while (Date.now() < farmEnd) {
      const fpos = [];
      let hunting = 0;

      for (const c of ALL) {
        const ch = await tool("mainframe_get_character", { character: c });
        const pos = posOf(ch);
        if (FIGHTERS.indexOf(c) >= 0) {
          fpos.push({ name: c, pos });
          if (/phoenix|Wait party|Form|Chase|Off to|Transfer/i.test(pos.msg)) hunting++;
        }

        const logs = await tool("mainframe_get_logs", { character: c, limit: 80 });
        for (const e of logs.logs || []) {
          const at = Date.parse(e.at || 0);
          if (!(at >= cut)) continue;
          const s = Array.isArray(e.values) ? e.values.join(" ") : String(e.message || e);
          const sk = c + "|" + e.at + "|" + s;
          if (seen[sk]) continue;
          seen[sk] = 1;
          if (interestingLog(s)) console.log("LOG", c, s.slice(0, 220));
          if (/LIVE_HUNT_PHOENIX|Let's kill phoenix/i.test(s)) result.hunt.dispatched = true;
          if (/Hunt phoenix|Off to phoenix|Transfer phoenix|Let's kill phoenix|LIVE_HUNT_PHOENIX/i.test(s)) result.hunt.huntingMsgs++;
          if (/LIVE_PHOENIX_SEEN/i.test(s) && !/function/i.test(s)) result.hunt.seen++;
          if (/LIVE_PHOENIX_KILL/i.test(s) && !/function/i.test(s)) {
            result.hunt.killLikely = true;
            result.hunt.gone++;
          }
          if (/LIVE_PHOENIX_GONE/i.test(s) && !/function/i.test(s)) result.hunt.gone++;
          if (/Port town|Transfer |psay out (Port town|Transfer |World )/i.test(s)) {
            result.cohesion.announces.push(c + ":" + s.slice(0, 80));
          }
          if (/\bwait party\b/i.test(s) && !/timeout/i.test(s)) result.cohesion.waitParty++;
          if (/party here/i.test(s)) result.cohesion.partyHere++;
          if (/wait party timeout/i.test(s)) result.cohesion.waitTimeout++;
          if (/ReferenceError|TypeError|logistics fail/i.test(s)) result.errs.push(c + ":" + s.slice(0, 120));
        }
      }

      const maps = {};
      for (const f of fpos) {
        const m = (f.pos && f.pos.map) || "?";
        maps[m] = (maps[m] || 0) + 1;
      }
      const mapKeys = Object.keys(maps);
      const together = mapKeys.length === 1 && fpos.length === 3;
      if (together) {
        result.cohesion.togetherPolls++;
        let spread = 0;
        for (let i = 0; i < fpos.length; i++) {
          for (let j = i + 1; j < fpos.length; j++) {
            spread = Math.max(spread, dist(fpos[i].pos, fpos[j].pos));
          }
        }
        result.cohesion.maxSameMapSpread = Math.max(result.cohesion.maxSameMapSpread, spread);
      } else if (fpos.length === 3) {
        result.cohesion.splitPolls++;
      }

      const sample = {
        t: new Date().toISOString(),
        maps: mapKeys,
        together,
        msgs: fpos.map((f) => f.name + ":" + (f.pos.msg || "").slice(0, 28)),
      };
      result.cohesion.samples.push(sample);
      console.log(
        "phx hunt~=%s together=%s split=%s seen=%s kill=%s | %s",
        hunting,
        result.cohesion.togetherPolls,
        result.cohesion.splitPolls,
        result.hunt.seen,
        result.hunt.killLikely ? 1 : 0,
        sample.msgs.join(" || ")
      );

      if (result.hunt.killLikely && result.cohesion.togetherPolls >= 3 && result.hunt.dispatched) {
        console.log("early pass: phoenix kill + cohesion");
        break;
      }
      await sleep(12000);
    }

    const polls = result.cohesion.togetherPolls + result.cohesion.splitPolls;
    const togetherRatio = polls ? result.cohesion.togetherPolls / polls : 0;
    result.cohesion.togetherRatio = togetherRatio;
    result.cohesionPass =
      togetherRatio >= 0.55 &&
      result.cohesion.waitTimeout <= 3 &&
      (result.cohesion.announces.length > 0 || result.cohesion.partyHere > 0 || result.hunt.huntingMsgs > 0);
    result.huntPass = !!(
      (result.hunt.dispatched || result.hunt.huntingMsgs >= 2) &&
      (result.hunt.seen > 0 || result.hunt.huntingMsgs >= 2)
    );
    result.killPass = !!result.hunt.killLikely;
    result.pass = !!(result.cohesionPass && result.huntPass && result.killPass && result.errs.length === 0);
    result.finished = new Date().toISOString();
    fs.writeFileSync(path.join(ROOT, "_live_phoenix_observe.json"), JSON.stringify(result, null, 2));
    console.log("RESULT", JSON.stringify(result, null, 2));
    if (!result.pass) process.exitCode = 1;
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
