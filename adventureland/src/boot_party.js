"use strict";

const { createWorld } = require("../sim");
const { bootFighter } = require("./fighter");
const { bootMerchant } = require("./merchant");
const { FIGHTERS, FARM } = require("./constants");
const { packCenter } = require("../sim/world");

/**
 * Spawn the party in sim and return controllers + world.
 */
function bootParty(opts) {
  opts = opts || {};
  const w = createWorld();
  const region = (opts.server && opts.server[0]) || FARM[0];
  const ident = (opts.server && opts.server[1]) || FARM[1];
  const pack = opts.pack || "armadillo";
  const pc = packCenter(pack);

  const bots = {};

  function mkFighter(name, ctype, xy) {
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
        gold: opts.gold != null ? opts.gold : 50000,
        esize: 20,
        items: seedPots(opts.pots != null ? opts.pots : 200),
      },
      region,
      ident
    );
    const ctrl = bootFighter(api, {
      now: () => w.clock.now(),
      burnPots: !!opts.burnPots,
    });
    bots[name] = { api, ctrl };
    return bots[name];
  }

  function seedPots(n) {
    const items = new Array(42).fill(null);
    items[0] = { name: "hpot1", q: n };
    items[1] = { name: "mpot1", q: n };
    return items;
  }

  mkFighter("Jazwyn", "warrior", { x: pc.x, y: pc.y });
  mkFighter("Sarene", "mage", { x: pc.x - 40, y: pc.y + 40 });
  mkFighter("Zarook", "priest", { x: pc.x + 40, y: pc.y + 40 });

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

  w.formParty(region + "/" + ident, FIGHTERS);
  w.spawnMonster(region + "/" + ident, pc.map, pack, pc);

  async function tickAll() {
    w.refreshPartyCoords(region + "/" + ident);
    // fighters first, then merchant
    for (const n of FIGHTERS) await bots[n].ctrl.tick();
    await bots.Puppygirl.ctrl.tick();
    w.advance(opts.tickMs || 250);
  }

  async function runFor(ms) {
    const end = w.clock.now() + ms;
    while (w.clock.now() < end) await tickAll();
  }

  return { world: w, bots, tickAll, runFor, pack };
}

module.exports = { bootParty };
