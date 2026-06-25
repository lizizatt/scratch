/** Serialize async API calls so overlapping requests cannot race. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.BoatNavApiQueue = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createApiQueue() {
    let chain = Promise.resolve();

    function enqueue(fn) {
      const run = chain.then(fn);
      chain = run.catch(() => {});
      return run;
    }

    return { enqueue };
  }

  return { createApiQueue };
});
