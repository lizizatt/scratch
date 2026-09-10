#!/usr/bin/env node
/**
 * Deploy latest V2, boot party on US III, verify:
 *  1) idle bank clean (compound / park / stall) — overnight stuck bag
 *  2) safe-distance restock (dlv:meet / dlv:done / retreat; no empty storm)
 *
 * Usage: node live_post_overnight_verify.js [--skip-deploy] [--skip-boot]
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
const ALL = ["Zarook", "Puppygirl", "Sarene", "Jazwyn"];
const SERVER = process.env.AL_SERVER || "US III";
const OUT = path.join(ROOT, "_live_post_overnight.json");

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

function logLines(logs) {
  return (logs.logs || []).map((e) => {
    const v = e.values && e.values[0];
    return { at: e.at, m: typeof v === "string" ? v : JSON.stringify(v || e) };
  });
}

async function waitConnected(name, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ch = await tool("mainframe_get_character", { character: name });
    if (ch.runtime && ch.runtime.game_connected) return ch;
    await sleep(3000);
  }
  throw new Error(name + " not connected");
}

async function main() {
  const skipDeploy = process.argv.includes("--skip-deploy");
  const skipBoot = process.argv.includes("--skip-boot");
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-post-overnight", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const report = { t0: new Date().toISOString(), checks: {}, logs: {}, errs: [] };

  if (!skipDeploy) {
    console.log("Deploy publish.js --upload...");
    const r = spawnSync("node", [path.join(ROOT, "publish.js"), "--upload"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "inherit",
    });
    if (r.status) throw new Error("deploy failed status=" + r.status);
    report.deployed = true;
  }

  const listed = await tool("list_codes", {});
  const by = {};
  for (const c of listed.codes || []) by[(c.name || "").toLowerCase()] = String(c.slot);

  if (!skipBoot) {
    console.log("Disconnect all...");
    for (const c of ALL) {
      try {
        await tool("mainframe_disconnect_character", { character: c });
      } catch (e) {}
    }
    console.log("Wait 70s auth release...");
    await sleep(70000);
    console.log("Link all on", SERVER);
    for (const c of ALL) {
      const slot = by[c.toLowerCase()];
      if (!slot) throw new Error("no slot " + c);
      await tool("mainframe_link_character", {
        character: c,
        request_id: "boot_" + c + "_" + Date.now(),
        code_slot: slot,
        server: SERVER,
      });
      await sleep(2000);
    }
    for (const c of ALL) {
      console.log("wait", c);
      await waitConnected(c, 180000);
    }
  }

  // --- Phase 1: idle bank clean ---
  console.log("Phase1: observe idle bank clean (4 min)...");
  const cut1 = new Date().toISOString();
  await sleep(2000);
  let compound = 0,
    store = 0,
    stall = 0,
    prime = 0;
  for (let i = 0; i < 16; i++) {
    await sleep(15000);
    const ch = await tool("mainframe_get_character", { character: "Puppygirl" });
    const obs = (ch.runtime && ch.runtime.observation) || {};
    const logs = logLines(await tool("mainframe_get_logs", { character: "Puppygirl", limit: 100 }));
    const fresh = logs.filter((l) => l.at >= cut1);
    for (const l of fresh) {
      if (/^bank:compound /.test(l.m)) compound++;
      if (/^bank:store /.test(l.m)) store++;
      if (/^stall:open/.test(l.m) || /^stall:pull/.test(l.m)) stall++;
      if (/^bank:prime/.test(l.m)) prime++;
    }
    const invN = (obs.items || ch.profile.inventory || []).filter(Boolean).length;
    console.log(
      "  +" + (i + 1) * 15 + "s map=" + (obs.map || ch.profile.map) +
        " xy=" + Math.round(obs.x || ch.profile.x) + "," + Math.round(obs.y || ch.profile.y) +
        " inv=" + invN + " compound=" + compound + " store=" + store + " stall=" + stall
    );
    if (compound >= 1 || (store >= 3 && stall >= 1)) break;
  }
  report.checks.idleClean = { compound, store, stall, prime, ok: compound >= 1 || store >= 3 || stall >= 1 };

  // --- Phase 2: restock safe approach ---
  console.log("Phase2: force dlv_pots via Zarook CM...");
  const cut2 = new Date().toISOString();
  const forceId = "live_ov_" + Date.now();
  try {
    await tool("mainframe_code_eval", {
      character: "Zarook",
      code: `(async function(){
  try{
    var id=${JSON.stringify(forceId)};
    game_log("LIVE_OV_FORCE id="+id);
    var r=await send_cm("Puppygirl",{
      v:1,job:"dlv_pots",id:id,who:character.name,
      items:[{name:"hpot1",q:80},{name:"mpot1",q:80}],
      farm:"armadillo",
      map:character.map,x:character.real_x,y:character.real_y
    });
    game_log("LIVE_OV_CM receivers="+((r&&r.receivers&&r.receivers.length)||0));
  }catch(e){game_log("LIVE_OV_FORCE_FAIL "+(e&&e.message||e));}
})();`,
    });
  } catch (e) {
    report.errs.push("force eval: " + (e.message || e));
  }

  let dlvMeet = 0,
    dlvDone = 0,
    dlvRetreat = 0,
    emptySend = 0,
    abortEmpty = 0,
    approach = 0;
  for (let i = 0; i < 24; i++) {
    await sleep(15000);
    const logs = logLines(await tool("mainframe_get_logs", { character: "Puppygirl", limit: 100 }));
    const fresh = logs.filter((l) => l.at >= cut2);
    for (const l of fresh) {
      if (/^dlv:meet /.test(l.m)) dlvMeet++;
      if (l.m === "dlv:done id=" + forceId || /^dlv:done id=/.test(l.m)) dlvDone++;
      if (l.m === "dlv:retreat") dlvRetreat++;
      if (l.m === "dlv:empty_send") emptySend++;
      if (/^dlv:abort_empty/.test(l.m)) abortEmpty++;
      if (/^dlv:approach /.test(l.m)) approach++;
    }
    const pup = await tool("mainframe_get_character", { character: "Puppygirl" });
    const obs = (pup.runtime && pup.runtime.observation) || pup.profile || {};
    console.log(
      "  +" +
        (i + 1) * 15 +
        "s meet=" +
        dlvMeet +
        " done=" +
        dlvDone +
        " retreat=" +
        dlvRetreat +
        " empty=" +
        emptySend +
        " approach=" +
        approach +
        " pup=" +
        Math.round(obs.x || 0) +
        "," +
        Math.round(obs.y || 0)
    );
    if (dlvDone >= 1) break;
  }
  report.checks.restock = {
    forceId,
    dlvMeet,
    dlvDone,
    dlvRetreat,
    emptySend,
    abortEmpty,
    approach,
    ok: dlvDone >= 1 && emptySend < 20,
  };

  report.t1 = new Date().toISOString();
  report.pass = !!(report.checks.idleClean.ok && report.checks.restock.ok);
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(report.pass ? "PASS" : "FAIL", "→", OUT);
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
