/** Pure string / chart helpers shared by viz pages. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.BoatNavUtil = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shortRunId(id) {
    if (!id) return "—";
    return id.length > 15 ? id.slice(9) : id;
  }

  function liveMetricsFingerprint(series) {
    if (!series || !series.length) return "";
    const last = series[series.length - 1];
    return `${series.length}:${last.timesteps}:${last.t_sec}:${last.score}`;
  }

  function breakdownDisplayY(raw, spec) {
    if (raw == null) return null;
    if (spec?.penalty) return -raw;
    return raw;
  }

  return {
    escapeHtml,
    shortRunId,
    liveMetricsFingerprint,
    breakdownDisplayY,
  };
});
