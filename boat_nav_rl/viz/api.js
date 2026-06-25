/** Shared API client — detects HTML error pages from stale/wrong server. */
const BoatNavApi = (() => {
  const API_VERSION = 1;
  const DEFAULT_SIM_CONSTANTS = {
    vessel_classes: { dinghy: 8, workboat: 15, freighter: 35 },
    own_radius_m: 15,
    cpa_margin_m: 30,
    goal_success_range_m: 50,
  };
  let simConstants = { ...DEFAULT_SIM_CONSTANTS };

  async function fetchJson(url, opts = {}) {
    const res = await fetch(url, opts);
    const contentType = res.headers.get("Content-Type") || "";
    const text = await res.text();

    if (!contentType.includes("application/json")) {
      if (text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html")) {
        throw new Error(
          `Expected JSON from ${url} but got HTML. ` +
            "Open pages via python serve.py (not file://) and restart the server if it was started before recent updates."
        );
      }
      throw new Error(`Expected JSON from ${url} (got ${contentType || "unknown"})`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON from ${url}: ${e.message}`);
    }

    if (!res.ok) {
      throw new Error(data.error || `${url} -> HTTP ${res.status}`);
    }
    return data;
  }

  async function checkHealth() {
    const data = await fetchJson("/api/health");
    if (data.api_version != null && data.api_version !== API_VERSION) {
      console.warn(
        `API version mismatch: page expects ${API_VERSION}, server reports ${data.api_version}`
      );
    }
    return data;
  }

  async function loadSimConstants() {
    try {
      const cfg = await fetchJson("/api/plant/config");
      if (cfg.sim_constants) {
        simConstants = { ...DEFAULT_SIM_CONSTANTS, ...cfg.sim_constants };
      }
    } catch (_) {
      simConstants = { ...DEFAULT_SIM_CONSTANTS };
    }
    return simConstants;
  }

  function getSimConstants() {
    return simConstants;
  }

  function escapeHtml(text) {
    return BoatNavUtil.escapeHtml(text);
  }

  function cpaSafeRadiusM(contact, ownRadiusM = simConstants.own_radius_m) {
    const classes = simConstants.vessel_classes || DEFAULT_SIM_CONSTANTS.vessel_classes;
    const contactR = contact?.radius_m ?? classes.workboat ?? 15;
    return ownRadiusM + contactR + (simConstants.cpa_margin_m ?? 30);
  }

  return {
    fetchJson,
    checkHealth,
    loadSimConstants,
    getSimConstants,
    cpaSafeRadiusM,
    escapeHtml,
    API_VERSION,
  };
})();
