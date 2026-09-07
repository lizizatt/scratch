"use strict";

/**
 * Shared invariant monitor — grades both sim traces and Mainframe observe dumps.
 * Used by test_sim_parity and live observe scripts.
 */

function emptyCounters() {
  return {
    chat_throttle: 0,
    fighter_hop: 0,
    merchant_hop: 0,
    restock_fail: 0,
    town_fallback: 0,
    dlv_done: 0,
    dlv_fail: 0,
    rare_spot: 0,
    wait_timeout: 0,
    path_storm: 0, // Transfer/Port spam
    samples: 0,
    on_pack: 0,
  };
}

/**
 * Grade a list of game_log / Mainframe log lines (strings).
 * @param {string[]} lines
 * @param {object} [opts]
 */
function gradeLogs(lines, opts) {
  opts = opts || {};
  const fighters = opts.fighters || ["Jazwyn", "Sarene", "Zarook"];
  const c = emptyCounters();
  let transferPhoenix = 0;
  let portTown = 0;

  for (const raw of lines) {
    const line = "" + raw;
    if (/can't chat this fast/i.test(line)) c.chat_throttle++;
    if (/restock fail/i.test(line)) c.restock_fail++;
    if (/town_fallback|buy_pots_here|Dry/i.test(line) && /fallback|town/i.test(line)) c.town_fallback++;
    if (/dlv:done|LIVE_DLV_OK|dlv_done/i.test(line)) c.dlv_done++;
    if (/dlv:.*fail|dlv_fail/i.test(line)) c.dlv_fail++;
    if (/~R |rare_spot|Transfer phoenix/i.test(line) && /phoenix|rare/i.test(line)) c.rare_spot++;
    if (/Transfer phoenix/i.test(line)) transferPhoenix++;
    if (/Port town/i.test(line)) portTown++;
    if (/wait_timeout|go_farm:wait party/i.test(line)) c.wait_timeout++;

    // fighter hop instrumentation: go_s:US/... from a fighter name prefix
    for (const f of fighters) {
      if (line.indexOf(f) >= 0 && /go_s:US\//.test(line)) c.fighter_hop++;
    }
    if (/Puppygirl/.test(line) && /go_s:US\/|change_server|hop/i.test(line)) c.merchant_hop++;
  }

  if (transferPhoenix + portTown >= 10) c.path_storm = transferPhoenix + portTown;

  return c;
}

/**
 * Grade a farm observe JSON shaped like legacy/_live_farm_observe.json
 */
function gradeFarmObserve(result) {
  const c = emptyCounters();
  if (!result) return c;
  c.chat_throttle = result.chatThrottle || (result.chat && result.chat.throttle) || 0;
  c.restock_fail = (result.cohesion && result.cohesion.restockFail) || 0;
  const hops = (result.worlds && result.worlds.hops) || [];
  const fighters = ["Jazwyn", "Sarene", "Zarook"];
  for (const h of hops) {
    if (fighters.indexOf(h.who || h.name) >= 0) c.fighter_hop++;
    else c.merchant_hop++;
  }
  // unnecessary fighter transfers
  const un = (result.worlds && result.worlds.unnecessary) || [];
  c.fighter_hop += un.filter((u) => fighters.indexOf(u.who || u.name) >= 0).length;

  if (result.cohesion) {
    c.samples = (result.cohesion.togetherPolls || 0) + (result.cohesion.splitPolls || 0);
    c.on_pack = result.cohesion.togetherPolls || 0;
  }
  if (result.hunt && result.hunt.onPack) c.on_pack = Math.max(c.on_pack, result.hunt.onPack);
  return c;
}

/**
 * Grade sim character logs after a scenario.
 * @param {object} world createWorld() instance
 * @param {object} opts { fighters, pack, R }
 */
function gradeSim(world, opts) {
  opts = opts || {};
  const fighters = opts.fighters || ["Jazwyn", "Sarene", "Zarook"];
  const lines = [];
  for (const [name, r] of world.roster) {
    for (const g of r.api.log.game) lines.push(name + ":" + g.m);
    for (const s of r.api.log.said) lines.push(name + ":" + s);
    for (const hop of r.api.log.server) {
      lines.push(name + ":go_s:" + hop[0] + "/" + hop[1]);
    }
  }
  for (const t of world.comms.allThrottleLogs()) {
    lines.push(t.name + ":You can't chat this fast.");
  }
  const c = gradeLogs(lines, { fighters });

  // attendance sample
  if (opts.pack) {
    const { packCenter } = require("./world");
    const pc = packCenter(opts.pack);
    const R = opts.R != null ? opts.R : 500;
    if (pc) {
      c.samples++;
      let ok = true;
      let server = null;
      for (const f of fighters) {
        const api = world.get(f);
        if (!api || !api.character.connected) {
          ok = false;
          break;
        }
        const w = world.where(f);
        if (!server) server = w.key;
        if (w.key !== server) ok = false;
        if (api.character.map !== pc.map) ok = false;
        const d = world.dist(api.character, pc);
        if (d > R) ok = false;
      }
      if (ok) c.on_pack++;
    }
  }
  return c;
}

/** MVP pass/fail against §10 thresholds (sim side). */
function mvpPass(counters, opts) {
  opts = opts || {};
  const reasons = [];
  if (counters.chat_throttle > 0) reasons.push("chat_throttle=" + counters.chat_throttle);
  if (counters.fighter_hop > (opts.allowFighterHop || 0)) reasons.push("fighter_hop=" + counters.fighter_hop);
  if (counters.restock_fail > (opts.maxRestockFail || 3)) reasons.push("restock_fail=" + counters.restock_fail);
  if (counters.path_storm >= 10) reasons.push("path_storm=" + counters.path_storm);
  if (opts.requireDlv && counters.dlv_done < 1) reasons.push("no_dlv_done");
  if (opts.minOnPackRatio != null && counters.samples > 0) {
    const r = counters.on_pack / counters.samples;
    if (r < opts.minOnPackRatio) reasons.push("on_pack_ratio=" + r.toFixed(2));
  }
  return { pass: reasons.length === 0, reasons, counters };
}

module.exports = {
  emptyCounters,
  gradeLogs,
  gradeFarmObserve,
  gradeSim,
  mvpPass,
};
