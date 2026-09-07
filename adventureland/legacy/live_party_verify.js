#!/usr/bin/env node
"use strict";
/**
 * Live party verify (Mainframe):
 *  1) sshield: Zarook → Puppygirl upgrade → Jazwyn equip
 *  2) hunt armadillo + farm/restock observe (~10m)
 *  3) world US II + resume armadillo + deliver observe (~12m)
 *
 * Usage: node adventureland/live_party_verify.js
 * Env: PHASE1_MS (default 480000), FARM_MS (600000), WORLD_MS (720000)
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
const ALL = ["Puppygirl", "Sarene", "Zarook", "Jazwyn"];
const START_SERVER = "US III";
const WORLD_OVERRIDE = "US II";

const PRIEST = path.join(ROOT, "priest.js");
const MERCHANT = path.join(ROOT, "merchant.js");
const WARRIOR = path.join(ROOT, "warrior.js");
const MARK_P = "\n/*LIVE_VERIFY_PRIEST*/\n";
const MARK_M = "\n/*LIVE_VERIFY_MERCHANT*/\n";
const MARK_W = "\n/*LIVE_VERIFY_WARRIOR*/\n";

const FARM_MS = Number(process.env.FARM_MS || 10 * 60 * 1000);

const PRIEST_INJECT =
  MARK_P +
  `(function(){var g=0,busy=0;try{if(typeof set_hold==="function")set_hold(1,false)}catch(eH){}setInterval(async function(){if(busy||g)return;busy=1;try{if(character.slots.offhand&&character.slots.offhand.name==="sshield"){try{unequip("offhand");await sleep(200)}catch(eU){}}var i=locate_item("sshield");if(i<0){g=1;busy=0;return}var m=get_player("Puppygirl");if(m&&!m.rip&&parent.distance(character,m)<=320){await send_item("Puppygirl",i,1);game_log("LIVE_SSH_GIVE_OK");g=1}else{set_message("SSH give");if(!smart.moving){try{await smart_move({map:"main",x:-100,y:-180})}catch(e){}}}}catch(e){game_log("LIVE_SSH_GIVE_FAIL "+((e&&e.reason)||e))}busy=0},2500)})();\n`;

const MERCHANT_INJECT =
  MARK_M +
  `(function(){var up=0,sent=0,hunted=0,worlded=0,huntAt=0,busy=0,tries=0,farmMs=${FARM_MS};try{hold()}catch(eH){}setInterval(async function(){if(busy)return;busy=1;try{var i=locate_item("sshield");if(i<0&&!up){set_message("SSH wait");if(!smart.moving){try{await smart_move({map:"main",x:-100,y:-180})}catch(eW){}}busy=0;return}if(i>=0&&!up){set_message("UpSSH");var it0=character.items[i];if(it0&&(it0.level||0)>=1){up=1;game_log("LIVE_SSH_UP_OK already+"+(it0.level||0))}else if(tries>=4){up=1;game_log("LIVE_SSH_UP_SKIP +"+(it0&&it0.level||0))}else{tries++;var sci=locate_item("scroll0");if(sci<0){game_log("LIVE_SSH_UP buy_scroll");if((await buy_scroll("scroll0"))==="bought")sci=locate_item("scroll0")}if(sci<0){game_log("LIVE_SSH_UP no_scroll");busy=0;return}try{close_stand()}catch(eC){}try{await smart_move({map:"main",x:-207,y:-220});game_log("LIVE_SSH_AT_NPC")}catch(eM){game_log("LIVE_SSH_NPC_FAIL "+((eM&&eM.reason)||eM));busy=0;return}i=locate_item("sshield");sci=locate_item("scroll0");if(i<0||sci<0){busy=0;return}try{await upgrade(i,sci);await wait_q("upgrade");up=1;game_log("LIVE_SSH_UP_OK")}catch(eU){game_log("LIVE_SSH_UP fail "+((eU&&eU.reason)||eU))}}}i=locate_item("sshield");if(up&&i>=0&&!sent){var j=get_player("Jazwyn");if(j&&!j.rip&&parent.distance(character,j)<=320){var lv=(character.items[i].level||0);await send_item("Jazwyn",i,1);try{send_cm("Jazwyn",{gear_offer:1,name:"sshield",level:lv,slot:"offhand",id:"ssh"+Date.now()})}catch(e0){}game_log("LIVE_SSH_SEND_OK lv="+lv);sent=1;try{resume()}catch(eR){}}else{set_message("SSH wait J");if(!smart.moving){try{await smart_move({map:"main",x:-100,y:-180})}catch(e1){}}}}if(sent&&!hunted){hunt("armadillo");game_log("LIVE_HUNT_ARMADILLO");hunted=1;huntAt=Date.now()}if(hunted&&!worlded&&huntAt&&Date.now()-huntAt>=farmMs){world("${WORLD_OVERRIDE}");game_log("LIVE_WORLD_CMD ${WORLD_OVERRIDE}");try{send_cm("Jazwyn",{world:["US","II"]})}catch(e2){}worlded=1}}catch(e){game_log("LIVE_SSH_MERR "+((e&&e.message)||e))}busy=0},3000)})();\n`;

