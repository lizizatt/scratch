"use strict";

const { LEADER_ORDER, POTION_LOW, POTION_DRY, DEFAULT_FARM } = require("./constants");

function potBucket(hpCount, mpCount) {
  const n = Math.min(hpCount || 0, mpCount || 0);
  if (n <= POTION_DRY) return "dry";
  if (n < POTION_LOW) return "low";
  return "ok";
}

function countPots(items) {
  let hp = 0,
    mp = 0;
  for (const it of items || []) {
    if (!it) continue;
    const q = it.q == null ? 1 : it.q;
    if (it.name === "hpot0" || it.name === "hpot1") hp += q;
    if (it.name === "mpot0" || it.name === "mpot1") mp += q;
  }
  return { hp, mp };
}

function emptyMember() {
  return { pots: "ok", rip: false, task: "idle", gear: null };
}

function createPartyState(selfName, defaultFarm) {
  const S = {
    seq: {},
    lead: "Jazwyn",
    intent: { kind: "farm", mtype: defaultFarm || DEFAULT_FARM, hold: 0, t: 0 },
    mode: "farm",
    rare: null,
    dlv: null,
    members: {},
  };
  for (const n of LEADER_ORDER) {
    S.seq[n] = 0;
    S.members[n] = emptyMember();
  }

  let lastSent = null;

  function bump() {
    S.seq[selfName] = (S.seq[selfName] || 0) + 1;
  }

  function setSelf(fields) {
    Object.assign(S.members[selfName], fields);
    bump();
  }

  function setIntent(intent, presentNames) {
    const lead = currentLeader(presentNames);
    if (selfName !== lead) return;
    S.lead = lead;
    S.intent = Object.assign({}, S.intent, intent, { t: Date.now() });
    bump();
  }

  function currentLeader(presentNames) {
    // Succession: first in LEADER_ORDER who is *actually present* (party list).
    // Never treat static members keys as online when presentNames omitted — require explicit list.
    const names = presentNames && presentNames.length ? presentNames : [selfName];
    for (const n of LEADER_ORDER) {
      if (names.indexOf(n) >= 0 && !(S.members[n] && S.members[n].rip)) return n;
    }
    return names[0] || selfName;
  }

  function applyHeartbeat(from, parsed, presentNames) {
    if (!parsed) return;
    // Stale seq: ignore entirely (do not rewrite farm/mode/hold).
    if (from && S.seq[from] != null && parsed.seq != null && parsed.seq < S.seq[from]) {
      return;
    }
    if (parsed.seq != null) S.seq[from] = Math.max(S.seq[from] || 0, parsed.seq);

    // Owner-write: only the current lead may publish shared intent fields.
    // presentNames should be the live party list (same as setIntent); fall back to
    // sender+self so succession still works when the caller omitted the list.
    const present =
      presentNames && presentNames.length
        ? presentNames
        : [from, selfName].filter(Boolean);
    const lead = currentLeader(present);
    if (from !== lead) return;

    S.lead = from;
    if (parsed.f) S.intent.mtype = parsed.f;
    if (parsed.m) S.mode = parsed.m;
    if (parsed.h != null) S.intent.hold = parsed.h;
  }

  function applyDiff(from, parsed) {
    if (!parsed || !S.members[from]) return;
    if (parsed.p) S.members[from].pots = parsed.p;
    if (parsed.rip != null) {
      S.members[from].rip =
        parsed.rip === true || parsed.rip === 1 || parsed.rip === "1";
    }
    if (parsed.task) S.members[from].task = parsed.task;
    if (parsed.seq != null) S.seq[from] = Math.max(S.seq[from] || 0, parsed.seq);
  }

  function applyRare(from, mtype) {
    S.rare = { mtype, by: from, t: Date.now() };
    S.mode = "rare";
  }

  function formatHeartbeat() {
    return (
      "~S f=" +
      (S.intent.mtype || "-") +
      " m=" +
      S.mode +
      " h=" +
      (S.intent.hold ? 1 : 0) +
      " seq=" +
      (S.seq[selfName] || 0)
    );
  }

  function formatDiff() {
    const m = S.members[selfName];
    return "~d p=" + m.pots + " rip=" + (m.rip ? "1" : "0") + (m.task ? " task=" + m.task : "");
  }

  function parseLine(line) {
    line = ("" + line).trim();
    if (line.indexOf("~S ") === 0) {
      const o = { type: "hb" };
      line
        .slice(3)
        .split(/\s+/)
        .forEach((p) => {
          const i = p.indexOf("=");
          if (i > 0) o[p.slice(0, i)] = isFinite(p.slice(i + 1)) ? Number(p.slice(i + 1)) : p.slice(i + 1);
        });
      return o;
    }
    if (line.indexOf("~d ") === 0) {
      const o = { type: "diff" };
      line
        .slice(3)
        .split(/\s+/)
        .forEach((p) => {
          const i = p.indexOf("=");
          if (i > 0) o[p.slice(0, i)] = p.slice(i + 1);
        });
      return o;
    }
    if (line.indexOf("~R ") === 0) return { type: "rare", mtype: line.slice(3).trim() };
    if (line.indexOf("!") === 0) {
      const parts = line.slice(1).split(/\s+/);
      return { type: "cmd", cmd: parts[0], args: parts.slice(1) };
    }
    return null;
  }

  function diffNeeded() {
    const snap = formatDiff();
    if (snap !== lastSent) {
      lastSent = snap;
      return snap;
    }
    return null;
  }

  return {
    S,
    potBucket,
    countPots,
    setSelf,
    setIntent,
    currentLeader,
    applyHeartbeat,
    applyDiff,
    applyRare,
    formatHeartbeat,
    formatDiff,
    parseLine,
    diffNeeded,
    bump,
  };
}

module.exports = { createPartyState, potBucket, countPots };
