"use strict";

const { CHAT_GAP_MS } = require("./constants");

/**
 * Per-character outbound party-chat queue.
 * ≥16s between successful sends; newer same-kind supersedes; no in-window retry.
 * On reject: lastOk unchanged (server doesn't bump last_say); coolUntil blocks storm retry.
 */
function createChatQueue(api, opts) {
  opts = opts || {};
  const gap = opts.gapMs != null ? opts.gapMs : CHAT_GAP_MS;
  let lastOk = -1e12;
  let coolUntil = 0;
  let pending = null; // { text, kind, pri }

  function kindPri(kind) {
    if (kind === "echo") return 40;
    if (kind === "rare") return 30;
    if (kind === "diff") return 20;
    if (kind === "hb") return 10;
    return 0;
  }

  function enqueue(text, kind) {
    const pri = kindPri(kind);
    if (pending && pending.kind === kind) {
      pending = { text, kind, pri };
      return;
    }
    if (pending && pending.pri > pri) return;
    if (!pending || pri >= pending.pri) pending = { text, kind, pri };
  }

  function markHuman() {
    const now = api._now ? api._now() : Date.now();
    lastOk = now;
    coolUntil = now + gap;
  }

  function tick(now) {
    now = now != null ? now : api._now ? api._now() : Date.now();
    if (!pending) return null;
    if (now < coolUntil) return null;
    if (now - lastOk < gap) return null;
    const msg = pending;
    pending = null;
    const r = api.party_say(msg.text);
    if (r && r.ok === false) {
      // Server did not update last_say — do not move lastOk.
      // Block retries until gap elapses from this attempt.
      coolUntil = now + gap;
      api.game_log && api.game_log("chat_drop " + msg.kind);
      return { dropped: msg };
    }
    lastOk = now;
    coolUntil = 0;
    return { sent: msg };
  }

  return {
    enqueue,
    tick,
    markHuman,
    get pending() {
      return pending;
    },
    get lastOk() {
      return lastOk;
    },
    get coolUntil() {
      return coolUntil;
    },
    setLastOk(t) {
      lastOk = t;
    },
  };
}

module.exports = { createChatQueue };
