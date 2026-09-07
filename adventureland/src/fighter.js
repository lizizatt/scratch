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
const { packCenter } = require("../sim/world");

/**
 * Boot a fighter into a sim (or real) API environment.
 * api must provide: character, party_say, send_cm, get_player, get_party,
 * smart_move, sleep, game_log, on, parent, buy, use, send_gold, items helpers.
 * Heap wipes on change_server; intent/dlv restored from localStorage.
 */
function bootFighter(api, opts) {
  opts = opts || {};
  const name = api.character.name;
  const SK = "v2state_" + name;
  const state = createPartyState(name);
  const chat = createChatQueue(api);
  api._now = () => (opts.now ? opts.now() : Date.now());

  let lastHb = 0;
  let dlvPending = null;
  let lastBeacon = 0;
  let lastStatusAt = 0;
  let assembleUntil = 0;
  let rareGoneAt = 0;

  function persist() {
    try {
      api.storage.setItem(
        SK,
        JSON.stringify({
          intent: state.S.intent,
          mode: state.S.mode,
          lead: state.S.lead,
          seq: state.S.seq,
          rare: state.S.rare,
          dlv: dlvPending,
          lastHb,
          assembleUntil,
          rareGoneAt,
          lastStatusAt,
        })
      );
    } catch (e) {}
  }

  function restore() {
    try {
      const raw = api.storage.getItem(SK);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.intent) state.S.intent = d.intent;
      if (d.mode) state.S.mode = d.mode;
      if (d.lead) state.S.lead = d.lead;
      if (d.seq) state.S.seq = Object.assign(state.S.seq, d.seq);
      if (d.rare) state.S.rare = d.rare;
      if (d.dlv) dlvPending = d.dlv;
      if (d.lastHb) lastHb = d.lastHb;
      if (d.assembleUntil) assembleUntil = d.assembleUntil;
      if (d.rareGoneAt) rareGoneAt = d.rareGoneAt;
      if (d.lastStatusAt) lastStatusAt = d.lastStatusAt;
    } catch (e) {}
  }

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

  /** Free ≥1 bag slot by selling junk, then surplus pots if dry on the other type. */
  async function freeBagSlot() {
    if ((api.character.esize || 0) >= 1) return true;
    async function sellAt(i, it) {
      if (typeof api.sell !== "function") return false;
      await api.sell(i, it.q == null ? 1 : it.q);
      api.game_log("bag:sell " + it.name);
      return (api.character.esize || 0) >= 1;
    }
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (!it) continue;
      if (/^hpot|^mpot/.test(it.name)) continue;
      if (await sellAt(i, it)) return true;
    }
    // Pot-only full bag: dry on one type while the other fills every slot
    const c = countPots(api.character.items);
    if (c.hp === 0 || c.mp === 0) {
      const prefer = c.hp > c.mp ? /^hpot/ : /^mpot/;
      for (let i = 0; i < api.character.items.length; i++) {
        const it = api.character.items[i];
        if (!it || !prefer.test(it.name)) continue;
        if (await sellAt(i, it)) return true;
      }
    }
    api.game_log("bag:full");
    return (api.character.esize || 0) >= 1;
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
      if (!(await freeBagSlot())) {
        api.game_log("dlv:skip no_space");
        return;
      }
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
    persist();
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
    if (api.character.gold < GOLD_FLOAT_FIGHTER) {
      api.game_log("town_fallback low_gold");
      persist();
      return; // never buy into debt (LESSONS #5)
    }
    await motion.goTo({ to: "potions" });
    await api.buy("hpot1", POTION_TARGET);
    await api.buy("mpot1", POTION_TARGET);
    refreshPots();
    persist();
  }

  async function hopPrep(targetServer) {
    const reg0 = api.parent.server_region;
    const id0 = api.parent.server_identifier;
    if (!reg0 || !id0) {
      api.game_log("go_s:wait");
      return;
    }
    // Restock if low before hop (LESSONS #3)
    const b = refreshPots();
    if (b !== "ok") {
      if (api.character.gold < GOLD_FLOAT_FIGHTER) {
        api.game_log("hop_prep low_gold");
      } else {
        await motion.goTo({ to: "potions" });
        await api.buy("hpot1", POTION_TARGET);
        await api.buy("mpot1", POTION_TARGET);
      }
    }
    await api.send_cm(MERCHANT, { job: "cancel_all", who: name });
    if (isLead()) chat.enqueue("World " + targetServer[0] + "/" + targetServer[1], "echo");
    chat.tick(api._now());
    persist();
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
      persist();
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
    const party = Object.keys(api.get_party() || {});
    const present = party.length ? party : [name];
    const cmd = parsed.cmd;
    // Lead owns intent broadcast; every fighter must apply hold/resume/hunt locally
    // or followers never hop (adversarial: setIntent is lead-only).
    if (cmd === "hold") {
      if (isLead()) state.setIntent({ hold: 1, kind: "hold" }, present);
      else {
        state.S.intent.hold = 1;
        state.S.intent.kind = "hold";
      }
      state.S.mode = "hold";
    } else if (cmd === "resume") {
      if (isLead()) state.setIntent({ hold: 0, kind: "farm" }, present);
      else {
        state.S.intent.hold = 0;
        state.S.intent.kind = "farm";
      }
      state.S.mode = "farm";
      state.S.rare = null;
    } else if (cmd === "hunt" && parsed.args[0]) {
      if (isLead()) state.setIntent({ kind: "hunt", mtype: parsed.args[0], hold: 0 }, present);
      else {
        state.S.intent.kind = "hunt";
        state.S.intent.mtype = parsed.args[0];
        state.S.intent.hold = 0;
      }
      state.S.mode = "farm";
    } else if (cmd === "grind") {
      if (isLead()) state.setIntent({ kind: "farm", hold: 0 }, present);
      else {
        state.S.intent.kind = "farm";
        state.S.intent.hold = 0;
      }
    } else if (cmd === "world" && parsed.args[0]) {
      const parts = parsed.args[0].split("/");
      if (isLead()) state.setIntent({ world: parts }, present);
      else state.S.intent.world = parts;
    }
    if (mine) chat.enqueue("!" + cmd + (parsed.args[0] ? " " + parsed.args[0] : ""), "echo");
    persist();
  }

  async function hearCm(m) {
    const d = m.message;
    if (!d || typeof d !== "object") return;
    if (d.dlv_ack && dlvPending && d.id === dlvPending.id) {
      dlvPending.acked = d.ok ? 1 : 0;
      lastStatusAt = api._now();
      api.game_log("dlv:ack ok=" + (d.ok ? 1 : 0));
      if (!d.ok) dlvPending = null;
      persist();
    }
    if (d.status && dlvPending && (!d.id || d.id === dlvPending.id)) {
      lastStatusAt = api._now();
      dlvPending.phase = d.phase;
      persist();
    }
    if (d.dlv_done && dlvPending && d.id === dlvPending.id) {
      api.game_log("dlv:done");
      dlvPending = null;
      refreshPots();
      persist();
    }
    if (d.job === "meet_home" || d.hold === 1) {
      state.setIntent({ hold: 1, kind: "hold" });
      persist();
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
        persist();
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
          persist();
          return true;
        }
      } else {
        if (!rareGoneAt) rareGoneAt = now;
        else if (now - rareGoneAt > RARE_GONE_MS) {
          api.game_log("rare_gone");
          state.S.rare = null;
          state.S.mode = "farm";
          persist();
        }
      }
    }
    if (now > assembleUntil) {
      api.game_log("rare_timeout");
      state.S.rare = null;
      state.S.mode = "farm";
      persist();
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
      const target = state.S.intent.world;
      const reg = api.parent.server_region;
      const id = api.parent.server_identifier;
      if (!reg || !id) {
        api.game_log("go_s:wait");
        return; // keep intent.world until region is ready
      }
      state.S.intent.world = null;
      persist();
      await hopPrep(target);
      return;
    }

    const pots = refreshPots();
    if (pots === "dry") {
      if ((api.character.esize || 0) < 1) {
        await freeBagSlot();
      }
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
      if (RARE_WHITELIST.indexOf(mtype) >= 0) {
        // Never path by type for rares (LESSONS #6) — wait for spot / coords
        api.game_log("farm:skip_rare_type " + mtype);
        return;
      }
      if (isLead()) {
        chat.enqueue("Transfer " + mtype, "echo");
        chat.tick(now);
        const ok = await motion.waitParty(now, 5000);
        if (!ok && Object.keys(api.get_party() || {}).length > 1) {
          return;
        }
      }
      const pc = packCenter(mtype);
      if (pc) await motion.goTo({ map: pc.map, x: pc.x, y: pc.y });
      else await motion.goTo({ to: mtype });
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

    if (await tickRare(now)) {
      persist();
      return;
    }
    await tickFarm(now);
    chat.tick(now);
    persist();
  }

  restore();

  if (typeof api.clearHandlers === "function") api.clearHandlers();
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
    persist,
    freeBagSlot,
    applyCmd: (c) => applyCmd(c, true),
    get dlvPending() {
      return dlvPending;
    },
    _setDlv(p) {
      dlvPending = p;
      lastStatusAt = api._now();
      persist();
    },
  };
}

module.exports = { bootFighter };
