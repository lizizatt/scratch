#!/usr/bin/env node
/**
 * Upload adventureland/*.js CODE slots to adventure.land.
 *
 * Setup (once):
 *   1. In-game: CONF -> Pro Mode -> Open Game Inspector
 *   2. Application -> Cookies -> adventure.land -> copy the `auth` cookie value
 *   3. Put it in adventureland/.al_auth  (one line, no quotes)
 *      or set env AL_AUTH
 *
 * Run:
 *   node adventureland/deploy.js
 *
 * Then on each character CODE console (or as their only persistent line):
 *   load_code("warrior")   // Jazwyn
 *   load_code("mage")      // Sarene
 *   load_code("priest")    // Zarook
 *   load_code("merchant")  // puppygirl
 *
 * Saving a slot does not restart running CODE — load_code (or Stop/Run) does.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = __dirname;
const AUTH_FILE = path.join(ROOT, ".al_auth");

const SLOTS = [
  { file: "warrior.js", slot: 1, name: "warrior" },
  { file: "mage.js", slot: 2, name: "mage" },
  { file: "priest.js", slot: 3, name: "priest" },
  { file: "merchant.js", slot: 4, name: "merchant" },
];

function readAuth() {
  if (process.env.AL_AUTH && process.env.AL_AUTH.trim()) return process.env.AL_AUTH.trim();
  if (fs.existsSync(AUTH_FILE)) {
    const v = fs.readFileSync(AUTH_FILE, "utf8").split(/\r?\n/)[0].trim();
    if (v) return v;
  }
  return null;
}

function postSave(auth, slot, name, code) {
  const body = JSON.stringify({
    method: "save_code",
    args: { code, slot, name, log: 1 },
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "adventure.land",
        path: "/json_api/save_code",
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          Cookie: "auth=" + auth,
          Origin: "https://adventure.land",
          Referer: "https://adventure.land/",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: data });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const auth = readAuth();
  if (!auth) {
    console.error("Missing auth. Create adventureland/.al_auth with your adventure.land `auth` cookie,");
    console.error("or set AL_AUTH. See header comment in deploy.js.");
    process.exit(1);
  }

  let failed = 0;
  for (const s of SLOTS) {
    const filePath = path.join(ROOT, s.file);
    if (!fs.existsSync(filePath)) {
      console.error("missing", s.file);
      failed++;
      continue;
    }
    const code = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
    const lines = code.replace(/\s+$/, "").split("\n").length;
    process.stdout.write(`Uploading ${s.file} -> slot ${s.slot} (${s.name}), ${lines} lines... `);
    try {
      const r = await postSave(auth, s.slot, s.name, code);
      let msg = r.body;
      try {
        const j = JSON.parse(r.body);
        if (Array.isArray(j)) {
          const m = j.find((e) => e && e.message);
          msg = m ? m.message : JSON.stringify(j).slice(0, 200);
        } else if (j && j.message) msg = j.message;
      } catch (e) {}
      if (r.status >= 200 && r.status < 300) {
        console.log("ok", r.status, msg);
      } else {
        console.log("FAIL", r.status, msg);
        failed++;
      }
    } catch (e) {
      console.log("ERR", e.message || e);
      failed++;
    }
  }

  if (failed) {
    console.error("\n" + failed + " upload(s) failed.");
    process.exit(1);
  }
  console.log("\nDone. On each character, run load_code(\"<name>\") or Stop/Run that slot.");
}

main();
