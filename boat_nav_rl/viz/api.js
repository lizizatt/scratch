/** Shared API client — detects HTML error pages from stale/wrong server. */
const BoatNavApi = (() => {
  const API_VERSION = 1;

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
    return fetchJson("/api/health");
  }

  return { fetchJson, checkHealth, API_VERSION };
})();
