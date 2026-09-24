#!/usr/bin/env node
/**
 * Dump account bank (get_bank) + character bags, derive sell/combine/buy lists.
 * If bank is mounted/stale, disconnects Puppygirl briefly for a fresh snapshot.
 * Does not overwrite permanent CODE slots. Does not auto-relink unless --relink.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { deriveBankLists } = require("./src/derive_bank_lists");

const ROOT = __dirname;
const TOKEN_FILE = path.join(ROOT, ".al_mcp_token");
const OUT_BANK = path.join(ROOT, "_bank_live.json");
const OUT_BAGS = path.join(ROOT, "_char_bags_live.json");
const OUT_DEFS = path.join(ROOT, "_bank_item_defs.json");
const OUT_LISTS = path.join(ROOT, "_bank_lists.json");

const token = (() => {
  if (process.env.AL_MCP_TOKEN && process.env.AL_MCP_TOKEN.trim()) return process.env.AL_MCP_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  return null;
})();
if (!token) {
  console.error("Need .al_mcp_token or AL_MCP_TOKEN");
  process.exit(1);
}

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

function itemRecord(raw) {
  if (!raw || typeof raw !== "object") return {};
  if (raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) return raw.data;
  if (raw.item && typeof raw.item === "object") return raw.item;
  return raw;
}

async function fetchDefs(names) {
  const out = {};
  for (const n of names) {
    try {
      const d = await tool("get_game_data", { section: "items", name: n });
      const it = itemRecord(d);
      out[n] = {
        type: it.type,
        compound: !!it.compound,
        upgrade: !!it.upgrade,
        sell: !!it.sell,
        g: it.g,
        grades: it.grades,
        wtype: it.wtype,
        e: it.e,
      };
    } catch (e) {
      out[n] = { error: String(e.message || e) };
    }
  }
  return out;
}

async function dumpBags() {
  const chars = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];
  const bags = {};
  for (const name of chars) {
    const ch = await tool("mainframe_get_character", { character: name });
    const rt = ch.runtime || {};
    const obs = rt.observation || ch.profile || {};
    bags[name] = {
      connected: !!rt.game_connected,
      map: obs.map,
      x: obs.x,
      y: obs.y,
      gold: obs.gold,
      esize: obs.esize,
      items: (obs.items || obs.inventory || [])
        .filter(Boolean)
        .map((it) => ({ name: it.name, level: it.level || 0, q: it.q, p: it.p, l: it.l })),
    };
  }
  return bags;
}

async function main() {
  const relink = process.argv.includes("--relink");
  const fromFiles = process.argv.includes("--from-files");

  let bank;
  let bags;

  if (fromFiles) {
    bank = JSON.parse(fs.readFileSync(OUT_BANK, "utf8"));
    bags = JSON.parse(fs.readFileSync(OUT_BAGS, "utf8"));
  } else {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "al-bank-dump", version: "1.0" },
    });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

    bank = await tool("get_bank", {});
    if (bank.stale || bank.mounted_character_id) {
      console.log("bank stale/mounted=%s — disconnect Puppygirl for fresh snap", bank.mounted_character_id);
      try {
        await tool("mainframe_disconnect_character", { character: "Puppygirl" });
      } catch (e) {}
      await sleep(20000);
      bank = await tool("get_bank", {});
    }
    fs.writeFileSync(OUT_BANK, JSON.stringify(bank, null, 2));
    bags = await dumpBags();
    fs.writeFileSync(OUT_BAGS, JSON.stringify(bags, null, 2));
  }

  const names = new Set();
  for (const pack of Object.values(bank.packs || {})) {
    for (const it of pack || []) if (it && it.name) names.add(it.name);
  }
  for (const snap of Object.values(bags || {})) {
    for (const it of snap.items || []) if (it && it.name) names.add(it.name);
  }

  let defs;
  if (fromFiles && fs.existsSync(OUT_DEFS)) {
    defs = JSON.parse(fs.readFileSync(OUT_DEFS, "utf8"));
    for (const n of names) if (!defs[n]) {
      // fall through to live fetch for missing
      defs = null;
      break;
    }
  }
  if (!defs) {
    if (fromFiles && !headers["mcp-session-id"]) {
      await rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "al-bank-dump", version: "1.0" },
      });
      await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});
    }
    defs = await fetchDefs([...names].sort());
    fs.writeFileSync(OUT_DEFS, JSON.stringify(defs, null, 2));
  }

  const derived = deriveBankLists({ packs: bank.packs, gold: bank.gold, defs, bags });
  const out = {
    at: new Date().toISOString(),
    bank: { gold: bank.gold, stale: bank.stale, source: bank.source },
    derived,
  };
  fs.writeFileSync(OUT_LISTS, JSON.stringify(out, null, 2));

  console.log("Wrote", OUT_LISTS);
  console.log("inventory rows=%s", derived.inventory.length);
  console.log("SELL_WHITELIST=", JSON.stringify(derived.proposed.SELL_WHITELIST));
  console.log("combine=", JSON.stringify(derived.combine));
  console.log("buy=", JSON.stringify(derived.buy));
  console.log("sell rows:");
  for (const s of derived.sell) console.log(" ", s.name + "@" + s.level, "x" + s.copies, s.reason);

  if (relink) {
    const listed = await tool("list_codes", {});
    let slot = null;
    for (const c of listed.codes || []) if (/puppygirl/i.test(c.name || "")) slot = String(c.slot);
    if (!slot) throw new Error("Puppygirl slot missing");
    const server = process.env.AL_SERVER || "US III";
    console.log("Relink Puppygirl slot=%s %s", slot, server);
    await tool("mainframe_link_character", {
      character: "Puppygirl",
      request_id: "dump_relink_" + Date.now(),
      code_slot: slot,
      server,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
