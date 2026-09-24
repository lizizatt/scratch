#!/usr/bin/env node
/** Retrieve pots accidentally banked by probe; confirm pack-aware store works. */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const token = (process.env.AL_MCP_TOKEN || fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8")).trim();
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

const CODE = [
  "(async function(){",
  "  function log(m){ game_log('FIX:'+m); }",
  "  try{",
  "    if(character.map!=='bank'||!character.bank){",
  "      try{ await smart_move({map:'bank',x:0,y:-37}); }catch(e){ await smart_move({to:'bank'}); }",
  "      await new Promise(function(r){setTimeout(r,600);});",
  "    }",
  "    var bank=character.bank, pulled=0;",
  "    if(!bank){ log('no_bank'); return; }",
  "    for(var p in bank){",
  "      if(p==='gold'||!Array.isArray(bank[p])) continue;",
  "      for(var i=0;i<bank[p].length;i++){",
  "        var it=bank[p][i];",
  "        if(!it) continue;",
  "        if(!(it.name.indexOf('hpot')===0 || it.name.indexOf('mpot')===0)) continue;",
  "        if((character.esize||0)<1){ log('bag_full'); return; }",
  "        try{ await bank_retrieve(p,i); pulled++; log('pull '+it.name+' q='+(it.q||1)); await new Promise(function(r){setTimeout(r,200);}); }",
  "        catch(e){ log('pull_fail '+(e&&e.reason||e)); }",
  "      }",
  "    }",
  "    // Park one non-pot with explicit pack to verify fix path",
  "    var si=-1,it;",
  "    for(var j=0;j<character.items.length;j++){",
  "      it=character.items[j];",
  "      if(it && it.name!=='stand0' && it.name.indexOf('hpot')&&it.name.indexOf('mpot')&&it.name.indexOf('scroll')&&!it.l){",
  "        if(it.name==='wshoes'||it.name==='ringsj'||it.name==='hpbelt'){ si=j; break; }",
  "      }",
  "    }",
  "    if(si>=0){",
  "      try{",
  "        await bank_store(si,'items0',-1);",
  "        log('store_ok '+(character.items[si]?'left':'gone'));",
  "      }catch(e){ log('store_fail '+(e&&e.reason||e)); }",
  "    } else log('no_parkable');",
  "    log('done pulled='+pulled);",
  "  }catch(e){ log('err '+(e&&e.message||e)); }",
  "})();",
].join("\n");

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-bank-fix", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});
  console.log("eval retrieve/store...");
  await tool("mainframe_code_eval", { character: "Puppygirl", code: CODE });
  await sleep(10000);
  const logs = await tool("mainframe_get_logs", { character: "Puppygirl", limit: 40 });
  for (const L of logs.logs || []) {
    const line = (L.values || []).join(" ");
    if (/FIX:|PROBE/.test(line)) console.log(L.at, line);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