const WARRIOR_INJECT =
  MARK_W +
  `(function(){var armed=0,busy=0;try{if(typeof set_hold==="function")set_hold(1,false)}catch(eH){}setInterval(async function(){var s=character.slots&&character.slots.offhand;if(s&&s.name==="sshield"){if(!armed){armed=1;game_log("LIVE_SSH_EQUIP_OK +"+(s.level||0));try{if(typeof set_hold==="function")set_hold(0,true)}catch(eR){}try{party_say("!hunt armadillo")}catch(e){}}return}if(busy)return;busy=1;try{var i=locate_item("sshield");if(i>=0){try{await equip(i,"offhand")}catch(eE){try{await equip_pending()}catch(eP){}}}else{set_message("SSH recv");if(!smart.moving){try{await smart_move({map:"main",x:-100,y:-180})}catch(eM){}}}}catch(e){}busy=0},2000)})();\n`;

function stripInject(file, mark) {
  let src = fs.readFileSync(file, "utf8");
  const i = src.indexOf(mark);
  if (i >= 0) src = src.slice(0, i);
  fs.writeFileSync(file, src);
}

function applyInjects(on) {
  stripInject(PRIEST, MARK_P);
  stripInject(MERCHANT, MARK_M);
  stripInject(WARRIOR, MARK_W);
  if (!on) return;
  fs.appendFileSync(PRIEST, PRIEST_INJECT);
  fs.appendFileSync(MERCHANT, MERCHANT_INJECT);
  fs.appendFileSync(WARRIOR, WARRIOR_INJECT);
}

function deploy() {
  const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
  process.stdout.write(dep.stdout || "");
  if (dep.status) throw new Error("deploy failed");
}

async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    if (ch.runtime && ch.runtime.game_connected) {
      console.log("[%s] CONNECTED map=%s", name, (ch.profile && ch.profile.map) || "?");
      return ch;
    }
    console.log("[%s] waiting %s", name, (ch.runtime && ch.runtime.phase) || "?");
    await sleep(5000);
  }
  return null;
}

function potCounts(inv) {
  let hp = 0,
    mp = 0;
  for (const it of inv || []) {
    if (!it || !it.name) continue;
    if (("" + it.name).indexOf("hpot") === 0) hp += it.q || 1;
    if (("" + it.name).indexOf("mpot") === 0) mp += it.q || 1;
  }
  return { hp, mp };
}

function invOf(ch) {
  return (
    (ch.runtime && ch.runtime.observation && ch.runtime.observation.inventory) ||
    (ch.profile && ch.profile.inventory) ||
    []
  );
}

function slotsOf(ch) {
  return (
    (ch.runtime && ch.runtime.observation && ch.runtime.observation.slots) ||
    (ch.profile && ch.profile.slots) ||
    {}
  );
}

function posOf(ch) {
  const obs = (ch.runtime && ch.runtime.observation) || {};
  const p = ch.profile || {};
  const rt = ch.runtime || {};
  return {
    map: obs.map || p.map,
    x: obs.x != null ? obs.x : p.x,
    y: obs.y != null ? obs.y : p.y,
    server: rt.server || rt.server_region || p.server || null,
    region: rt.server_region || null,
    ident: rt.server_identifier || null,
  };
}

function findItem(inv, name) {
  return (inv || []).find((it) => it && it.name === name) || null;
}

