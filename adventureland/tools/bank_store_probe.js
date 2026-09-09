#!/usr/bin/env node
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

const PROBE = [
  "game_log('PROBE:start');",
  "(async function(){",
  "  try{",
  "    if(character.stand){ try{ close_stand(); }catch(e0){} }",
  "    if(character.map!=='bank' || !character.bank){",
  "      game_log('PROBE:move_bank map='+character.map+' bank='+(character.bank?'y':'n'));",
  "      try{ await smart_move({map:'bank',x:0,y:-37}); }catch(e1){",
  "        try{ await smart_move({to:'bank'}); }catch(e2){ game_log('PROBE:path_fail'); }",
  "      }",
  "    }",
  "    await new Promise(function(r){ setTimeout(r,800); });",
  "    var items=[],i,it;",
  "    for(i=0;i<(character.items||[]).length;i++){",
  "      it=character.items[i];",
  "      if(it) items.push(it.name+'@'+(it.level||0)+':'+i);",
  "    }",
  "    var bank=character.bank, packInfo='';",
  "    if(bank){",
  "      for(var p in bank){",
  "        if(p==='gold'||!Array.isArray(bank[p])) continue;",
  "        var e=0,f=0,j;",
  "        for(j=0;j<bank[p].length;j++){ if(bank[p][j]) f++; else e++; }",
  "        packInfo += p+':f'+f+'/e'+e+' ';",
  "      }",
  "    }",
  "    var bp='';",
  "    try{",
  "      if(typeof bank_packs!=='undefined'){",
  "        for(var k in bank_packs) bp += k+'='+JSON.stringify(bank_packs[k])+' ';",
  "      } else bp='undef';",
  "    }catch(e3){ bp='err'; }",
  "    game_log('PROBE map='+character.map+' esize='+character.esize+' bank='+(bank?'y':'n')+' goldB='+(bank&&bank.gold)+' items='+items.join(',')+' packs='+packInfo);",
  "    game_log('PROBE bank_packs '+bp);",
  "    if(!items.length){ game_log('PROBE empty_bag'); return; }",
  "    if(!bank){ game_log('PROBE not_in_bank'); return; }",
  "    var si=parseInt(items[0].split(':').pop(),10);",
  "    try{",
  "      var r=await bank_store(si);",
  "      game_log('PROBE store_ok r='+JSON.stringify(r)+' left='+(character.items[si]?1:0));",
  "    }catch(err){",
  "      game_log('PROBE store_fail '+(err&&err.reason||err&&err.message||err));",
  "      try{",
  "        var r2=await bank_store(si,'items0',-1);",
  "        game_log('PROBE store_items0 r='+JSON.stringify(r2)+' left='+(character.items[si]?1:0));",
  "      }catch(err2){",
  "        game_log('PROBE store_items0_fail '+(err2&&err2.reason||err2));",
  "        try{",
  "          var r3=await bank_store(si,'items1',-1);",
  "          game_log('PROBE store_items1 r='+JSON.stringify(r3)+' left='+(character.items[si]?1:0));",
  "        }catch(err3){ game_log('PROBE store_items1_fail '+(err3&&err3.reason||err3)); }",
  "      }",
  "    }",
  "  }catch(e){ game_log('PROBE err '+(e&&e.message||e)); }",
  "})();",
].join("\n");

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-bank-probe2", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const listed = await tool("list_codes", {});
  let slot = null;
  for (const c of listed.codes || []) if (/puppygirl/i.test(c.name || "")) slot = String(c.slot);
  console.log("Puppygirl slot", slot);

  const ch0 = await tool("mainframe_get_character", { character: "Puppygirl" });
  console.log("before", {
    connected: !!(ch0.runtime && ch0.runtime.game_connected),
    phase: ch0.runtime && ch0.runtime.phase,
  });

  // Ensure CODE runner is alive by reloading merchant slot, then eval probe
  if (slot) {
    try {
      await tool("mainframe_code_eval", {
        character: "Puppygirl",
        code: "game_log('PROBE:ping');",
      });
    } catch (e) {
      console.log("ping failed, disconnect/relink...", e.message || e);
      try {
        await tool("mainframe_disconnect_character", { character: "Puppygirl" });
      } catch (e2) {}
      await sleep(55000);
      await tool("mainframe_link_character", {
        character: "Puppygirl",
        request_id: "probe_" + Date.now(),
        code_slot: slot,
        server: process.env.AL_SERVER || "US III",
      });
      for (let i = 0; i < 36; i++) {
        const ch = await tool("mainframe_get_character", { character: "Puppygirl" });
        if (ch.runtime && ch.runtime.game_connected) break;
        await sleep(5000);
      }
    }
  }

  const cut = new Date().toISOString();
  console.log("eval probe at", cut);
  const ev = await tool("mainframe_code_eval", { character: "Puppygirl", code: PROBE });
  console.log("eval result", JSON.stringify(ev).slice(0, 500));

  await sleep(8000);
  const logs = await tool("mainframe_get_logs", { character: "Puppygirl", limit: 50 });
  for (const L of logs.logs || []) {
    const line = (L.values || []).join(" ");
    if (/PROBE/.test(line)) console.log(L.at, line);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
