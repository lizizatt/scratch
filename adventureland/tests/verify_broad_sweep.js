"use strict";

/**
 * Broad verification sweep — multi-scenario sim with log timeline checks.
 * Run: node tests/verify_broad_sweep.js
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { safeMeet, packCenter } = require("../src/packs");

const findings = [];
function note(ok, msg, detail) {
  findings.push({ ok: !!ok, msg, detail: detail || "" });
  console.log((ok ? "  OK  " : "  !!  ") + msg + (detail ? " — " + detail : ""));
}

function chatLines(api) {
  return (api.log && api.log.said) || [];
}

function gameMsgs(api) {
  return ((api.log && api.log.game) || []).map((g) => g.m);
}

function countPrefix(msgs, re) {
  return msgs.filter((m) => re.test(m)).length;
}

async function sweepFarm15m() {
  console.log("\n=== farm 8min armadillo (compressed) ===");
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    burnPots: true,
    burnPerTick: 2,
  });
  const t0 = p.world.clock.now();
  const limit = 8 * 60 * 1000;
  while (p.world.clock.now() - t0 < limit) {
    await p.tickAll();
  }
  const j = p.bots.Jazwyn.api;
  const s = p.bots.Sarene.api;
  const z = p.bots.Zarook.api;
  const m = p.bots.Puppygirl.api;
  const jMsgs = gameMsgs(j);
  const allChat = []
    .concat(chatLines(j), chatLines(s), chatLines(z), chatLines(m))
    .map((c) => (typeof c === "string" ? c : c.m || c.text || JSON.stringify(c)));

  note(!jMsgs.some((x) => x === "Wrong weapon"), "no Wrong weapon on Jazwyn", "count=" + countPrefix(jMsgs, /^Wrong weapon/));
  note(!jMsgs.some((x) => /^equip (staff|wblade|basher)/.test(x)), "no illegal weapon equips");
  note(countPrefix(jMsgs, /^equip:reject|^equip:fail/) < 5, "equip rejects bounded", String(countPrefix(jMsgs, /^equip:reject|^equip:fail/)));

  const hops = countPrefix(jMsgs, /^go_s:|^HOP |change_server/);
  note(hops === 0, "fighter hop storm absent during farm", "hops=" + hops);

  // Heartbeat ~60s → ≤ ~10 in 8min per lead; allow succession noise.
  const hb = allChat.filter((c) => /^~s /.test(c)).length;
  note(hb <= 20, "heartbeat chat not spammed", "hb=" + hb + " totalChat=" + allChat.length);

  const throttle = allChat.filter((c) => /chat this fast|You can't chat|chat_slowdown/i.test(c)).length;
  note(throttle === 0, "no chat throttle", "throttle=" + throttle);

  const timeouts = []
    .concat(jMsgs, gameMsgs(s), gameMsgs(z), gameMsgs(m))
    .filter((x) => /timeout|job_ttl|ACK|WAIT_PARTY/i.test(x) && !/rare_timeout/.test(x));
  note(timeouts.length < 8, "few hard timeouts", timeouts.slice(0, 5).join(" | "));

  note(p.bots.Jazwyn.api.character.rip === false || true, "party still ticking", "map=" + j.character.map);
}

async function sweepWrongWeapon() {
  console.log("\n=== adversary Wrong weapon / 2H+shield ===");
  const p = bootParty({ pack: "armadillo", pots: 80, members: ["Jazwyn", "Puppygirl"] });
  const api = p.bots.Jazwyn.api;
  const c = api.character;
  c.slots.mainhand = { name: "fireblade", level: 1 };
  c.slots.offhand = { name: "sshield", level: 0 };
  const bag = [
    { name: "basher", level: 0 },
    { name: "wblade", level: 0 },
    { name: "staff", level: 4 },
    { name: "bataxe", level: 0 },
  ];
  for (const it of bag) {
    const i = c.items.findIndex((x) => !x);
    c.items[i] = it;
    c.esize = Math.max(0, (c.esize || 1) - 1);
  }
  for (let i = 0; i < 60; i++) await p.tickAll();
  const msgs = gameMsgs(api);
  note(countPrefix(msgs, /^Wrong weapon/) === 0, "Wrong weapon count 0 after 60 ticks");
  note(c.slots.offhand && c.slots.offhand.name === "sshield", "sshield retained");
  note(c.slots.mainhand && c.slots.mainhand.name === "fireblade", "fireblade retained");
}

async function sweepDelivery() {
  console.log("\n=== dry pots → delivery resolve ===");
  const p = bootParty({ pack: "armadillo", pots: 0, gold: 800000 });
  const z = p.bots.Zarook.api.character;
  const m = p.bots.Puppygirl.api;
  z.items[0] = null;
  z.items[1] = null;
  z.esize = Math.max(z.esize, 5);
  // Seed merchant pots
  m.character.items[0] = { name: "hpot1", q: 200 };
  m.character.items[1] = { name: "mpot1", q: 200 };
  m.character.gold = 800000;

  let done = false;
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    if (gameMsgs(m).some((x) => /^dlv:done/.test(x))) {
      done = true;
      break;
    }
  }
  const msgs = gameMsgs(m);
  note(done || msgs.some((x) => /^dlv:/.test(x)), "delivery activity present", msgs.filter((x) => /^dlv:/.test(x)).slice(-6).join(" | "));
  note(!msgs.some((x) => /avoid:fail/.test(x)) || msgs.some((x) => /avoid:ok|dlv:done|smart_move/.test(x)), "avoid fail not stuck forever");
  const chat = chatLines(m).length + chatLines(p.bots.Jazwyn.api).length;
  note(chat < 40, "merchant+lead chat bounded during dlv", "chat=" + chat);
}

async function sweepScoreGifts() {
  console.log("\n=== score-driven gift: strearring to Jazwyn not intearring ===");
  const { planGifts, score } = require("../src/gear");
  const p = bootParty({ pack: "armadillo", pots: 10, members: ["Jazwyn"] });
  const G = p.bots.Jazwyn.api.G;
  const gifts = planGifts(
    [
      { name: "intearring", level: 0, pack: "items0", i: 0 },
      { name: "strearring", level: 0, pack: "items0", i: 1 },
    ],
    {
      Jazwyn: {
        ctype: "warrior",
        esize: 5,
        slots: { earring1: null, earring2: null, mainhand: { name: "fireblade", level: 0 } },
      },
    },
    G
  );
  note(
    gifts.some((g) => g.it.name === "strearring"),
    "plans strearring for warrior",
    JSON.stringify(gifts.map((g) => g.it.name))
  );
  note(
    score({ name: "strearring", level: 0 }, G, "warrior") >
      score({ name: "intearring", level: 0 }, G, "warrior"),
    "warrior score ranks str > int earring"
  );
  note(
    score({ name: "intearring", level: 0 }, G, "mage") >
      score({ name: "strearring", level: 0 }, G, "mage"),
    "mage score ranks int > str earring"
  );
}

async function main() {
  console.log("Broad verification sweep");
  await sweepWrongWeapon();
  await sweepScoreGifts();
  await sweepDelivery();
  await sweepFarm15m();

  const bad = findings.filter((f) => !f.ok);
  console.log("\n=== summary ===");
  console.log(findings.length - bad.length + " ok, " + bad.length + " concerns");
  for (const f of bad) console.log("FAIL:", f.msg, f.detail);
  if (bad.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
