#!/usr/bin/env node
/** Upload already done — disconnect/relink all four on US III and hunt armadillo. */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

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

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-redeploy-boot", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const listed = await tool("list_codes", {});
  const by = {};
  for (const c of listed.codes || []) by[(c.name || "").toLowerCase()] = String(c.slot);
  for (const n of ALL) if (!by[n.toLowerCase()]) throw new Error("missing CODE slot for " + n);

  console.log("Disconnect all...");
  for (const c of ALL) {
    try {
      await tool("mainframe_disconnect_character", { character: c });
    } catch (e) {}
  }
  console.log("Wait 70s auth release...");
  await sleep(70000);
  // Second disconnect pass — live sometimes returns character_in_game on first link.
  for (const c of ALL) {
    try {
      await tool("mainframe_disconnect_character", { character: c });
    } catch (e) {}
  }
  await sleep(15000);

  for (const c of ALL) {
    console.log("Link %s → %s slot=%s", c, SERVER, by[c.toLowerCase()]);
    let linked = false;
    for (let attempt = 0; attempt < 4 && !linked; attempt++) {
      try {
        await tool("mainframe_link_character", {
          character: c,
          request_id: "deploy_" + c + "_" + Date.now(),
          code_slot: by[c.toLowerCase()],
          server: SERVER,
        });
        linked = true;
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        console.log("Link %s attempt %s fail: %s", c, attempt + 1, msg.slice(0, 120));
        if (/character_in_game/i.test(msg)) {
          try {
            await tool("mainframe_disconnect_character", { character: c });
          } catch (e2) {}
          await sleep(20000);
          continue;
        }
        throw e;
      }
    }
    if (!linked) throw new Error(c + " link fail");
    await sleep(2500);
  }

  for (const c of ALL) {
    let ok = false;
    for (let i = 0; i < 36; i++) {
      const ch = await tool("mainframe_get_character", { character: c });
      if (ch.runtime && ch.runtime.game_connected) {
        console.log("%s CONNECTED", c);
        ok = true;
        break;
      }
      console.log("%s waiting %s", c, (ch.runtime && ch.runtime.phase) || "?");
      await sleep(5000);
    }
    if (!ok) throw new Error(c + " connect fail");
  }

  await tool("mainframe_code_eval", {
    character: "Puppygirl",
    code: 'try{if(typeof hunt==="function")hunt("armadillo");game_log("DEPLOY_HUNT")}catch(e){game_log("DEPLOY_HUNT_FAIL "+e)}',
  });
  console.log("Deploy boot OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
