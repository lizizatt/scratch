"use strict";

/** Deterministic accelerated clock for multi-character sim. */
function createClock(opts) {
  opts = opts || {};
  let now = opts.start != null ? opts.start : 0;
  const listeners = [];
  return {
    now() {
      return now;
    },
    /** Advance simulated time by ms. Returns new now. */
    advance(ms) {
      now += Math.max(0, ms | 0);
      for (const fn of listeners) fn(now, ms);
      return now;
    },
    onAdvance(fn) {
      listeners.push(fn);
    },
    set(ms) {
      now = ms;
    },
  };
}

module.exports = { createClock };
