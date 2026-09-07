#!/usr/bin/env node
"use strict";
/**
 * Boot party, force Sarene+Zarook broke/dry (dump pots), verify Puppygirl dlv recovers them.
 * Uses latest CODE; strips DRY_FORCE inject after run.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");
const ROOT = __dirname;
const token = fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8").trim();
let headers = { Authorization: "Bearer " + token, Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function post(body) {
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: "adventure.land", path: "/mcp", method: "POST", headers: Object.assign({}, headers, { "Content-Length": data.length }) }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { if (res.headers["mcp-session-id"]) headers["mcp-session-id"] = res.headers["mcp-session-id"]; resolve(b ? JSON.parse(b.replace(/^\uFEFF/, "")) : {}); });
    });
    req.on("error", reject); req.write(data); req.end();
  });
}
async function rpc(m, p) { const r = await post({ jsonrpc: "2.0", id: id++, method: m, params: p }); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result; }
async function tool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args || {} });
  const text = ((result && result.content) || []).map((c) => c.text || "").join("\n");
  try { return JSON.parse(text); } catch (e) { return { raw: text }; }
}
const SLOTS = {
  Jazwyn: "CH_xOVr1MS2DN8qlv1ntZ0VB1IEy3Sp9",
  Sarene: "CH_0EquGf0dJfIrmvKmlb5pa6KfSITh3",
  Zarook: "CH_d4UbsANUGP3e4HGOB2DrwV3uLyeLz",
  Puppygirl: "CH_q7h90Mhg5era0mD5DBIMAKFcLp9xe",
};
const ALL = ["Puppygirl", "Sarene", "Zarook", "Jazwyn"];
const FORCE = [
  path.join(ROOT, "mage.js"),
  path.join(ROOT, "priest.js"),
];
const INJECT = `
/*DRY_FORCE_START*/
(function () {
  var done = 0;
  setInterval(function () {
    if (done || !character || character.rip) return;
    (async function () {
      var i, it, n = 0, p = get_player("Puppygirl");
      for (i = 0; i < (character.items || []).length; i++) {
        it = character.items[i];
        if (!it || !it.name) continue;
        if (it.name.indexOf("hpot") !== 0 && it.name.indexOf("mpot") !== 0) continue;
        try {
          if (p && parent.distance(character, p) <= 320) await send_item("Puppygirl", i, it.q || 1);
          else await destroy(i);
          n++;
          await sleep(80);
        } catch (e) {}
      }
      if (quantity(pot("hp")) === 0 && quantity(pot("mp")) === 0) {
        done = 1;
        last_req_at = 0;
        game_log("DRY_FORCE ok gold=" + character.gold);
        try { await request_pots(); } catch (e2) {}
      } else if (n) game_log("DRY_FORCE dump n=" + n);
    })();
  }, 2500);
})();
/*DRY_FORCE_END*/
`;

function setForce(on) {
  for (const fp of FORCE) {
    let src = fs.readFileSync(fp, "utf8");
    src = src.replace(/\r?\n\/\*DRY_FORCE_START\*\/[\s\S]*?\/\*DRY_FORCE_END\*\//g, "");
    if (on) {
      if (src.indexOf("boot_fighter") < 0) throw new Error(fp + " missing boot_fighter");
      src = src.replace(/boot_fighter\(/, INJECT + "\nboot_fighter(");
    }
    fs.writeFileSync(fp, src);
  }
}

function obs(ch) { return (ch.runtime && ch.runtime.observation) || {}; }
function potCounts(inv) {
  let hp = 0, mp = 0;
  for (const it of inv || []) {
    if (!it || !it.name) continue;
    if (it.name.indexOf("hpot") === 0) hp += it.q || 1;
    if (it.name.indexOf("mpot") === 0) mp += it.q || 1;
  }
  return { hp, mp };
}
function snap(ch) {
  const o = obs(ch);
  const rt = ch.runtime || {};
  return {
    msg: rt.message || rt.status_message || "",
    map: o.map, xy: [Math.round(o.x || 0), Math.round(o.y || 0)],
    srv: rt.server, gold: o.gold != null ? o.gold : (ch.profile && ch.profile.gold),
    pots: potCounts(o.items || o.inventory),
    esize: o.esize,
  };
}
async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    if (ch.runtime && ch.runtime.game_connected) {
      console.log("[%s] CONNECTED %s", name, JSON.stringify(snap(ch)));
      return true;
    }
    console.log("[%s] waiting %s", name, (ch.runtime && ch.runtime.phase) || "?");
    await sleep(5000);
  }
  return false;
}

async function main() {
  const keepInject = process.argv.includes("--keep-inject");
  setForce(true);
  try {
    const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
    process.stdout.write(dep.stdout || "");
    if (dep.status) throw new Error("deploy failed");

    await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "al-dry", version: "2" } });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});
    const dash = await tool("mainframe_get_dashboard", {});
    console.log("dash free=", dash.free_time && dash.free_time.remaining_hours, "shells=", dash.shells);

    for (const c of ALL) {
      try { await tool("mainframe_disconnect_character", { character: c }); } catch (e) {}
    }
    console.log("wait 55s...");
    await sleep(55000);

    const stamp = Date.now(), cut = Date.now() - 2000;
    for (const c of ALL) {
      const link = await tool("mainframe_link_character", {
        character: c, request_id: "dry-" + c + "-" + stamp,
        code_slot: SLOTS[c], server: "US III",
      });
      console.log("link", c, link.failed ? link.reason : "ok");
      await sleep(1200);
    }
    for (const c of ALL) {
      if (!(await waitConnected(c, 180000))) throw new Error(c + " connect fail");
    }

    const seen = {};
    const deadline = Date.now() + 360000;
    const history = [];
    let sawDry = false;
    let recovered = false;
    while (Date.now() < deadline) {
      const row = { t: new Date().toISOString() };
      for (const c of ALL) {
        const ch = await tool("mainframe_get_character", { character: c });
        row[c] = snap(ch);
        const logs = await tool("mainframe_get_logs", { character: c, limit: 80 });
        for (const e of logs.logs || []) {
          const at = Date.parse(e.at || 0); if (!(at >= cut)) continue;
          const s = Array.isArray(e.values) ? e.values.join(" ") : String(e.message || e);
          const sk = c + "|" + e.at + "|" + s; if (seen[sk]) continue; seen[sk] = 1;
          if (/dlv:|buy_pots|hold:|Dry|Dlv |gear:|DRY_FORCE|no gold|no_space|cm fail|Request|logistics|Gold fail|LIVE_/i.test(s)) {
            console.log("LOG", c, s.slice(0, 240));
          }
        }
      }
      history.push(row);
      const s = row.Sarene, z = row.Zarook, p = row.Puppygirl;
      console.log("SNAP", JSON.stringify({
        Sarene: s && { msg: s.msg, pots: s.pots, gold: s.gold, map: s.map, srv: s.srv },
        Zarook: z && { msg: z.msg, pots: z.pots, gold: z.gold, map: z.map, srv: z.srv },
        Puppygirl: p && { msg: p.msg, gold: p.gold, map: p.map, srv: p.srv },
        Jazwyn: row.Jazwyn && { msg: row.Jazwyn.msg, pots: row.Jazwyn.pots, map: row.Jazwyn.map },
      }));
      const sDry = s && s.pots.hp < 5 && s.pots.mp < 5;
      const zDry = z && z.pots.hp < 5 && z.pots.mp < 5;
      if (sDry && zDry) {
        if (!sawDry) console.log("SAW_DRY broke/dry confirmed");
        sawDry = true;
      }
      const sOk = s && s.pots.hp >= 40 && s.pots.mp >= 40;
      const zOk = z && z.pots.hp >= 40 && z.pots.mp >= 40;
      if (sawDry && sOk && zOk) {
        recovered = true;
        console.log("RECOVERED pots after dry");
        break;
      }
      await sleep(12000);
    }
    fs.writeFileSync(path.join(ROOT, "_live_dry_debug.json"), JSON.stringify({ history, sawDry, recovered, at: new Date().toISOString() }, null, 2));
    if (!sawDry) {
      console.log("FAIL never reached dry");
      process.exitCode = 1;
    } else if (!recovered) {
      console.log("STILL_DRY after timeout", JSON.stringify(history[history.length - 1]));
      process.exitCode = 1;
    } else {
      console.log("SUCCESS");
    }
  } finally {
    if (!keepInject) {
      setForce(false);
      const dep2 = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
      process.stdout.write(dep2.stdout || "");
      console.log("cleaned inject; redeployed");
      try {
        for (const c of ALL) {
          try { await tool("mainframe_disconnect_character", { character: c }); } catch (e) {}
        }
        await sleep(55000);
        const stamp2 = Date.now();
        for (const c of ALL) {
          await tool("mainframe_link_character", {
            character: c, request_id: "dry-clean-" + c + "-" + stamp2,
            code_slot: SLOTS[c], server: "US III",
          });
          await sleep(1000);
        }
        console.log("relinked clean CODE");
      } catch (eR) {
        console.log("relink clean warn:", eR.message || eR);
      }
    }
  }
}
main().catch((e) => { console.error(e.message || e); try { setForce(false); } catch (e2) {} process.exit(1); });
