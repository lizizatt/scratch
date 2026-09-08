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
const { packCenter } = require("./packs");

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
  let bootQuietUntil = 0;

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

  /** Lead seq must climb above anything heard (plan §6.6.6). */
  function reseedSeqAboveHeard() {
    let maxH = 0;
    for (const n of Object.keys(state.S.seq)) {
      if (n === name) continue;
      maxH = Math.max(maxH, state.S.seq[n] || 0);
    }
    if ((state.S.seq[name] || 0) <= maxH) state.S.seq[name] = maxH + 1;
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
    const qty = opts.potionTarget != null ? opts.potionTarget : POTION_TARGET;
    const items = [
      { name: "hpot1", q: qty },
      { name: "mpot1", q: qty },
    ];
    const farm = state.S.intent.mtype;
    api.game_log("dlv:req id=" + id + " q=" + qty);
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

  /** Drain inventory to force restock pressure (sim / long-farm knobs). */
  function burnPotsNow(now) {
    if (!opts.burnPots) return;
    const per = opts.burnPerTick;
    function take(pred, n) {
      let left = n;
      for (const it of api.character.items) {
        if (!it || !pred(it.name) || left <= 0) continue;
        const q = it.q == null ? 1 : it.q;
        const use = Math.min(q, left);
        it.q = q - use;
        left -= use;
        if (it.q <= 0) {
          const i = api.character.items.indexOf(it);
          if (i >= 0) {
            api.character.items[i] = null;
            api.character.esize = (api.character.esize || 0) + 1;
          }
        }
      }
    }
    if (per == null) {
      // Legacy light burn: 1 hpot ~every 10s
      if (now % 10000 >= 250) return;
      take((n) => n === "hpot1" || n === "hpot0", 1);
      return;
    }
    take((n) => /^hpot/.test(n), per);
    take((n) => /^mpot/.test(n), per);
  }

  async function townFallback() {
    api.game_log("town_fallback");
    // Low gold: merchant delivery is the only option — never cancel it
    if (api.character.gold < GOLD_FLOAT_FIGHTER) {
      api.game_log("town_fallback low_gold");
      if (dlvPending) {
        lastStatusAt = api._now();
        await api.send_cm(MERCHANT, {
          dlv_loc: 1,
          id: dlvPending.id,
          map: api.character.map,
          x: api.character.real_x,
          y: api.character.real_y,
        });
      } else {
        await requestPots();
      }
      persist();
      return;
    }
    if (dlvPending) {
      await api.send_cm(MERCHANT, { job: "cancel_all", id: dlvPending.id, who: name });
      dlvPending = null;
    }
    // Coords first — named {to:"potions"} stalls on Mainframe (LESSONS)
    await motion.goTo({ map: "main", x: 56, y: -122 });
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
        await motion.goTo({ map: "main", x: 56, y: -122 });
        await api.buy("hpot1", POTION_TARGET);
        await api.buy("mpot1", POTION_TARGET);
      }
    }
    await api.send_cm(MERCHANT, { job: "cancel_all", who: name });
    // Same-server CM first (still on farm world before hop); PM if deaf
    if (isLead() && targetServer[0] === HOME[0] && targetServer[1] === HOME[1]) {
      const r = await api.send_cm(MERCHANT, { job: "meet_home" });
      if (!r.receivers || !r.receivers.length) {
        try {
          await api.pm(MERCHANT, "meet_home");
        } catch (e) {}
      }
    }
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
      if (isLead()) state.setIntent({ world: parts, hold: 0, kind: "farm" }, present);
      else {
        state.S.intent.world = parts;
        state.S.intent.hold = 0;
        state.S.intent.kind = "farm";
      }
    }
    if (mine) {
      chat.enqueue("!" + cmd + (parsed.args[0] ? " " + parsed.args[0] : ""), "echo");
      chat.tick(api._now());
    }
    persist();
  }

  async function hearCm(m) {
    const d = m.message;
    if (!d || typeof d !== "object") return;
    // Merchant console → CM (Puppygirl hunt/world/hold)
    if (d.hunt) applyCmd({ type: "cmd", cmd: "hunt", args: ["" + d.hunt] }, isLead());
    if (d.grind) applyCmd({ type: "cmd", cmd: "grind", args: [] }, isLead());
    if (d.world && Array.isArray(d.world))
      applyCmd({ type: "cmd", cmd: "world", args: [d.world[0] + "/" + d.world[1]] }, isLead());
    if (d.hold === 1) applyCmd({ type: "cmd", cmd: "hold", args: [] }, isLead());
    if (d.hold === 0) applyCmd({ type: "cmd", cmd: "resume", args: [] }, isLead());
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
      // After ack, give merchant PENDING_MS (path can be multi-minute via cave)
      const grace = dlvPending && dlvPending.acked ? PENDING_MS : FALLBACK_SILENCE_MS;
      if (dlvPending && lastStatusAt && now - lastStatusAt < grace) {
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
      if (dlvPending && now - dlvPending.t0 > grace) {
        await townFallback();
        return;
      }
      if (!dlvPending) await requestPots();
      return;
    }
    if (pots === "low" && !dlvPending) await requestPots();

    // Burn after restock checks so dry-wait does not waste pots
    burnPotsNow(now);

    if (!isLead()) {
      state.setSelf({ task: "follow" });
      if (opts.form) await motion.followFormation(opts.form);
      else await motion.followLeader();
      const mtype = state.S.intent.mtype || "armadillo";
      if (opts.pre_combat && opts.pre_combat()) {
        persist();
        return;
      }
      if (opts.combat) opts.combat(mtype);
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
        // Brief cohesion window; always proceed after (followers use followLeader)
        await motion.waitParty(now, 5000);
      }
      const pc = packCenter(mtype);
      if (pc) await motion.goTo({ map: pc.map, x: pc.x, y: pc.y });
      else await motion.goTo({ to: mtype });
      return;
    }
    state.setSelf({ task: "farm" });
    if (opts.pre_combat && opts.pre_combat()) return;
    if (opts.combat) opts.combat(mtype);
  }

  async function tick() {
    const now = api._now();
    // Jail / death before any farm motion (LESSONS)
    if (api.character.map === "jail") {
      api.game_log("jail:leave");
      try {
        if (typeof api.leave === "function") await api.leave();
      } catch (e) {}
      await api.sleep(1000);
      persist();
      return;
    }
    if (api.character.rip) {
      api.game_log("rip:respawn");
      try {
        if (typeof api.respawn === "function") await api.respawn();
      } catch (e) {}
      await api.sleep(1000);
      persist();
      return;
    }
    motion.evalPresent(now);
    if (isLead() && now >= bootQuietUntil && now - lastHb >= HEARTBEAT_MS) {
      reseedSeqAboveHeard();
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
  // Fresh boot: party_state defaults mtype to armadillo — honor opts.farm (bee/goo/…).
  // After hop, storage restore already applied intent; leave it.
  if (opts.farm) {
    let hadIntent = false;
    try {
      const raw = api.storage.getItem(SK);
      if (raw) {
        const d = JSON.parse(raw);
        hadIntent = !!(d && d.intent && d.intent.mtype);
      }
    } catch (e) {}
    if (!hadIntent) state.S.intent.mtype = opts.farm;
  }
  // Plan §6.6.6: listen one heartbeat cycle, reseed above heard, then publish
  lastHb = 0;
  bootQuietUntil = api._now() + HEARTBEAT_MS;

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
      // Test helper: set pending only — do not fake status (hearCm {status} bumps lastStatusAt)
      dlvPending = p;
      persist();
    },
  };
}

module.exports = { bootFighter };
