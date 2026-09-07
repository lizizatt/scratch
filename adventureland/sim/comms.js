"use strict";

/**
 * Comms model matching server.js §4.0:
 * - code chat: 1 / 15s / character (chat_slowdown)
 * - any chat: 400ms floor
 * - last_say set by ANY successful say (code or human)
 * - CM: same-server only; receivers lists who got it
 * - PM: cross-server, shares 15s code budget
 */
const CODE_CHAT_MS = 15000;
const ANY_CHAT_MS = 400;

function createComms(clock) {
  /** name -> { lastSay, calls } */
  const state = new Map();

  function ensure(name) {
    if (!state.has(name)) state.set(name, { lastSay: null, calls: 0, logs: [] });
    return state.get(name);
  }

  function ssince(t) {
    if (t == null) return 1e9;
    return (clock.now() - t) / 1000;
  }
  function mssince(t) {
    if (t == null) return 1e9;
    return clock.now() - t;
  }

  /**
   * @param {{name, code?:boolean, kind:"party"|"pm"|"say"}} opts
   * @returns {{ok:boolean, reason?:string}}
   */
  function trySay(opts) {
    const s = ensure(opts.name);
    const code = opts.code !== false; // CODE always code=true via safeties
    if (code && s.lastSay != null && ssince(s.lastSay) < 15) {
      s.logs.push({ t: clock.now(), type: "chat_slowdown", msg: "You can't chat this fast." });
      return { ok: false, reason: "chat_slowdown" };
    }
    if (s.lastSay != null && mssince(s.lastSay) < ANY_CHAT_MS) {
      s.logs.push({ t: clock.now(), type: "chat_slowdown", msg: "You can't chat this fast." });
      return { ok: false, reason: "chat_slowdown" };
    }
    s.lastSay = clock.now();
    s.logs.push({ t: clock.now(), type: opts.kind || "party", message: opts.message, code });
    return { ok: true };
  }

  /** Human-typed chat from a character's client — resets the window. */
  function humanSay(name, message) {
    return trySay({ name, message, code: false, kind: "human" });
    // Note: human also sets last_say; code=false still hits 400ms floor,
    // and subsequent code chat within 15s of this last_say still fails
    // because last_say is set. Matching server: last_say is set for ALL
    // successful says; the 15s gate only applies when data.code is true.
  }

  /**
   * Fix humanSay: on server, non-code only checks 400ms, but still SETS last_say.
   * So after human say, code chat within 15s fails. Correct implementation:
   */
  function humanSayFixed(name, message) {
    const s = ensure(name);
    if (s.lastSay != null && mssince(s.lastSay) < ANY_CHAT_MS) {
      s.logs.push({ t: clock.now(), type: "chat_slowdown", msg: "You can't chat this fast." });
      return { ok: false, reason: "chat_slowdown" };
    }
    s.lastSay = clock.now();
    s.logs.push({ t: clock.now(), type: "human", message });
    return { ok: true };
  }

  return {
    CODE_CHAT_MS,
    ANY_CHAT_MS,
    trySay,
    humanSay: humanSayFixed,
    bumpCall(name) {
      ensure(name).calls++;
    },
    getState(name) {
      return ensure(name);
    },
    throttleLogs(name) {
      return ensure(name).logs.filter((l) => l.type === "chat_slowdown");
    },
    allThrottleLogs() {
      const out = [];
      for (const [name, s] of state) {
        for (const l of s.logs) if (l.type === "chat_slowdown") out.push(Object.assign({ name }, l));
      }
      return out;
    },
    reset() {
      state.clear();
    },
  };
}

module.exports = { createComms, CODE_CHAT_MS, ANY_CHAT_MS };
