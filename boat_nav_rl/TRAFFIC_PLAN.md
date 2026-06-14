# Traffic & CPA Plan

## Goals

- **Unified env:** one `BoatNavEnv`; contacts come from the scenario seed, not a separate `avoid` mode.
- **Sized intruders:** discrete vessel classes (`dinghy`, `workboat`, `freighter`) with collision/CPA radii.
- **True CPA reward:** geometric closest-point-of-approach, threshold = `R_own + R_contact + margin`.
- **CPA horizon:** penalize only when `0 ≤ TCPA ≤ horizon` (default 120 s).
- **No stationary flag in obs:** anchored traffic uses `sog_mps = 0`; the policy infers motion from COG/SOG like AIS.
- **Sensing noise:** configurable Gaussian noise on contact bearing/range in observations (true sim state unchanged).
- **OBS layout frozen at 77:** contact slot 6 carries normalized `radius_m` (replaces redundant through-water speed).

## Vessel classes

| Class      | `radius_m` | Typical use        |
|------------|------------|--------------------|
| `dinghy`   | 8          | small craft        |
| `workboat` | 15         | default own + intruder |
| `freighter`| 35         | large merchant     |

Own ship: `OWN_RADIUS_M = 15` (workboat).

## Scenario composition

Scenarios are built from two layers:

1. **Mission shell** — own start, heading, speed, goal (from `generate_mission_shells()`).
2. **Encounter template** — one or more contacts from `scenario_templates.py` (`spawn_encounter(...)`).

Categories:

- `clear/<mission>` — no contacts (navigation baseline).
- `traffic/<encounter>` — mission + intruder(s).

Train/eval split remains stratified by `(category prefix, encounter type)` via `split_train_eval()`.

## Encounter archetypes

| Archetype              | Motion                         |
|------------------------|--------------------------------|
| `crossing_stbd/port`   | constant COG/SOG               |
| `head_on`              | constant COG/SOG               |
| `beam`                 | constant COG/SOG               |
| `overtaking/overtaken` | constant COG/SOG               |
| `close_quarters`       | constant COG/SOG               |
| `stationary`           | `sog_mps = 0` (any COG)        |
| `multi_2` / `multi_3`  | compose archetypes             |

All vessel size tiers appear in traffic scenarios (no size curriculum).

## CPA

```
cpa_m, tcpa_s = compute_cpa_tcpa(own_pos, own_vel, contact_pos, contact_vel)
cpa_safe_m    = OWN_RADIUS_M + contact.radius_m + CPA_MARGIN_M

if 0 <= tcpa_s <= CPA_HORIZON_S and cpa_m < cpa_safe_m:
    penalty += W_CPA * (cpa_safe_m - cpa_m) / cpa_safe_m
```

Parallel tracks (`|v_rel| ≈ 0`): CPA falls back to current range; TCPA = ∞ (no horizon penalty unless already close).

## Observation noise

Training (`train.py` CONFIG):

- `CONTACT_OBS_NOISE_M` — std dev on sensed range (metres).
- `CONTACT_OBS_NOISE_BEARING_RAD` — std dev on sensed bearing.

Eval and scenario overview use zero noise.

## Training mode filter (legacy UI)

`MODE` in `train.py` filters seeds by contact count, not env behaviour:

| `MODE`     | Seeds used              |
|------------|-------------------------|
| `navigate` | `len(contacts) == 0`    |
| `avoid`    | `len(contacts) > 0`     |
| `all`      | entire library          |

## Implementation phases

| Phase | Status | Deliverable |
|-------|--------|-------------|
| P0    | done   | `TRAFFIC_PLAN.md`, `scenario_templates.py`, migrated `scenarios.py` |
| P1    | done   | `render_scenario_overview.py` |
| P2    | done   | Size model, obs noise, true CPA in `prepare.py` / `train.py` |
| P3    | later  | Encounter-close events, COLREGs scores (SCOPE.md) |

## Files

| File | Role |
|------|------|
| `scenario_templates.py` | Encounter spawn library, `compose_scenario()` |
| `scenarios.py` | Mission shells + traffic grid generation |
| `prepare.py` | Vessel radii, CPA helpers, obs packing |
| `render_scenario_overview.py` | Visual QA grid after `prepare.py` |
| `train.py` | Unified contacts, CPA reward, obs noise CONFIG |
