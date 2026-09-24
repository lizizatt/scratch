#!/usr/bin/env node
/**
 * Live restock verify: force dlv_pots, yank fighter mid-approach (distance race),
 * require dlv:done + pot recovery; fail on empty_send storm without success.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const token = (process.env.AL_MCP_TOKEN || fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8")).trim();
let headers = {
  Authorization: "Bearer " + token,
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};
let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER = process.env.AL_SERVER || "US III";
const ALL = ["Zarook", "Puppygirl", "Sarene", "Jazwyn"];
const TARGET = process.env.AL_RESTOCK_WHO || "Zarook";
const MINUTES = Number(process.env.OBSERVE_MIN != null && process.env.OBSERVE_MIN !== "" ? process.env.OBSERVE_MIN : 12);
const ARM = { map: "main", x: 526, y: 1846 };

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

function potCounts(inv) {
  let hp = 0,
    mp = 0;
  for (const it of inv || []) {
    if (!it || !it.name) continue;
    if (it.name.indexOf("hpot") === 0) hp += it.q || 1;
    if (it.name.indexOf("mpot") === 0) mp += it.q || 1;
  }
  return { hp, mp };
}

function dist(a, b) {
  if (!a || !b || a.map !== b.map) return 1e9;
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

async function resolveSlots() {
  const listed = await tool("list_codes", {});
  const byName = {};
  for (const c of listed.codes || []) byName[(c.name || "").toLowerCase()] = String(c.slot);
  const need = {};
  for (const n of ALL) {
    need[n] = byName[n.toLowerCase()];
    if (!need[n]) throw new Error("missing CODE slot for " + n);
  }
  return need;
}

async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    const rt = ch.runtime || {};
    if (rt.game_connected) {
      console.log("[%s] CONNECTED", name);
      return true;
    }
    console.log("[%s] waiting %s", name, rt.phase || "?");
    await sleep(5000);
  }
  return false;
}

function logText(row) {
  return (row.values || []).join(" ");
}

async function main() {
  if (process.argv.includes("--publish")) {
    console.log("Publish...");
    const pub = spawnSync("node", [path.join(ROOT, "publish.js"), "--upload"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    process.stdout.write(pub.stdout || "");
    process.stderr.write(pub.stderr || "");
    if (pub.status) throw new Error("publish failed");
  }

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-restock-live", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const dash = await tool("mainframe_get_dashboard", {});
  const freeH = dash.free_time && dash.free_time.remaining_hours;
  console.log("dash shells=%s free_h=%s", dash.shells, freeH);
  if ((dash.shells || 0) <= 0 && !(freeH > 0)) throw new Error("no shells/free time");

  const SLOTS = await resolveSlots();
  console.log("Disconnect all...");
  for (const c of ALL) {
    try {
      await tool("mainframe_disconnect_character", { character: c });
    } catch (e) {}
  }
  console.log("Wait 55s auth release...");
  await sleep(55000);

  for (const c of ALL) {
    console.log("Link %s → %s", c, SERVER);
    await tool("mainframe_link_character", {
      character: c,
      request_id: "restock_" + c + "_" + Date.now(),
      code_slot: SLOTS[c],
      server: SERVER,
    });
    await sleep(2500);
  }
  for (const c of ALL) {
    if (!(await waitConnected(c, 180000))) throw new Error(c + " connect fail");
  }

  // Nudge farm if idle
  await tool("mainframe_code_eval", {
    character: "Puppygirl",
    code: `try{if(typeof hunt==="function")hunt("armadillo");game_log("LIVE_RS_HUNT");}catch(e){game_log("LIVE_RS_HUNT_FAIL "+e)}`,
  });

  const tBoot = Date.now();
  let settled = false;
  while (Date.now() - tBoot < 180000) {
    const ch = await tool("mainframe_get_character", { character: TARGET });
    const obs = (ch.runtime && ch.runtime.observation) || ch.profile || {};
    const d = dist(obs, ARM);
    console.log("[%s] settle map=%s xy=%s,%s dArm=%s", TARGET, obs.map, Math.round(obs.x || 0), Math.round(obs.y || 0), Math.round(d));
    if (obs.map === "main" && d < 900) {
      settled = true;
      break;
    }
    await sleep(10000);
  }
  if (!settled) console.log("WARN: not near pack — forcing dlv anyway");

  const beforeCh = await tool("mainframe_get_character", { character: TARGET });
  const beforeObs = (beforeCh.runtime && beforeCh.runtime.observation) || beforeCh.profile || {};
  const potsBefore = potCounts(beforeObs.items || beforeObs.inventory);
  console.log("pots before", potsBefore);

  const forceId = "live_rs_" + Date.now();
  const cutIso = new Date(Date.now() - 2000).toISOString();
  console.log("Force dlv_pots id=%s on %s", forceId, TARGET);
  await tool("mainframe_code_eval", {
    character: TARGET,
    code: `(async function(){
  try{
    var id=${JSON.stringify(forceId)};
    game_log("LIVE_RS_FORCE id="+id);
    var r=await send_cm("Puppygirl",{
      v:1,job:"dlv_pots",id:id,who:character.name,
      items:[{name:"hpot1",q:80},{name:"mpot1",q:80}],
      farm:"armadillo",
      map:character.map,x:character.real_x,y:character.real_y
    });
    game_log("LIVE_RS_CM receivers="+((r&&r.receivers&&r.receivers.length)||0));
  }catch(e){game_log("LIVE_RS_FORCE_FAIL "+(e&&e.message||e));}
})();`,
  });

  const seen = new Set();
  const events = [];
  let yanked = false;
  let dlvDone = false;
  let emptySend = 0;
  let sendFail = 0;
  let approach = 0;
  let sendOk = 0;
  let buy = 0;
  const samples = [];
  const t0 = Date.now();

  console.log("Observe %sm...", MINUTES);
  while (Date.now() - t0 < MINUTES * 60000) {
    const snap = { t: Date.now(), chars: {} };
    for (const name of ALL) {
      const ch = await tool("mainframe_get_character", { character: name });
      const rt = ch.runtime || {};
      const obs = rt.observation || ch.profile || {};
      snap.chars[name] = {
        map: obs.map,
        x: obs.x,
        y: obs.y,
        msg: rt.message || rt.status_message || "",
        pots: potCounts(obs.items || obs.inventory),
        stand: !!(obs.shop && obs.shop.open),
      };
    }
    samples.push(snap);

    for (const name of ["Puppygirl", TARGET]) {
      try {
        const logs = await tool("mainframe_get_logs", { character: name, limit: 80 });
        for (const row of logs.logs || []) {
          const at = row.at ? Date.parse(row.at) : 0;
          if (at && at < Date.parse(cutIso) - 1000) continue;
          const line = logText(row);
          const key = name + "|" + (row.at || "") + "|" + line;
          if (seen.has(key)) continue;
          seen.add(key);
          const interesting =
            /dlv:|LIVE_RS|send_fail|empty_send|approach|stand_open|gold_topup/i.test(line);
          if (!interesting) continue;
          events.push({ name, at: row.at, line: line.slice(0, 220) });
          console.log("[%s] %s", name, line.slice(0, 180));
          if (/dlv:buy /i.test(line)) buy++;
          if (/dlv:approach /i.test(line) || /dlv:approach_fail/i.test(line)) approach++;
          if (/dlv:send /i.test(line) && !/send_fail|send_gear/i.test(line)) sendOk++;
          if (/dlv:send_fail/i.test(line)) sendFail++;
          if (/dlv:empty_send/i.test(line)) emptySend++;
          if (new RegExp("dlv:done id=" + forceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(line) || /dlv:done id=live_rs_/i.test(line))
            dlvDone = true;
        }
      } catch (e) {}
    }

    // Adversary: after buy, yank fighter ~500 south so merchant arrives out of SEND_RANGE.
    if (!yanked && buy > 0) {
      yanked = true;
      console.log("YANK %s south (distance race)...", TARGET);
      await tool("mainframe_code_eval", {
        character: TARGET,
        code: `(async function(){
  try{
    var x=character.real_x||character.x,y=(character.real_y||character.y)+500;
    game_log("LIVE_RS_YANK_START "+Math.round(x)+","+Math.round(y));
    try{await smart_move({map:character.map,x:x,y:y});}catch(e){game_log("LIVE_RS_YANK_FAIL "+(e&&e.reason||e));}
    game_log("LIVE_RS_YANK_DONE "+Math.round(character.real_x)+","+Math.round(character.real_y));
  }catch(e){game_log("LIVE_RS_YANK_ERR "+e)}
})();`,
      });
    }

    const t = snap.chars[TARGET];
    const p = snap.chars.Puppygirl;
    console.log(
      "[+%ss] %s pots=%s/%s Pup=%s/%s,%s stand=%s buy=%s appr=%s send=%s fail=%s empty=%s done=%s",
      Math.round((Date.now() - t0) / 1000),
      TARGET,
      t && t.pots.hp,
      t && t.pots.mp,
      p && p.map,
      p && Math.round(p.x || 0),
      p && Math.round(p.y || 0),
      p && p.stand ? 1 : 0,
      buy,
      approach,
      sendOk,
      sendFail,
      emptySend,
      dlvDone ? 1 : 0
    );

    if (dlvDone && sendOk > 0) break;
    await sleep(12000);
  }

  const afterCh = await tool("mainframe_get_character", { character: TARGET });
  const afterObs = (afterCh.runtime && afterCh.runtime.observation) || afterCh.profile || {};
  const potsAfter = potCounts(afterObs.items || afterObs.inventory);
  const potGain = potsAfter.hp + potsAfter.mp - (potsBefore.hp + potsBefore.mp);

  const out = {
    at: new Date().toISOString(),
    target: TARGET,
    forceId,
    yanked,
    potsBefore,
    potsAfter,
    potGain,
    buy,
    approach,
    sendOk,
    sendFail,
    emptySend,
    dlvDone,
    events: events.slice(-80),
    samples: samples.length,
    pass: {
      dlv_done: dlvDone,
      sent: sendOk > 0,
      pot_gain: potGain >= 40,
      no_empty_storm: emptySend === 0 || (dlvDone && sendOk > 0),
      approach_or_clean_send: approach > 0 || (sendOk > 0 && sendFail === 0),
    },
  };
  out.ok = out.pass.dlv_done && out.pass.sent && out.pass.pot_gain && out.pass.no_empty_storm;

  const dest = path.join(ROOT, "_live_restock_verify.json");
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ok: out.ok, pass: out.pass, potGain, buy, approach, sendOk, sendFail, emptySend }, null, 2));
  console.log("wrote", dest);
  if (!out.ok) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
