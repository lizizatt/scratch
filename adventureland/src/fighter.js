"use strict";

const {
  MERCHANT,
  FIGHTERS,
  LEADER_ORDER,
  FARM,
  HOME,
  HEARTBEAT_MS,
  ACK_MS,
  PENDING_MS,
  FALLBACK_SILENCE_MS,
  BEACON_MS,
  GOLD_FLOAT_FIGHTER,
  POTION_TARGET,
  RARE_WHITELIST,
  ASSEMBLE_TIMEOUT_MS,
  RARE_GONE_MS,
} = require("./constants");
const { createChatQueue } = require("./chat_queue");
const { createPartyState, countPots, potBucket } = require("./party_state");
const { createMotion } = require("./motion");

/**
 * Boot a fighter into a sim (or real) API environment.
 * api must provide: character, party_say, send_cm, get_player, get_party,
 * smart_move, sleep, game_log, on, parent, buy, use, send_gold, items helpers.
 */
function bootFighter(api, opts) {
  opts = opts || {};
  const name = api.character.name;
  const state = createPartyState(name);
  const chat = createChatQueue(api);
  api._now = () => (opts.now ? opts.now() : Date.now());

  let lastHb = 0;
  let dlvPending = null;
  let lastBeacon = 0;
  let lastStatusAt = 0;
  let assembleUntil = 0;
  let rareGoneAt = 0;
  let farmWalking = false;

  const motion = createMotion(api, {
    leadName: () => state.S.lead,
    leadMoving: () => state.S.members[state.S.lead] && state.S.members[state.S.lead].task === "moving",
    now: () => api._now(),
  });

  function isLead() {
    const party = Object.keys(api.get_party() || {});
    const present = party.length ? party : [name];
    const lead = state.currentLeader(present);
    state.S.lead = lead;
    return lead === name;
  }

  function refreshPots() {
    const c = countPots(api.character.items);
    const b = potBucket(c.hp, c.mp);
    if (state.S.members[name].pots !== b) {
      state.setSelf({ pots: b });
      const d = state.diffNeeded();
      if (d) chat.enqueue(d, "diff");
    }
    return b;
  }

  async function requestPots() {
    if (dlvPending) {
      const age = api._now() - dlvPending.t0;
      if (age > (dlvPending.acked ? PENDING_MS : ACK_MS)) {
        api.game_log("dlv:timeout");
        dlvPending = null;
      } else return;
    }
    if ((api.character.esize || 0) < 1) {
      api.game_log("dlv:skip no_space");
      return;
    }
    const id = "p" + api._now() + "_" + name.slice(0, 3);
    dlvPending = { id, kind: "pots", t0: api._now(), acked: 0 };
    state.S.dlv = { id, who: name, phase: "req", t: api._now() };
    const items = [
      { name: "hpot1", q: POTION_TARGET },
      { name: "mpot1", q: POTION_TARGET },
    ];
    const farm = state.S.intent.mtype;
    api.game_log("dlv:req id=" + id);
    const r = await api.send_cm(MERCHANT, {
      v: 1,
      job: "dlv_pots",
      id,
      who: name,
      items,
      farm,
      map: api.character.map,
      x: api.character.real_x,
      y: api.character.real_y,
    });
    if (!r.receivers || !r.receivers.length) {
      api.game_log("cm_unreachable");
      // stay pending; fallback timer uses silence
    }
  }

  async function townFallback() {
    api.game_log("town_fallback");
    if (dlvPending) {
      await api.send_cm(MERCHANT, { job: "cancel_all", id: dlvPending.id, who: name });
      dlvPending = null;
    }
    // Ensure gold float
    if (api.character.gold < GOLD_FLOAT_FIGHTER) {
      api.game_log("town_fallback low_gold");
      // still try — may fail; instrumented
    }
    await motion.goTo({ to: "potions" });
    await api.buy("hpot1", POTION_TARGET);
    await api.buy("mpot1", POTION_TARGET);
    refreshPots();
  }

  async function hopPrep(targetServer) {
    // Restock if low before hop (LESSONS #3)
    const b = refreshPots();
    if (b !== "ok") {
      await motion.goTo({ to: "potions" });
      await api.buy("hpot1", POTION_TARGET);
      await api.buy("mpot1", POTION_TARGET);
    }
    await api.send_cm(MERCHANT, { job: "cancel_all", who: name });
    if (isLead()) chat.enqueue("World " + targetServer[0] + "/" + targetServer[1], "echo");
    chat.tick(api._now());
    api.change_server(targetServer[0], targetServer[1]);
  }

  function hearParty(msg) {
    const from = msg.from || msg.owner;
    const parsed = state.parseLine(msg.message);
    if (!parsed) return;
    if (from === name) {
      chat.setLastOk(api._now());
      return;
    }
    if (parsed.type === "hb") state.applyHeartbeat(from, parsed);
    else if (parsed.type === "diff") state.applyDiff(from, parsed);
    else if (parsed.type === "rare") {
      state.applyRare(from, parsed.mtype);
      assembleUntil = api._now() + ASSEMBLE_TIMEOUT_MS;
      rareGoneAt = 0;
    } else if (parsed.type === "cmd") {
      applyCmd(parsed, from === name);
    }
    // leave announces
    const m = ("" + msg.message).toLowerCase();
    if (m.indexOf("port town") >= 0 || m.indexOf("transfer ") === 0 || m.indexOf("world ") === 0) {
      try {
        api.stop("smart");
      } catch (e) {}
    }
  }

  function applyCmd(parsed, mine) {
    const cmd = parsed.cmd;
    if (cmd === "hold") {
      state.setIntent({ hold: 1, kind: "hold" });
      state.S.mode = "hold";
    } else if (cmd === "resume") {
      state.setIntent({ hold: 0, kind: "farm" });
      state.S.mode = "farm";
      state.S.rare = null;
    } else if (cmd === "hunt" && parsed.args[0]) {
      state.setIntent({ kind: "hunt", mtype: parsed.args[0], hold: 0 });
      state.S.mode = "farm";
    } else if (cmd === "grind") {
      state.setIntent({ kind: "farm", hold: 0 });
    } else if (cmd === "world" && parsed.args[0]) {
      const parts = parsed.args[0].split("/");
      // handled async in tick via intent
      state.setIntent({ world: parts });
    }
    if (mine) chat.enqueue("!" + cmd + (parsed.args[0] ? " " + parsed.args[0] : ""), "echo");
  }

  async function hearCm(m) {
    const d = m.message;
    if (!d || typeof d !== "object") return;
    if (d.dlv_ack && dlvPending && d.id === dlvPending.id) {
      dlvPending.acked = d.ok ? 1 : 0;
      lastStatusAt = api._now();
      api.game_log("dlv:ack ok=" + (d.ok ? 1 : 0));
      if (!d.ok) dlvPending = null;
    }
    if (d.status && dlvPending && (!d.id || d.id === dlvPending.id)) {
      lastStatusAt = api._now();
      dlvPending.phase = d.phase;
    }
    if (d.dlv_done && dlvPending && d.id === dlvPending.id) {
      api.game_log("dlv:done");
      dlvPending = null;
      refreshPots();
    }
    if (d.job === "meet_home" || d.hold === 1) {
      state.setIntent({ hold: 1, kind: "hold" });
    }
  }

  async function tickRare(now) {
    if (state.S.mode !== "rare" || !state.S.rare) {
      const seen = motion.spotRare();
      if (seen) {
        chat.enqueue("~R " + seen.mtype, "rare");
        state.applyRare(name, seen.mtype);
        assembleUntil = now + ASSEMBLE_TIMEOUT_MS;
        api.game_log("rare_spot " + seen.mtype);
      }
      return false;
    }
    // Assemble to spotter via party-list coords
    const by = state.S.rare.by;
    const p = (api.get_party() || {})[by] || api.get_player(by);
    if (p) {
      const m = motion.spotRare();
      if (m) {
        rareGoneAt = 0;
        // kill: walk to entity coords
        if (!api.is_in_range(m)) await motion.goTo({ map: m.map || api.character.map, x: m.real_x, y: m.real_y });
        // sim: mark dead when leader attacks
        if (isLead() && api.is_in_range(m)) {
          m.dead = true;
          m.hp = 0;
          api.game_log("rare_kill " + m.mtype);
          state.S.rare = null;
          state.S.mode = "farm";
          return true;
        }
      } else {
        if (!rareGoneAt) rareGoneAt = now;
        else if (now - rareGoneAt > RARE_GONE_MS) {
          api.game_log("rare_gone");
          state.S.rare = null;
          state.S.mode = "farm";
        }
      }
    }
    if (now > assembleUntil) {
      api.game_log("rare_timeout");
      state.S.rare = null;
      state.S.mode = "farm";
    } else if (p && (p.map !== api.character.map || motion.dist(api.character, p) > 100)) {
      await motion.goTo({ map: p.map, x: p.real_x != null ? p.real_x : p.x, y: p.real_y != null ? p.real_y : p.y });
    }
    return true;
  }

  async function tickFarm(now) {
    if (state.S.intent.hold) {
      // hop-prep to HOME if not already
      const reg = api.parent.server_region;
      const id = api.parent.server_identifier;
      if (reg && id && (reg !== HOME[0] || id !== HOME[1])) {
        await hopPrep(HOME);
        return;
      }
      state.setSelf({ task: "hold" });
      return;
    }
    if (state.S.intent.world) {
      const w = state.S.intent.world;
      state.S.intent.world = null;
      await hopPrep(w);
      return;
    }

    const pots = refreshPots();
    if (pots === "dry") {
      if (dlvPending && lastStatusAt && now - lastStatusAt < FALLBACK_SILENCE_MS) {
        // wait for merchant
        if (now - lastBeacon > BEACON_MS) {
          lastBeacon = now;
          await api.send_cm(MERCHANT, {
            dlv_loc: 1,
            id: dlvPending.id,
            map: api.character.map,
            x: api.character.real_x,
            y: api.character.real_y,
          });
        }
        return;
      }
      if (dlvPending && now - dlvPending.t0 > FALLBACK_SILENCE_MS) {
        await townFallback();
        return;
      }
      if (!dlvPending) await requestPots();
      return;
    }
    if (pots === "low" && !dlvPending) await requestPots();

    if (!isLead()) {
      state.setSelf({ task: "follow" });
      await motion.followLeader();
      return;
    }

    // Leader farms
    const mtype = state.S.intent.mtype || "armadillo";
    const mon = api.get_nearest_monster({ type: mtype });
    if (!mon) {
      state.setSelf({ task: "moving" });
      if (isLead()) {
        chat.enqueue("Transfer " + mtype, "echo");
        chat.tick(now);
        const ok = await motion.waitParty(now, 5000);
        if (!ok && Object.keys(api.get_party() || {}).length > 1) {
          // aborted
          return;
        }
      }
      await motion.goTo({ to: mtype });
      return;
    }
    state.setSelf({ task: "farm" });
    // consume pot lightly to create delivery pressure in long farms
    if (opts.burnPots && now % 10000 < 250) {
      for (const it of api.character.items) {
        if (it && it.name === "hpot1" && it.q > 0) {
          it.q--;
          break;
        }
      }
    }
  }

  async function tick() {
    const now = api._now();
    motion.evalPresent(now);
    if (isLead() && now - lastHb >= HEARTBEAT_MS) {
      lastHb = now;
      chat.enqueue(state.formatHeartbeat(), "hb");
    }
    chat.tick(now);

    if (await tickRare(now)) return;
    await tickFarm(now);
    chat.tick(now);
  }

  api.on("partym", hearParty);
  api.on("cm", (m) => {
    hearCm(m);
  });

  // seed pots from inventory
  refreshPots();

  return {
    tick,
    state,
    chat,
    motion,
    isLead,
    requestPots,
    hopPrep,
    applyCmd: (c) => applyCmd(c, true),
    get dlvPending() {
      return dlvPending;
    },
    _setDlv(p) {
      dlvPending = p;
      lastStatusAt = api._now();
    },
  };
}

module.exports = { bootFighter };
