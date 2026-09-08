#!/usr/bin/env node
"use strict";
/**
 * V2 Mainframe observe gate (~30m): 0 chat throttle, farming cohesion, dlv if low pots.
 * Boots Zarook → Puppygirl → Sarene → Jazwyn (plan §10 boot-any-order).
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

const ALL = ["Zarook", "Puppygirl", "Sarene", "Jazwyn"];
const WATCH = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];
const SERVER = process.env.AL_SERVER || "US III";
const ARM = { map: "main", x: 526, y: 1846 };

async function resolveSlots() {
  const listed = await tool("list_codes", {});
  const codes = listed.codes || [];
  const byName = {};
  for (const c of codes) byName[(c.name || "").toLowerCase()] = c.slot;
  const need = {
    Jazwyn: byName.jazwyn,
    Sarene: byName.sarene,
    Zarook: byName.zarook,
    Puppygirl: byName.puppygirl,
  };
  for (const k of Object.keys(need)) {
    if (!need[k]) throw new Error("missing CODE slot for " + k + " — run deploy_mcp.js");
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
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

async function main() {
  const minutes = Number(process.env.OBSERVE_MIN || 30);
  const deployFirst = !process.argv.includes("--no-deploy");
  if (deployFirst) {
    console.log("Deploy V2...");
    const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
    process.stdout.write(dep.stdout || "");
    process.stderr.write(dep.stderr || "");
    if (dep.status) throw new Error("deploy failed");
  }

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-observe-v2", version: "2.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const dash = await tool("mainframe_get_dashboard", {});
  console.log("dash shells=%s free_h=%s", dash.shells, dash.free_time && dash.free_time.remaining_hours);

  const SLOTS = await resolveSlots();
  console.log("slots", SLOTS);

  console.log("Disconnect all...");
  for (const c of ALL) {
    try {
      await tool("mainframe_disconnect_character", { character: c });
    } catch (e) {}
  }
  console.log("Wait 55s for auth release...");
  await sleep(55000);

  for (const c of ALL) {
    console.log("Link %s slot=%s server=%s", c, SLOTS[c], SERVER);
    await tool("mainframe_link_character", {
      character: c,
      request_id: "v2_" + c + "_" + Date.now(),
      code_slot: String(SLOTS[c]),
      server: SERVER,
    });
    await sleep(3000);
  }

  for (const c of ALL) {
    const ok = await waitConnected(c, 180000);
    if (!ok) throw new Error(c + " failed to connect");
  }

  const t0 = Date.now();
  const cut = new Date(t0 - 5000).toISOString();
  const samples = [];
  const throttleHits = [];
  let dlvDone = 0;
  const serversSeen = { Jazwyn: new Set(), Sarene: new Set(), Zarook: new Set() };

  console.log("Observe %sm...", minutes);
  while (Date.now() - t0 < minutes * 60000) {
    const snap = { t: Date.now(), chars: {} };
    for (const name of WATCH) {
      const ch = await tool("mainframe_get_character", { character: name });
      const rt = ch.runtime || {};
      const obs = rt.observation || ch.profile || {};
      const pots = potCounts(obs.items || obs.inventory);
      const key = (rt.server_region || obs.server_region || "?") + "/" + (rt.server_identifier || obs.server_identifier || "?");
      if (serversSeen[name]) serversSeen[name].add(rt.server || key);
      snap.chars[name] = {
        map: obs.map,
        x: obs.x,
        y: obs.y,
        msg: rt.message || rt.status_message || "",
        pots,
        server: rt.server || key,
        connected: !!rt.game_connected,
      };
    }
    samples.push(snap);

    for (const name of WATCH) {
      try {
        const logs = await tool("mainframe_get_logs", { character: name, limit: 40 });
        for (const row of logs.logs || []) {
          const line = (row.values || []).join(" ");
          if (/can't chat this fast|chat_slowdown|chat this fast/i.test(line)) {
            throttleHits.push({ name, at: row.at, line: line.slice(0, 160) });
          }
          if (/dlv:done/i.test(line)) dlvDone++;
        }
      } catch (e) {}
    }

    const j = snap.chars.Jazwyn;
    const near =
      j &&
      dist(j, ARM) < 600 &&
      snap.chars.Sarene &&
      dist(snap.chars.Sarene, j) < 500 &&
      snap.chars.Zarook &&
      dist(snap.chars.Zarook, j) < 500;
    console.log(
      "[+%ss] J=%s/%s,%s Snear=%s thr=%s dlv~%s msg=%s",
      Math.round((Date.now() - t0) / 1000),
      j && j.map,
      j && Math.round(j.x),
      j && Math.round(j.y),
      near ? 1 : 0,
      throttleHits.length,
      dlvDone,
      (j && j.msg) || ""
    );
    await sleep(20000);
  }

  let farmOk = 0;
  for (const s of samples) {
    const j = s.chars.Jazwyn;
    if (!j) continue;
    const ok =
      dist(j, ARM) < 700 &&
      dist(s.chars.Sarene, j) < 550 &&
      dist(s.chars.Zarook, j) < 550;
    if (ok) farmOk++;
  }
  const farmPct = samples.length ? (100 * farmOk) / samples.length : 0;

  const fighterHops = {};
  for (const n of ["Jazwyn", "Sarene", "Zarook"]) {
    fighterHops[n] = [...serversSeen[n]];
  }

  const result = {
    minutes,
    samples: samples.length,
    farm_pct: farmPct,
    throttle: throttleHits.length,
    throttle_samples: throttleHits.slice(0, 20),
    dlv_done_log_hits: dlvDone,
    fighter_servers: fighterHops,
    pass: {
      throttle0: throttleHits.length === 0,
      farm90: farmPct >= 90,
      // hops: only one server token expected (US III) unless hold/world issued
      no_extra_fighter_server: ["Jazwyn", "Sarene", "Zarook"].every((n) => fighterHops[n].length <= 1),
    },
  };
  result.ok = result.pass.throttle0 && result.pass.farm90 && result.pass.no_extra_fighter_server;

  const out = path.join(ROOT, "_live_v2_observe.json");
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.pass, null, 2));
  console.log("wrote", out, "ok=" + result.ok);
  if (!result.ok) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
