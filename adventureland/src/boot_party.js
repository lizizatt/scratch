"use strict";

const { createWorld } = require("../sim");
const { attachTrace } = require("../sim/trace");
const { bootFighter } = require("./fighter");
const { bootMerchant } = require("./merchant");
const {
  FIGHTERS,
  FARM,
  FORM_MAGE,
  FORM_PRIEST,
  PACK_COUNT,
  MELEE_RANGE,
  MAGE_RANGE,
  PRIEST_RANGE,
} = require("./constants");
const { packCenter } = require("../sim/world");
const { combatTank, combatAssist } = require("./combat");

/**
 * Spawn the party in sim and return controllers + world.
 * On change_server reconnect: heap handlers wipe, controllers reboot from storage,
 * and fighters on the same server are re-invited into a party.
 *
 * Pass opts.trace = { id, name, tags, sampleMs } to record a scrubbable timeline.
 */
function bootParty(opts) {
  opts = opts || {};
  const w = createWorld();
  const region = (opts.server && opts.server[0]) || FARM[0];
  const ident = (opts.server && opts.server[1]) || FARM[1];
  const pack = opts.pack || "armadillo";
  const pc = packCenter(pack);
  const want = opts.members
    ? new Set(opts.members)
    : new Set(FIGHTERS.concat(["Puppygirl"]));

  const bots = {};
  const tickMs = opts.tickMs || 250;
  const trace = opts.trace ? attachTrace(w, opts.trace) : null;
  const combatOn = opts.combat !== false;

  function seedPots(n) {
    const items = new Array(42).fill(null);
    items[0] = { name: "hpot1", q: n };
    items[1] = { name: "mpot1", q: n };
    return items;
  }

  function reInviteIfNeeded(name) {
    const here = w.where(name);
    if (!here) return;
    const members = FIGHTERS.filter((n) => {
      const wh = w.where(n);
      const api = w.get(n);
      return bots[n] && wh && wh.key === here.key && api && api.character.connected;
    });
    if (members.length) w.inviteAll(here.key, members);
  }

  function fighterOpts(name, api) {
    const o = {
      now: () => w.clock.now(),
      burnPots: !!opts.burnPots,
      farm: pack,
    };
    if (!combatOn) return o;
    if (name === "Jazwyn") {
      o.combat = (mtype) => combatTank(api, mtype, { leadName: "Jazwyn", isLead: true });
    } else if (name === "Sarene") {
      o.form = FORM_MAGE;
      o.combat = (mtype) => combatAssist(api, mtype, { leadName: "Jazwyn", isLead: false });
    } else if (name === "Zarook") {
      o.form = FORM_PRIEST;
      o.combat = (mtype) => combatAssist(api, mtype, { leadName: "Jazwyn", isLead: false });
    }
    return o;
  }

  function wireReload(name, bootFn) {
    w.setOnReload(name, (api) => {
      const ctrl = bootFn(api, name === "Puppygirl" ? { now: () => w.clock.now() } : fighterOpts(name, api));
      bots[name].ctrl = ctrl;
      bots[name].api = api;
      reInviteIfNeeded(name);
    });
  }

  function mkFighter(name, ctype, xy, range, atk) {
    if (!want.has(name)) return null;
    const api = w.spawn(
      {
        name,
        ctype,
        level: opts.level || 40,
        map: pc.map,
        real_x: xy.x,
        real_y: xy.y,
        x: xy.x,
        y: xy.y,
        range: range,
        attack: atk,
        gold: opts.gold != null ? opts.gold : 50000,
        esize: opts.esize != null ? opts.esize : 20,
        items: opts.items || seedPots(opts.pots != null ? opts.pots : 200),
      },
      region,
      ident
    );
    const ctrl = bootFighter(api, fighterOpts(name, api));
    bots[name] = { api, ctrl };
    wireReload(name, bootFighter);
    return bots[name];
  }

  // Tank starts just outside melee so viz shows closing in
  mkFighter("Jazwyn", "warrior", { x: pc.x - 70, y: pc.y }, MELEE_RANGE, 95);
  mkFighter("Sarene", "mage", { x: pc.x - 40, y: pc.y + 55 }, MAGE_RANGE, 110);
  mkFighter("Zarook", "priest", { x: pc.x + 40, y: pc.y + 55 }, PRIEST_RANGE, 70);

  if (want.has("Puppygirl")) {
    const mApi = w.spawn(
      {
        name: "Puppygirl",
        ctype: "merchant",
        level: 40,
        map: "main",
        real_x: 56,
        real_y: -122,
        gold: 2000000,
        esize: 30,
        items: new Array(42).fill(null),
      },
      region,
      ident
    );
    bots.Puppygirl = { api: mApi, ctrl: bootMerchant(mApi, { now: () => w.clock.now() }) };
    wireReload("Puppygirl", bootMerchant);
  }

  const partyMembers = FIGHTERS.filter((n) => bots[n]);
  if (partyMembers.length) w.formParty(region + "/" + ident, partyMembers);
  const nPack = opts.packCount != null ? opts.packCount : PACK_COUNT;
  if (typeof w.spawnPack === "function") w.spawnPack(region + "/" + ident, pc.map, pack, pc, nPack);
  else w.spawnMonster(region + "/" + ident, pc.map, pack, pc);

  async function tickAll() {
    const keys = new Set();
    for (const n of Object.keys(bots)) {
      const wh = w.where(n);
      if (wh) keys.add(wh.key);
    }
    for (const key of keys) w.refreshPartyCoords(key);

    for (const n of FIGHTERS) {
      if (bots[n]) await bots[n].ctrl.tick();
    }
    if (bots.Puppygirl) await bots.Puppygirl.ctrl.tick();
    w.drainOwedTime();
    w.advance(tickMs);
    if (trace) trace.sample();
  }

  async function runFor(ms) {
    const end = w.clock.now() + ms;
    while (w.clock.now() < end) await tickAll();
  }

  return { world: w, bots, tickAll, runFor, pack, reInviteIfNeeded, trace };
}

module.exports = { bootParty };
