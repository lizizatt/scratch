/* COLREGS score breakdown panel — replay and exercise */

function colregsScoreClass(value, threshold = 70) {
  if (value == null || Number.isNaN(value)) return "";
  if (value >= threshold) return "score-good";
  if (value >= threshold * 0.5) return "score-warn";
  return "score-bad";
}

function fmtColregsScore(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)}%`;
}

function fmtRuleMap(byRule) {
  if (!byRule || !Object.keys(byRule).length) return "";
  return Object.entries(byRule)
    .map(([rule, score]) => `<li><span class="rule-id">${rule}</span> ${fmtColregsScore(score)}</li>`)
    .join("");
}

function renderEncounterCards(encounters, { compact = false } = {}) {
  if (!encounters || !encounters.length) return "";
  return encounters
    .map((enc) => {
      const sClass = colregsScoreClass(enc.safety_S);
      const rClass = colregsScoreClass(enc.protocol_R);
      const pose = enc.pose_cpa || enc.pose_0;
      const poseTxt = pose
        ? `α ${pose.alpha_deg}° · β ${pose.beta_deg}°`
        : "pose —";
      const detail = compact
        ? ""
        : `<div class="colregs-enc-detail">
            CPA ${enc.r_cpa_m != null ? `${enc.r_cpa_m} m` : "—"}
            ${enc.tcpa_s != null ? ` · TCPA ${enc.tcpa_s} s` : ""}
            · ${poseTxt}
          </div>`;
      return `<div class="colregs-encounter">
        <div class="colregs-enc-head">
          <span>#${enc.contact_index + 1} ${enc.rule_id || "?"}</span>
          <span class="${sClass}">S ${fmtColregsScore(enc.safety_S)}</span>
          <span class="${rClass}">R ${fmtColregsScore(enc.protocol_R)}</span>
        </div>
        ${detail}
      </div>`;
    })
    .join("");
}

function renderLiveContacts(live) {
  if (!live || !live.live_contacts || !live.live_contacts.length) return "";
  return `<div class="colregs-subhead">Live (now)</div>
    ${live.live_contacts
      .map((c) => {
        const cls = colregsScoreClass(c.safety_S);
        return `<div class="colregs-live-row">
          <span>#${c.contact_index + 1} ${c.rule_id}</span>
          <span>${c.range_m} m · CPA ${c.r_cpa_m} m</span>
          <span class="${cls}">${fmtColregsScore(c.safety_S)}</span>
          <span class="colregs-live-breakdown">S<sub>r</sub> ${fmtColregsScore(c.breakdown?.S_r)} · S<sub>θ</sub> ${fmtColregsScore(c.breakdown?.S_theta)}</span>
        </div>`;
      })
      .join("")}`;
}

/**
 * @param {HTMLElement} el
 * @param {object} data — episode colregs, frame colregs, or exercise colregs payload
 * @param {object} opts
 */
function renderColregsPanel(el, data, opts = {}) {
  if (!el) return;
  const {
    title = "COLREGS",
    emptyText = "No contacts — scores appear when intruders are present.",
    showLive = false,
    compact = false,
  } = opts;

  if (!data) {
    el.innerHTML = `<h2>${title}</h2><p class="panel-hint">${emptyText}</p>`;
    return;
  }

  // Exercise payload: { vessels, mean_safety_S, live }
  if (Array.isArray(data.vessels)) {
    if (!data.vessels.length) {
      el.innerHTML = `<h2>${title}</h2><p class="panel-hint">${emptyText}</p>`;
      return;
    }
    const aggS = data.mean_safety_S;
    const aggR = data.mean_protocol_R;
    el.innerHTML = `<h2>${title}</h2>
      <dl class="colregs-summary">
        <dt>Mean safety S</dt><dd class="${colregsScoreClass(aggS)}">${fmtColregsScore(aggS)}</dd>
        <dt>Mean protocol R</dt><dd class="${colregsScoreClass(aggR)}">${fmtColregsScore(aggR)}</dd>
      </dl>
      ${showLive ? renderLiveContacts(data.live) : ""}
      ${data.vessels
        .map(
          (v) => `<div class="colregs-vessel-block">
            <div class="colregs-subhead">Vessel ${v.vessel}</div>
            <dl class="colregs-summary compact">
              <dt>S</dt><dd class="${colregsScoreClass(v.mean_safety_S)}">${fmtColregsScore(v.mean_safety_S)}</dd>
              <dt>R</dt><dd class="${colregsScoreClass(v.mean_protocol_R)}">${fmtColregsScore(v.mean_protocol_R)}</dd>
            </dl>
            ${renderEncounterCards(v.encounters, { compact })}
          </div>`
        )
        .join("")}`;
    return;
  }

  const meanS = data.mean_safety_S;
  const meanR = data.mean_protocol_R;
  const encounters = data.encounters || [];
  if (meanS == null && !encounters.length) {
    el.innerHTML = `<h2>${title}</h2><p class="panel-hint">${emptyText}</p>`;
    return;
  }

  el.innerHTML = `<h2>${title}</h2>
    <dl class="colregs-summary">
      <dt>Mean safety S</dt><dd class="${colregsScoreClass(meanS)}">${fmtColregsScore(meanS)}</dd>
      <dt>Mean protocol R</dt><dd class="${colregsScoreClass(meanR)}">${fmtColregsScore(meanR)}</dd>
      <dt>Min safety S</dt><dd class="${colregsScoreClass(data.min_safety_S)}">${fmtColregsScore(data.min_safety_S)}</dd>
    </dl>
    ${data.by_rule && Object.keys(data.by_rule).length ? `<ul class="colregs-rules">${fmtRuleMap(data.by_rule)}</ul>` : ""}
    ${showLive ? renderLiveContacts(data.live) : ""}
    ${renderEncounterCards(encounters, { compact })}`;
}

function nearestFrameScore(series, frameIndex) {
  if (!series || !series.length) return null;
  let best = series[0];
  for (const row of series) {
    if (row.frame <= frameIndex) best = row;
    else break;
  }
  return best;
}

window.ColregsPanel = {
  renderColregsPanel,
  nearestFrameScore,
  fmtColregsScore,
  colregsScoreClass,
};
