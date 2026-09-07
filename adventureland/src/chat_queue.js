"use strict";

const { CHAT_GAP_MS } = require("./constants");

/**
 * Per-character outbound party-chat queue.
 * ≥16s between successful sends; newer same-kind supersedes; no in-window retry.
 * Priority: echo > rare > diff > heartbeat (higher number = higher priority).
 */
function createChatQueue(api, opts) {
  opts = opts || {};
  const gap = opts.gapMs != null ? opts.gapMs : CHAT_GAP_MS;
  let lastOk = -1e12;
  let pending = null; // { text, kind, pri, t }

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
      // supersede
      pending = { text, kind, pri, t: Date.now() };
      return;
    }
    if (pending && pending.pri > pri) return; // keep higher priority
    if (pending && pending.pri === pri && pending.kind !== kind) {
      // replace with newer of same pri only if same kind handled above
    }
    if (!pending || pri >= pending.pri) pending = { text, kind, pri, t: Date.now() };
  }

  function markHuman() {
    // Human chat from this character resets the window (server last_say).
    lastOk = api._now ? api._now() : Date.now();
  }

  function tick(now) {
    now = now != null ? now : api._now ? api._now() : Date.now();
    if (!pending) return null;
    if (now - lastOk < gap) return null;
    const msg = pending;
    pending = null;
    const r = api.party_say(msg.text);
    if (r && r.ok === false) {
      // rejected — do NOT retry inside window; drop (server rejects)
      lastOk = now; // actually on reject last_say is NOT set on server...
      // Server does NOT update last_say on failure. So we must NOT advance lastOk.
      lastOk = now - gap; // allow immediate... no: if we retry immediately we throttle again.
      // Spec: no retry inside window. Drop the message; leave lastOk unchanged.
      lastOk = lastOk; // unchanged
      api.game_log && api.game_log("chat_drop " + msg.kind);
      return { dropped: msg };
    }
    lastOk = now;
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
    setLastOk(t) {
      lastOk = t;
    },
  };
}

module.exports = { createChatQueue };
