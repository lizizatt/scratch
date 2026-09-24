"use strict";

/** Per-character localStorage that survives change_server (heap wipe). */
function createStorage(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
    },
    setItem(k, v) {
      data[k] = String(v);
    },
    removeItem(k) {
      delete data[k];
    },
    clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
    _dump() {
      return Object.assign({}, data);
    },
  };
}

module.exports = { createStorage };