async function main() {
  const phase1Ms = Number(process.env.PHASE1_MS || 8 * 60 * 1000);
  const farmMs = FARM_MS;
  const worldMs = Number(process.env.WORLD_MS || 12 * 60 * 1000);
  const result = {
    started: new Date().toISOString(),
    startServer: START_SERVER,
    worldOverride: WORLD_OVERRIDE,
    shield: { give: false, up: false, send: false, equip: false, level: null },
    hunt: { dispatched: false, allHunting: false },
    restock: { dlvOk: 0, pupStuckHits: 0, chatThrottle: 0, notes: [] },
    world: { dispatched: false, switched: false, huntingAfter: false, dlvOk: 0 },
    errs: [],
    ok: false,
  };

  applyInjects(true);
  try {
    console.log("Deploy LIVE_VERIFY injects (farmMs=%s)...", farmMs);
    deploy();

    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "al-party-verify", version: "1.0" },
    });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

    console.log("Disconnect all...");
    for (const c of ALL) {
      try {
        await tool("mainframe_disconnect_character", { character: c });
      } catch (e) {}
    }
    console.log("Wait 55s...");
    await sleep(55000);

    const stamp = Date.now();
    const cut = Date.now() - 2000;
    let linkPass = 0;
    while (linkPass < 4) {
      linkPass++;
      let failed = null;
      for (const c of ALL) {
        try {
          await tool("mainframe_link_character", {
            character: c,
            request_id: "verify-" + c + "-" + stamp + "-p" + linkPass,
            code_slot: SLOTS[c],
            server: START_SERVER,
          });
          console.log("link", c, START_SERVER);
          await sleep(1500);
        } catch (e) {
          failed = String(e.message || e);
          console.log("link fail", c, failed.slice(0, 160));
          break;
        }
      }
      if (!failed) break;
      for (const x of ALL) {
        try {
          await tool("mainframe_disconnect_character", { character: x });
        } catch (e2) {}
      }
      await sleep(55000);
    }
    for (const c of ALL) {
      if (!(await waitConnected(c, 180000))) throw new Error(c + " connect fail");
    }

    const seen = {};
    const lastPos = {};
    const stuck = {};
    const interesting =
      /LIVE_|dlv:|Hunt |Off to|Form|World |go_s|Dlv |Upgrade|UpSSH|SSH |cm fail|ReferenceError|TypeError|logistics fail|You can't chat|chat this fast|busy timeout/i;

    async function pollLogs(phase) {
      for (const c of ALL) {
        const raw = await tool("mainframe_get_logs", { character: c, limit: 100 });
        for (const entry of raw.logs || []) {
          const at = Date.parse(entry.at || 0);
          if (!(at >= cut)) continue;
          const s = Array.isArray(entry.values) ? entry.values.join(" ") : String(entry.message || entry);
          const sk = c + "|" + entry.at + "|" + s;
          if (seen[sk]) continue;
          seen[sk] = 1;
          if (interesting.test(s)) console.log("  LOG %s | %s", c, s.slice(0, 220));
          if (/You can't chat|chat this fast/i.test(s)) {
            result.restock.chatThrottle++;
            result.restock.notes.push(phase + " " + c + ": " + s.slice(0, 100));
          }
          if (c === "Zarook" && /LIVE_SSH_GIVE_OK/.test(s)) result.shield.give = true;
          if (c === "Puppygirl" && /LIVE_SSH_UP_OK|LIVE_SSH_UP_SKIP/.test(s)) result.shield.up = true;
          if (c === "Puppygirl" && /LIVE_SSH_SEND_OK/.test(s)) result.shield.send = true;
          if (c === "Jazwyn" && /LIVE_SSH_EQUIP_OK/.test(s)) {
            result.shield.equip = true;
            const m = s.match(/\+(\d+)/);
            if (m) result.shield.level = Number(m[1]);
          }
          if (/LIVE_HUNT_ARMADILLO|!hunt armadillo/i.test(s)) result.hunt.dispatched = true;
          if (/LIVE_WORLD_CMD|World US\/II|go_s:US\/II/.test(s)) {
            result.world.dispatched = true;
            if (/go_s:US\/II|World US\/II/.test(s)) result.world.switched = true;
          }
          if (/dlv:done id=.* ok=1|LIVE_DLV_OK|dlv:got id=.* ok=1|dlv:send /.test(s)) {
            if (phase === "world") result.world.dlvOk++;
            else result.restock.dlvOk++;
          }
        }
      }
    }

    function nearArmadillo(pos) {
      return pos && pos.map === "main" && Math.abs((pos.x || 0) - 526) < 450 && Math.abs((pos.y || 0) - 1846) < 450;
    }

    console.log("=== PHASE1 shield (%sm) ===", Math.round(phase1Ms / 60000));
    const p1end = Date.now() + phase1Ms;
    while (Date.now() < p1end) {
      await pollLogs("shield");
      const jaz = await tool("mainframe_get_character", { character: "Jazwyn" });
      const oh = slotsOf(jaz).offhand;
      if (oh && oh.name === "sshield") {
        result.shield.equip = true;
        result.shield.level = oh.level || 0;
        console.log("EQUIP OK sshield+" + result.shield.level);
        break;
      }
      const pup = await tool("mainframe_get_character", { character: "Puppygirl" });
      const zar = await tool("mainframe_get_character", { character: "Zarook" });
      console.log(
        "ssh zar=%s pup=%s jaz=%s",
        findItem(invOf(zar), "sshield") ? "bag" : "-",
        findItem(invOf(pup), "sshield") ? "bag+" + ((findItem(invOf(pup), "sshield").level) || 0) : "-",
        oh ? oh.name + "+" + (oh.level || 0) : "-"
      );
      await sleep(12000);
    }
    if (!result.shield.equip) throw new Error("FAIL: Jazwyn never equipped sshield");

    console.log("=== PHASE2 armadillo farm (%sm) ===", Math.round(farmMs / 60000));
    const farmEnd = Date.now() + farmMs;
    while (Date.now() < farmEnd) {
      await pollLogs("farm");
      let hunting = 0;
      const bits = [];
      for (const c of ALL) {
        const ch = await tool("mainframe_get_character", { character: c });
        const pos = posOf(ch);
        const msg = String((ch.runtime && (ch.runtime.message || ch.runtime.status_message)) || "");
        const pots = potCounts(invOf(ch));
        const key = [pos.map, Math.round(pos.x || 0), Math.round(pos.y || 0)].join(",");
        stuck[c] = lastPos[c] === key ? (stuck[c] || 0) + 1 : 0;
        lastPos[c] = key;
        if (c === "Puppygirl" && stuck[c] >= 8) {
          result.restock.pupStuckHits++;
          result.restock.notes.push("pupStuck " + key + " msg=" + msg.slice(0, 40));
        }
        if (c !== "Puppygirl" && (/Hunt armadillo|Off to armadillo/i.test(msg) || nearArmadillo(pos))) hunting++;
        bits.push(c.slice(0, 3) + ":" + (msg.slice(0, 18) || pos.map) + " p=" + pots.hp + "/" + pots.mp + " st=" + (stuck[c] || 0));
      }
      if (hunting >= 3) result.hunt.allHunting = true;
      console.log("farm hunt=%s dlv=%s spam=%s pupStuck=%s | %s", hunting, result.restock.dlvOk, result.restock.chatThrottle, result.restock.pupStuckHits, bits.join(" "));
      await sleep(20000);
    }

    console.log("=== PHASE3 world observe (%sm) ===", Math.round(worldMs / 60000));
    const worldEnd = Date.now() + worldMs;
    while (Date.now() < worldEnd) {
      await pollLogs("world");
      let onII = 0,
        hunting = 0;
      const bits = [];
      for (const c of ALL) {
        const ch = await tool("mainframe_get_character", { character: c });
        const pos = posOf(ch);
        const msg = String((ch.runtime && (ch.runtime.message || ch.runtime.status_message)) || "");
        const srv = String(pos.server || "") + " " + String(pos.ident || "");
        if (/II/.test(srv) || /US II/i.test(String(pos.server || ""))) onII++;
        if (c !== "Puppygirl" && (/Hunt armadillo|Off to armadillo/i.test(msg) || nearArmadillo(pos))) hunting++;
        bits.push(c.slice(0, 3) + "@" + (pos.server || pos.ident || "?") + " " + msg.slice(0, 16));
      }
      if (onII >= 3) result.world.switched = true;
      if (hunting >= 2 && result.world.switched) result.world.huntingAfter = true;
      console.log("world onII~%s hunt=%s dlv=%s | %s", onII, hunting, result.world.dlvOk, bits.join(" | "));
      await sleep(20000);
    }

    result.finished = new Date().toISOString();
    result.ok =
      result.shield.equip &&
      result.hunt.allHunting &&
      result.world.switched &&
      result.world.huntingAfter &&
      result.restock.chatThrottle < 20;

    fs.writeFileSync(path.join(ROOT, "_live_party_verify.json"), JSON.stringify(result, null, 2));
    console.log("RESULT", JSON.stringify(result, null, 2));
    if (!result.ok) {
      if (!result.hunt.allHunting) result.errs.push("fighters not all on armadillo");
      if (!result.world.switched) result.errs.push("world switch not observed");
      if (!result.world.huntingAfter) result.errs.push("no armadillo hunt after world");
      throw new Error("FAIL verify: " + (result.errs.join("; ") || "ok criteria"));
    }
    console.log("SUCCESS party verify");
  } finally {
    applyInjects(false);
    console.log("Restored scripts; redeploy clean...");
    try {
      deploy();
    } catch (e) {
      console.error("cleanup deploy failed", e.message || e);
    }
  }
}

main().catch((e) => {
  try {
    applyInjects(false);
  } catch (e2) {}
  console.error(e.message || e);
  process.exit(1);
});
