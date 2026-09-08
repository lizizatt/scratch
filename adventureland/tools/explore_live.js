"use strict";

/**
 * Live explorers on Mainframe (V2_PLAN §12.3).
 *
 *   node tools/explore_live.js vision [--relink]
 *   node tools/explore_live.js path [--relink]
 *   node tools/explore_live.js reconnect [--relink]
 *   node tools/explore_live.js all [--relink]
 *
 * Uses mainframe_code_eval + game_log markers; results → data/*.live.json
 * Auth: .al_mcp_token / AL_MCP_TOKEN
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const TOKEN_FILE = path.join(ROOT, ".al_mcp_token");
const SERVER = process.env.AL_SERVER || "US III";
const HOME = process.env.AL_HOME || "US II";

function readToken() {
  if (process.env.AL_MCP_TOKEN && process.env.AL_MCP_TOKEN.trim()) return process.env.AL_MCP_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(token) {
  let headers = {
    Authorization: "Bearer " + token,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  let id = 1;

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
            try {
              resolve(b ? JSON.parse(b.replace(/^\uFEFF/, "")) : {});
            } catch (e) {
              resolve({ raw: b.slice(0, 2000) });
            }
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

  async function init() {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "al-explore-live", version: "2.0" },
    });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});
  }

  return { rpc, tool, init };
}

function flattenLogs(raw) {
  const out = [];
  const logs = (raw && raw.logs) || (Array.isArray(raw) ? raw : []);
  for (const L of logs) {
    if (typeof L === "string") out.push(L);
    else if (L && Array.isArray(L.values)) out.push(L.values.map(String).join(" "));
    else if (L && L.message) out.push(String(L.message));
    else if (L && L.text) out.push(String(L.text));
    else if (L && L.line) out.push(String(L.line));
    else if (L && typeof L === "object") out.push(JSON.stringify(L));
  }
  return out;
}

const IDLE_CODE =
  'game_log("EXPLORE_IDLE_BOOT");setInterval(function(){set_message("explore")},15000);\n';

async function installIdleCode(tool, slots, names) {
  for (const n of names) {
    console.log("Idle CODE →", n, slots[n]);
    await tool("save_code", {
      slot: String(slots[n]),
      name: n,
      code: IDLE_CODE,
    });
  }
}

async function restoreV2(tool) {
  const { spawnSync } = require("child_process");
  console.log("Restoring V2 CODE via deploy_mcp.js...");
  const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], {
    encoding: "utf8",
    cwd: ROOT,
  });
  process.stdout.write(dep.stdout || "");
  process.stderr.write(dep.stderr || "");
  if (dep.status) throw new Error("V2 restore deploy failed");
}

async function resolveSlots(tool) {
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

async function waitConnected(tool, name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    const rt = ch.runtime || {};
    if (rt.game_connected) return true;
    process.stdout.write(".");
    await sleep(5000);
  }
  return false;
}

async function relink(tool, names, slots, server) {
  console.log("Disconnect", names.join(", "));
  for (const n of names) {
    try {
      await tool("mainframe_disconnect_character", { character: n });
    } catch (e) {
      console.log("  disconnect", n, e.message || e);
    }
  }
  console.log("Wait 55s for bank/auth release...");
  await sleep(55000);
  for (const n of names) {
    console.log("Link", n, "→", server, "slot", slots[n]);
    await tool("mainframe_link_character", {
      character: n,
      request_id: "explore-" + n + "-" + Date.now(),
      code_slot: String(slots[n]),
      server,
    });
  }
  for (const n of names) {
    process.stdout.write("Wait " + n + " ");
    const ok = await waitConnected(tool, n, 180000);
    console.log(ok ? " CONNECTED" : " TIMEOUT");
    if (!ok) throw new Error(n + " did not connect");
  }
}

async function evalCode(tool, character, code) {
  return tool("mainframe_code_eval", { character, code });
}

async function recentLogEntries(tool, character, limit) {
  const raw = await tool("mainframe_get_logs", { character, limit: limit || 100 });
  const ch = await tool("mainframe_get_character", { character });
  const rt = ch.runtime || {};
  const entries = [];
  for (const L of raw.logs || []) {
    const text = Array.isArray(L.values)
      ? L.values.map(String).join(" ")
      : L.message || L.text || "";
    entries.push({ at: L.at, text: String(text), assignment_id: L.assignment_id });
  }
  for (const L of rt.logs || []) {
    const text = Array.isArray(L.values)
      ? L.values.map(String).join(" ")
      : L.message || L.text || "";
    entries.push({ at: L.at, text: String(text) });
  }
  return entries;
}

async function waitForLog(tool, character, re, msMax, sinceIso) {
  const t0 = Date.now();
  const sinceMs = sinceIso ? Date.parse(sinceIso) : t0 - 5000;
  const accumulated = [];
  const seenText = new Set();
  while (Date.now() - t0 < msMax) {
    const entries = await recentLogEntries(tool, character, 250);
    for (const e of entries) {
      if (e.at && Date.parse(e.at) < sinceMs) continue;
      if (seenText.has(e.at + "|" + e.text)) continue;
      seenText.add(e.at + "|" + e.text);
      accumulated.push(e);
    }
    for (const e of accumulated) {
      if (re.test(e.text)) return { line: e.text, entries: accumulated };
    }
    await sleep(4000);
  }
  return { line: null, entries: accumulated };
}

async function holdParty(tool, names) {
  for (const n of names) {
    await evalCode(
      tool,
      n,
      `try{if(typeof hold==="function")hold();else if(typeof set_hold==="function")set_hold(1,false);game_log("EXPLORE_HOLD");}catch(e){game_log("EXPLORE_HOLD_FAIL "+e)}`
    );
  }
  await sleep(2000);
}

async function runVision(tool) {
  console.log("\n=== VISION explorer (Sarene walks away from Jazwyn) ===");
  await holdParty(tool, ["Jazwyn", "Sarene"]);

  // Anchor Jazwyn near plaza; Sarene measures get_player("Jazwyn")
  await evalCode(
    tool,
    "Jazwyn",
    `(async function(){try{if(smart.moving)return;await smart_move({map:"main",x:0,y:0});game_log("EXPLORE_VISION_ANCHOR");}catch(e){game_log("EXPLORE_VISION_ANCHOR_FAIL "+((e&&e.reason)||e))}})();`
  );
  await sleep(25000);

  const sinceIso = new Date().toISOString();
  // Sarene: same plaza, then walk +x with move() (not smart_move)
  await evalCode(
    tool,
    "Sarene",
    `(async function(){
  try{
    game_log("EXPLORE_VISION_START");
    try{await smart_move({map:"main",x:20,y:0})}catch(eJ){game_log("EXPLORE_VISION_JOIN_FAIL "+((eJ&&eJ.reason)||eJ))}
    await sleep(2500);
    if(character.map!=="main"){game_log("EXPLORE_VISION_BADMAP "+character.map);game_log("EXPLORE_VISION_DONE lostAt=never lastSeen=0");return}
    var step=50, lostAt=null, lastSeenD=0;
    for(var n=0; n<20; n++){
      var x=(character.real_x||character.x)+step;
      var y=character.real_y||character.y;
      move(x,y);
      await sleep(2500);
      if(character.map!=="main"){game_log("EXPLORE_VISION_LEFTMAP "+character.map);break}
      var jp=get_player("Jazwyn");
      var seen=!!jp;
      var dist=seen
        ? Math.hypot((jp.real_x||jp.x)-(character.real_x||character.x),(jp.real_y||jp.y)-(character.real_y||character.y))
        : lastSeenD+step;
      game_log("EXPLORE_VISION d="+Math.round(dist)+" seen="+(seen?1:0));
      if(seen) lastSeenD=Math.round(dist);
      if(!seen && lostAt==null) lostAt=Math.round(dist);
      if(!seen && n>=2) break;
    }
    game_log("EXPLORE_VISION_DONE lostAt="+(lostAt==null?"never":lostAt)+" lastSeen="+lastSeenD);
  }catch(e){game_log("EXPLORE_VISION_ERR "+((e&&e.message)||e))}
})();`
  );

  const done = await waitForLog(tool, "Sarene", /EXPLORE_VISION_DONE/, 8 * 60 * 1000, sinceIso);
  const entries = done
    ? done.entries
    : (await recentLogEntries(tool, "Sarene", 150)).filter(
        (e) => !e.at || Date.parse(e.at) >= Date.parse(sinceIso)
      );
  const lines = entries.map((e) => e.text);
  const samples = [];
  let lostAt = null;
  let lastSeen = null;
  for (const line of lines) {
    const m = /EXPLORE_VISION d=(\d+) seen=(\d)/.exec(line);
    if (m) samples.push({ dist: +m[1], seen: m[2] === "1", line });
    const d = /EXPLORE_VISION_DONE lostAt=(\d+|never)(?: lastSeen=(\d+))?/.exec(line);
    if (d) {
      if (d[1] !== "never") lostAt = +d[1];
      if (d[2]) lastSeen = +d[2];
    }
  }
  const lastSeenSample = samples.filter((s) => s.seen).pop();
  const firstLost = samples.find((s) => !s.seen);
  if (lastSeen == null && lastSeenSample) lastSeen = lastSeenSample.dist;
  if (lostAt == null && firstLost) lostAt = firstLost.dist;
  let measured = null;
  if (lastSeen != null && lostAt != null && lostAt < 5000) measured = Math.round((lastSeen + lostAt) / 2);
  else if (lastSeen != null) measured = lastSeen + 25;
  else if (lostAt != null && lostAt < 5000) measured = lostAt;

  const out = {
    generatedAt: new Date().toISOString(),
    source: "live",
    status: measured != null ? "measured" : "incomplete",
    measuredVisionPx: measured,
    assumedVisionPx: 600,
    lastSeenDist: lastSeen,
    firstLostDist: lostAt,
    samples,
    note: "get_player null while walking +x from colocated start on main; midpoint lastSeen/firstLost",
  };
  const file = path.join(ROOT, "data", "vision.live.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("Wrote", file, "measuredVisionPx=", measured);
  return out;
}

async function runPath(tool) {
  console.log("\n=== PATH explorer (Puppygirl timed smart_move) ===");
  await holdParty(tool, ["Puppygirl"]);

  const simFile = path.join(ROOT, "data", "path_bands.sim.json");
  const sim = fs.existsSync(simFile) ? JSON.parse(fs.readFileSync(simFile, "utf8")) : { bands: {} };

  const sinceIso = new Date().toISOString();
  await evalCode(
    tool,
    "Puppygirl",
    `(async function(){
  try{
    game_log("EXPLORE_PATH_START");
    var routes=[
      {id:"town_to_potions", to:{map:"main",x:56,y:-122}},
      {id:"potions_to_goo", to:{map:"main",x:0,y:180}},
      {id:"potions_to_bee", to:{map:"main",x:546,y:1059}},
      {id:"potions_to_bank", to:{map:"bank",x:0,y:-50}},
      {id:"phoenix_by_type_fail", to:{to:"phoenix"}, expectFail:1}
    ];
    try{await smart_move({map:"main",x:56,y:-122})}catch(eR){}
    for(var i=0;i<routes.length;i++){
      var r=routes[i];
      if(r.id!=="town_to_potions" && r.id!=="phoenix_by_type_fail"){
        try{await smart_move({map:"main",x:56,y:-122})}catch(e0){}
      }
      if(r.id==="town_to_potions"){
        try{await smart_move({map:"main",x:0,y:0})}catch(eT){}
      }
      var t0=Date.now(), res=null, fail=0, reason="-";
      try{
        res=await smart_move(r.to);
        if(res&&res.failed){fail=1;reason=res.reason||"failed"}
      }catch(e){fail=1;reason=(e&&e.reason)||e;res={failed:1}}
      var ms=Date.now()-t0;
      var ok=r.expectFail?fail: !fail;
      game_log("EXPLORE_PATH id="+r.id+" ms="+ms+" fail="+fail+" ok="+(ok?1:0)+" reason="+reason);
    }
    game_log("EXPLORE_PATH_DONE");
  }catch(e){game_log("EXPLORE_PATH_ERR "+((e&&e.message)||e))}
})();`
  );

  const done = await waitForLog(tool, "Puppygirl", /EXPLORE_PATH_DONE/, 20 * 60 * 1000, sinceIso);
  const entries = done
    ? done.entries
    : (await recentLogEntries(tool, "Puppygirl", 200)).filter(
        (e) => !e.at || Date.parse(e.at) >= Date.parse(sinceIso)
      );
  const lines = entries.map((e) => e.text);
  const routes = [];
  for (const line of lines) {
    const m = /EXPLORE_PATH id=(\S+) ms=(\d+) fail=(\d) ok=(\d) reason=(.*)/.exec(line);
    if (m) {
      routes.push({
        id: m[1],
        liveMs: +m[2],
        failRate: +m[3],
        ok: m[4] === "1",
        reason: m[5],
        samples: 1,
        simBand: sim.bands && sim.bands[m[1]],
      });
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "live",
    status: routes.length ? "measured" : "incomplete",
    simBands: sim.bands,
    routes,
    note: "Single-sample timings; widen with more runs before trusting fail bands",
  };
  const file = path.join(ROOT, "data", "path_bands.live.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("Wrote", file, "(" + routes.length + " routes)");
  for (const r of routes) console.log(" ", r.ok ? "ok" : "BAD", r.id, "ms=" + r.liveMs, r.failRate ? "fail" : "");
  return out;
}

async function runReconnect(tool) {
  console.log("\n=== RECONNECT explorer (Puppygirl hop " + SERVER + " → " + HOME + ") ===");
  await holdParty(tool, ["Puppygirl"]);

  await evalCode(
    tool,
    "Puppygirl",
    `(async function(){
  try{
    game_log("EXPLORE_RECONNECT_START t="+Date.now()+" region="+(parent.server_region||"?")+" id="+(parent.server_identifier||"?"));
    var t0=Date.now();
    change_server("US","II");
    game_log("EXPLORE_RECONNECT_HOP_ISSUED t0="+t0);
  }catch(e){game_log("EXPLORE_RECONNECT_ERR "+((e&&e.message)||e))}
})();`
  );

  const tIssue = Date.now();
  let connectedAt = null;
  let regionReadyAt = null;
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    const ch = await tool("mainframe_get_character", { character: "Puppygirl" });
    const rt = ch.runtime || {};
    const obs = rt.observation || {};
    if (rt.game_connected && /US\s*II$/i.test(String(rt.server || "").trim()) && !connectedAt) {
      connectedAt = Date.now();
      console.log("  game_connected on HOME at +" + (connectedAt - tIssue) + "ms");
    }
    // region readiness: ask CODE once connected
    if (connectedAt && !regionReadyAt) {
      await evalCode(
        tool,
        "Puppygirl",
        `game_log("EXPLORE_RECONNECT_PROBE region="+(parent.server_region||"")+" id="+(parent.server_identifier||"")+" t="+Date.now())`
      );
      await sleep(3000);
      const entries = await recentLogEntries(tool, "Puppygirl", 40);
      for (const e of entries) {
        const m = /EXPLORE_RECONNECT_PROBE region=(\S*) id=(\S*) t=(\d+)/.exec(e.text);
        if (m && m[1] && m[1] !== "?" && m[1].length) {
          regionReadyAt = Date.now();
          console.log("  server_region ready region=" + m[1] + " id=" + m[2] + " at +" + (regionReadyAt - tIssue) + "ms");
          break;
        }
      }
    }
    if (connectedAt && regionReadyAt) break;
    await sleep(4000);
  }

  // Hop back to farm for other explorers / party
  try {
    await evalCode(tool, "Puppygirl", `try{change_server("US","III");game_log("EXPLORE_RECONNECT_BACK")}catch(e){}`);
  } catch (e) {}

  const reconnectMs = connectedAt ? connectedAt - tIssue : null;
  const regionDelayMs = connectedAt && regionReadyAt ? regionReadyAt - connectedAt : null;
  const out = {
    generatedAt: new Date().toISOString(),
    source: "live",
    status: reconnectMs != null ? "measured" : "incomplete",
    reconnectMs,
    serverRegionDelayMs: regionDelayMs,
    assumedReconnectMs: 55000,
    assumedServerRegionDelayMs: 3000,
    from: SERVER,
    to: HOME,
    note: "Wall-clock from hop issue via MCP poll; region delay is after game_connected",
  };
  const file = path.join(ROOT, "data", "reconnect.live.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("Wrote", file, "reconnectMs=", reconnectMs, "regionDelayMs=", regionDelayMs);
  return out;
}

function usage() {
  console.log(`Usage:
  node tools/explore_live.js vision|path|reconnect|all
Flags:
  --no-idle      do not replace CODE with idle explorer stub
  --no-relink    skip disconnect/55s/relink (only if already on idle CODE)
  --keep-idle    do not restore V2 CODE in finally
  --relink       force relink (default when idle CODE is installed)
`);
}

async function main() {
  const cmd = process.argv[2];
  const doRelink = process.argv.includes("--relink");
  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    return;
  }
  const token = readToken();
  if (!token) {
    console.error("No MCP token");
    process.exit(2);
  }

  const { tool, init } = makeClient(token);
  await init();
  const dash = await tool("mainframe_get_dashboard", {});
  console.log(
    "dash online=%s shells=%s free_h=%s",
    dash.online,
    dash.shells,
    dash.free_time && dash.free_time.remaining_hours
  );

  const slots = await resolveSlots(tool);
  let names =
    cmd === "vision"
      ? ["Jazwyn", "Sarene"]
      : cmd === "path" || cmd === "reconnect"
        ? ["Puppygirl"]
        : ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];

  // Always park idle explorer CODE + relink so farm loops cannot interrupt smart_move/move.
  // --no-idle skips that (debug only).
  const useIdle = !process.argv.includes("--no-idle");
  const skipRelink = process.argv.includes("--no-relink") && !doRelink;

  if (useIdle) {
    await installIdleCode(tool, slots, names);
    // Drop other party members so they cannot formation-interrupt explorers
    const all = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];
    for (const n of all) {
      if (names.indexOf(n) >= 0) continue;
      try {
        await tool("mainframe_disconnect_character", { character: n });
        console.log("Disconnected spare", n);
      } catch (e) {}
    }
    if (!skipRelink) await relink(tool, names, slots, SERVER);
  } else if (doRelink) {
    await relink(tool, names, slots, SERVER);
  }

  // Ensure connected
  for (const n of names) {
    const ch = await tool("mainframe_get_character", { character: n });
    if (!(ch.runtime && ch.runtime.game_connected)) {
      console.log(n, "not connected — linking...");
      await tool("mainframe_link_character", {
        character: n,
        request_id: "explore-link-" + n + "-" + Date.now(),
        code_slot: String(slots[n]),
        server: SERVER,
      });
      if (!(await waitConnected(tool, n, 180000))) throw new Error(n + " connect failed");
    }
  }

  let results = {};
  try {
    if (cmd === "vision" || cmd === "all") results.vision = await runVision(tool);
    if (cmd === "path" || cmd === "all") results.path = await runPath(tool);
    if (cmd === "reconnect" || cmd === "all") results.reconnect = await runReconnect(tool);
    if (!results.vision && !results.path && !results.reconnect) {
      usage();
      process.exit(1);
    }
  } finally {
    if (useIdle && !process.argv.includes("--keep-idle")) {
      try {
        await restoreV2(tool);
      } catch (e) {
        console.error("V2 restore failed:", e.message || e);
      }
    }
  }

  const incomplete = Object.values(results).some((r) => r && r.status !== "measured");
  console.log("\nExplorer summary:", JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.status]))));
  process.exit(incomplete ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
