# COLREGS Scoring Plan (Woerner et al.)

Reference: *Quantifying Protocol Evaluation for Autonomous Collision Avoidance* — Woerner, Benjamin, Novitzky, Leonard (Springer; MIT/ONR). Source text: `springer.txt`.

Goal: represent the paper’s **safety** and **protocol compliance** scoring in `boat_nav_rl`, aligned with `SCOPE.md` (dense training shaping + sparse encounter-closed authoritative scores).

---

## 1. What the paper defines

Every encounter produces two independent scores on **0–100%**:

| Metric | Symbol | Based on | When computed |
|--------|--------|----------|---------------|
| **Safety** | `S` | CPA range `r_cpa`, pose at CPA `Θ_cpa = (α_cpa, β_cpa)` | At CPA (also usable in real time along track) |
| **Protocol compliance** | `R` | Applicable COLREGS rule(s) 13–17 + give-way (16) / stand-on (17) sub-metrics | After encounter closes |

**Encounter lifecycle** (paper §3, Algorithm 2):

1. **Open** — contact detected at `r ≤ R_detect` (risk of collision assumed once in scope).
2. **Active** — track geometry, maneuvers (`Δθ`, `Δv`), pose evolution.
3. **Close** — CPA passed, range opening, contact leaves horizon, or collision.

**Rule assignment** (Algorithm 3) uses initial pose `Θ_0 = (α_0, β_0)` with configurable critical angles:

| Rule | Role | Default entry (configurable) |
|------|------|------------------------------|
| R13/17 | Overtaken (stand-on) | `β_0 ∈ (112.5°, 247.5°)` and `\|α_0\| < α_13_crit` (default 45°) |
| R13/16 | Overtaking (give-way) | Contact astern geometry + closing + higher SOG |
| R14 | Head-on | `\|β_0\| < α_14_crit` and `\|α_0\| < α_14_crit` (default 13°) |
| R15/16 | Crossing give-way | Starboard contact, aspect limits |
| R15/17 | Crossing stand-on | Port-side geometry |
| R_cpa | No dedicated rule yet | Detectable but no rule match — keep tracking |

---

## 2. Current state vs target

| Area | Today | Gap |
|------|-------|-----|
| **Training reward** | Dense CPA + goal + collision in `train.py` | Not rule-aware; no `S`/`R` decomposition; no delayed-action / apparent-maneuver penalties |
| **Eval metrics** | `avoid_score = success × (1 − collision_rate)` | No safety score, no per-rule compliance, no pose-at-CPA |
| **Traces** | `snapshot_step()` — own + contacts per tick | Missing `α`, `β`, `r_cpa`, `t_cpa`, maneuver deltas, rule labels |
| **Scenarios** | `traffic/*` categories (`head_on`, `crossing_*`, `overtaking`, …) | Categories exist but are not wired to rule evaluators |
| **SCOPE.md** | Specifies C++ evaluator on encounter close | Python MVP should mirror paper first; C++ port later |

**Principle (SCOPE.md + paper):**

- **Training:** keep dense geometry shaping (`w_safe · g(...)`) so PPO learns early; optionally add a small fraction of encounter-closed `R` once tracker is stable.
- **Eval / certification:** paper-faithful `S` and `R` from post-mission track replay (authoritative).

---

## 3. Architecture

```
prepare.py          geometry: CPA, bearing, contact velocity  (exists)
       ↓
colregs/
  geometry.py       α, β, pose vectors, maneuver extraction (Δθ, Δv, t_maneuver)
  config.py         R_pref, R_min, R_nm, R_col, R_detect, α_crit, penalty defaults
  safety.py         S_r piecewise linear; S_Θ (Eq 5–6); combine modes (Eq 7–11)
  entry.py          Algorithm 3 — assign rule set R per contact
  rules/
    give_way.py     Algorithm 4–8  (R16)
    stand_on.py     Algorithm 9–11 (R17)
    head_on.py      Algorithm 14     (R14 + Eq 12–13 pose)
    crossing.py     Algorithm 15     (R15 pass-ahead)
    overtaking.py   Algorithm 12–13  (R13)
  encounter.py      EncounterTracker — open/active/close, per-contact state
  evaluate.py       analyzeSafety(), evaluateEncounter(), episode rollup
       ↓
train.py            optional: info["colregs_preview"], sparse r_enc on close
run_eval()          colregs_mean_S, colregs_mean_R, per-rule breakdown
serve.py / viz      encounter markers (blue=low R, green/yellow/red range rings)
```

**Single config file:** `colregs/default_config.json` (mirrors paper §6.2 tunables). Eval and post-mission tools load the same library with different verbosity.

---

## 4. Geometry primitives (new in `colregs/geometry.py`)

Reuse `prepare.compute_cpa_tcpa`, `bearing_range`, `own_velocity`, `contact_velocity`.

Add paper conventions:

```python
@dataclass
class Pose:
    alpha_deg: float   # contact angle [-180, 180) — angle on bow from contact’s view
    beta_deg: float    # relative bearing [0, 360) — contact bearing from own bow

def pose_at(own, contact) -> Pose: ...
def pose_at_cpa(own_track, contact_track) -> Tuple[Pose, float, float]:  # Θ_cpa, r_cpa, t_cpa
def heading_change_deg(heading_at_detect, heading_now) -> float: ...
def speed_change_frac(v0, v_min, v_max) -> Tuple[float, float]: ...
def detect_maneuver_time(steps, threshold_heading_deg=2.0) -> Optional[int]: ...
```

**Sign conventions** must match paper Figure 2 (unit tests against Fig 4–5 canonical geometries).

---

## 5. Safety scoring (`colregs/safety.py`)

### 5.1 Range thresholds (Table 2)

| Parameter | Default (tunable) | Maps to today |
|-----------|-------------------|---------------|
| `R_pref` | 200 m | preferred CPA |
| `R_min` | 80 m | ≈ `CPA_SAFE_RANGE_M` legacy |
| `R_nm` | 40 m | near-miss |
| `R_col` | own_r + contact_r | size-aware collision |

Own-ship radius: `OWN_RADIUS_M`; contact: `radius_m`.

### 5.2 Range score `S_r` (Eq 3, Fig 6)

Piecewise linear mapping:

```
r ≥ R_pref  →  S_r = 100%
R_min ≤ r < R_pref  →  linear between S_Rmin and 100%
R_nm ≤ r < R_min    →  linear between S_Rnm and S_Rmin
R_col ≤ r < R_nm    →  linear between 0% and S_Rnm
r < R_col           →  S_r = 0%
```

Configurable anchor scores: `S_Rpref=100`, `S_Rmin=80`, `S_Rnm=20`, `S_Rcol=0` (paper defaults).

### 5.3 Pose score `S_Θ` (Eq 4–6, Fig 7)

```python
S_alpha = (1 - cos(α_cpa)) / (1 - cos(α_c))   if |α| < α_c else 1.0
S_beta  = (1 - cos(β_cpa)) / (1 - cos(β_c))   if |β| < β_c else 1.0  # use β mapped to [-180,180] for formula
S_theta = S_max_theta * S_alpha * S_beta
```

Defaults: `α_c = β_c = 80°`, `S_max_theta = 1.0`.

### 5.4 Combination modes (Table 3)

Implement all; default for eval = **multiplicative** (Eq 8: `S = S_r · S_Θ`) — requires good performance in both range and pose.

| Mode | Equation | Use |
|------|----------|-----|
| `range_only` | `S = S_r` | Baseline / debug |
| `pose_only` | `S = S_Θ` | Pose QA |
| `weighted_sum` | `S = s_r S_r + s_Θ S_Θ` | Lenient |
| `multiplicative` | `S = S_r · S_Θ` | **Default eval** |
| `reward_pose` | `S = min(S_r · (1 + S_Θ), 100%)` | Stern-pass bonus |
| `effective_range` | `S = S_r(r + S_Θ · r_Θ)` | Fig 6 with pose-inflated range |

---

## 6. Protocol compliance scoring (`colregs/rules/`)

Each rule evaluator returns `R ∈ [0, 100]` starting at `R_max = 100`, applying **multiplicative penalties** (paper style: `R_rule ← R_rule · (1 − penalty)` or subtract for stand-on course change).

### 6.1 Shared give-way base — Rule 16 (Algorithm 4–8)

For any give-way assignment (R13/16, R14, R15/16):

| Check | Algorithm | Default penalty cap |
|-------|-----------|---------------------|
| Keep well clear | `AnalyzeSafety()` → fold into `S` or cap `R` by `S` | — |
| Delayed action | Alg 5: `(r_detect − r_maneuver) / r_detect` | 50% |
| Non-apparent course change | Alg 7: `\|Δθ\| < Δθ_app` (30°) | 50% |
| Non-apparent speed change | Alg 8: `Δv < Δv_app` (50% of v0) | 50% |
| Hindrance of stand-on | range/pose at CPA vs stand-on track | TBD phase 2 |

**Maneuver detection:** first step where `|Δθ| > Δθ_md` (2°) or `|Δv| > Δv_md` (0.2 m/s) before `t_cpa`.

### 6.2 Stand-on base — Rule 17 (Algorithm 9–11)

For R13/17, R15/17:

| Check | Penalty |
|-------|---------|
| Course change before CPA | Linear 2°–30°, then max 50% (Fig 9) |
| Speed change before CPA | Slowing + speeding penalties (Alg 11) |
| In extremis | **Compensate** penalties when `r_cpa < r_extremis` (config) |
| R17.c port turn | Penalize port alteration for port-side crossing stand-on |

### 6.3 Rule-specific amplifiers

| Rule | Own role | Extra checks beyond R16/R17 base |
|------|----------|----------------------------------|
| **R14 Head-on** | Both give-way | Starboard turn required; **port-to-port pose** at CPA via Eq 13 `(sin(α)−½)²(sin(β)−½)²`; mode must not flip |
| **R15 Crossing GW** | Give-way | **Pass astern** — penalize bow-crossing (`α_cpa` in forbidden band, default −80° to 165° on stand-on contact angle) |
| **R15 Crossing SO** | Stand-on | R17 base only |
| **R13 Overtaking** | Give-way | Penalize crossing ahead of overtaken track at close range; must not re-classify to crossing mid-encounter |
| **R13 Overtaken** | Stand-on | R17 base; failure to hold course until past and clear |

**Protocol pose library** (§6.1 Eq 14–17): generic functions on angle `φ` (α or β):

- `sin²(φ + φ₀)`
- `step(φ) − step(φ₀)`
- `(sin(φ+φ₀) − ½)²`  ← head-on default
- `(sin(φ+φ₀) − ½)⁴`  ← stricter variant

Rule evaluators compose these for rule-specific pose compliance (e.g. R14 port-to-port).

### 6.4 Entry criteria implementation

Port **Algorithm 3** to `colregs/entry.py`. Inputs: `Θ_0`, closing range, SOG comparison for overtaking. Output:

```python
@dataclass
class RuleAssignment:
    rule_id: str          # "R14", "R15/16", "R13/17", "R_cpa", ...
    own_role: str         # "give_way" | "stand_on" | "both_give_way" | "none"
    expected_contact_role: str
```

Cross-check against `scenario.category` (e.g. `traffic/..._t_head_on`) in tests — entry from geometry is authoritative; category is a label for regression.

---

## 7. Encounter tracker (`colregs/encounter.py`)

```python
class EncounterTracker:
    def on_step(self, t, own, contacts, water_current) -> None: ...
    def closed_encounters(self) -> List[EncounterResult]: ...

@dataclass
class EncounterResult:
    contact_id: int
    rule: RuleAssignment
    r_cpa: float
    tcpa: float
    pose_0: Pose
    pose_cpa: Pose
    safety_S: float
    protocol_R: float
    breakdown: Dict[str, float]   # delayed_action, non_apparent_turn, ...
    t_open: int
    t_close: int
    collision: bool
```

**Close conditions:**

- Range increasing after CPA (`dr/dt > 0` for N steps) and `r > R_detect`, or
- Contact left obs mask / max range, or
- Collision (`r < R_col`).

**Multi-contact:** one `EncounterTracker` per contact index; priority / simultaneous rules deferred to phase 3 (paper Fig 15).

---

## 8. Integration with training (`train.py`)

### Phase A — eval-only (no training change)

1. After `rollout_episode`, run `evaluate_trace(steps)` → attach `colregs` block to episode dict.
2. Extend `run_eval` metrics:

```json
{
  "colregs_mean_safety": 0.82,
  "colregs_mean_protocol": 0.71,
  "colregs_by_rule": { "R14": 0.65, "R15/16": 0.78, "R13/16": 0.80 },
  "colregs_violations_below_threshold": 3,
  "avoid_score_v2": "success * mean(R) * mean(S) / 10000"  
}
```

Keep legacy `avoid_score` for backward compatibility.

### Phase B — dense preview in `info`

Each step (when contacts present):

```python
info["colregs_preview"] = {
    "S_rt": realtime_safety(r, pose),  # Eq 2
    "threat": threat_level,
}
```

Optional UI ring colors in exercise/replay.

### Phase C — sparse training reward (SCOPE.md)

On encounter close:

```python
r_enc = w_col * (protocol_R / 100.0)   # authoritative
# Credit assignment: last N steps where contact in mask, or eligibility trace
```

Tune `w_col` ≪ dense CPA terms initially so learning remains stable.

### Phase D — align dense shaping with paper `S`

Replace ad-hoc `W_CPA` block with **`S_rt` gradient** (differentiable approximation of piecewise `S_r`) plus keep goal/escape terms. Map paper thresholds to existing `cpa_safe_distance()`:

```
R_min ≈ cpa_safe_distance(...)
R_pref ≈ 2 × R_min  (config)
```

---

## 9. Integration with viz / serve

| Surface | Addition |
|---------|----------|
| **Eval traces JSON** | Per-encounter `EncounterResult` list + step-level `S_rt` optional |
| **Scenarios replay** | Blue ring when `R < R_threshold`; green/yellow/red for `r_cpa` bands (Fig 17) |
| **Train UI** | Show `colregs_mean_safety` / `colregs_mean_protocol` in live metrics |
| **Exercise sidebar** | Running encounter scores for spawned intruders |
| **Post-mission CSV** | Export per paper §6.4 |

---

## 10. Phased delivery

| Phase | Deliverable | Effort | Depends on |
|-------|-------------|--------|------------|
| **P0** | `colregs/geometry.py` + unit tests (Figs 2, 4, 5, 11) | 1–2 d | — |
| **P1** | `safety.py` + config; `analyzeSafety()` on synthetic CPA points | 1 d | P0 |
| **P2** | `entry.py` Algorithm 3; rule labels on scenarios | 1 d | P0 |
| **P3** | R16/R17 base evaluators + delayed/apparent maneuvers | 2 d | P0, traces |
| **P4** | R14, R15/16, R13 rule-specific pose penalties | 2 d | P3 |
| **P5** | `EncounterTracker` + `evaluate_trace(steps)` | 2 d | P1–P4 |
| **P6** | Wire into `run_eval`, metrics.json, tests on eval set | 1 d | P5 |
| **P7** | Training bridge (info preview + optional `r_enc`) | 1–2 d | P5 |
| **P8** | Viz rings + exercise HUD | 2 d | P6 |
| **P9** | C++ contract stub matching `EncounterResult` JSON (SCOPE.md) | future | P6 |

**MVP certification slice:** P0–P6 with rules **R14, R15/16, R15/17, R13/16, R13/17** only (matches scenario template library).

---

## 11. Test strategy

| Test | Source |
|------|--------|
| `test_pose_conventions` | Fig 2a/b α, β swap |
| `test_safety_piecewise` | Fig 6 anchor points at R_pref, R_min, R_nm, R_col |
| `test_pose_safety_bow_vs_stern` | Fig 5 — same r_cpa, different S_Θ |
| `test_entry_head_on` | Algorithm 3 + Fig 8b |
| `test_entry_crossing` | Fig 8c |
| `test_r14_port_to_port` | Fig 11a high score, 11b lower |
| `test_r15_stern_cross` | Fig 14d α_cpa ≈ −165° passes; bow-cross fails |
| `test_delayed_action` | Alg 5 — late maneuver vs early |
| `test_stand_on_course_penalty` | Fig 9 linear region |
| `test_eval_trace_end_to_end` | Replay one `eval_traces.json` episode |

Golden JSON fixtures: `tests/fixtures/colregs/` with minimal 20–50 step tracks.

---

## 12. Configuration schema (draft)

```json
{
  "R_detect_m": 900,
  "R_pref_m": 200,
  "R_min_m": 80,
  "R_nm_m": 40,
  "alpha_13_crit_deg": 45,
  "alpha_14_crit_deg": 13,
  "alpha_15_crit_deg": 10,
  "alpha_c_deg": 80,
  "beta_c_deg": 80,
  "delta_theta_apparent_deg": 30,
  "delta_theta_min_detect_deg": 2,
  "delta_v_apparent_frac": 0.5,
  "delta_v_min_detect_mps": 0.2,
  "R_delay_max": 0.5,
  "R_max": 100,
  "R_threshold_report": 70,
  "S_threshold_report": 70,
  "safety_combine_mode": "multiplicative",
  "S_Rmin": 80,
  "S_Rnm": 20,
  "S_Rcol": 0,
  "r_extremis_m": 50,
  "r15_forbidden_alpha_min_deg": -80,
  "r15_forbidden_alpha_max_deg": 165
}
```

---

## 13. Mapping paper → existing code

| Paper concept | Existing | Action |
|---------------|----------|--------|
| CPA geometry | `prepare.compute_cpa_tcpa` | Keep |
| Size-aware collision | `cpa_safe_distance`, `check_collision` | Map to `R_col` |
| Scenario types | `scenario_templates.py` | Tag expected rule in manifest |
| Dense CPA reward | `contact_threat_and_cpa_penalty` in `train.py` | Phase D: derive from `S_r` |
| Eval score | `avoid_score` | Superset via `colregs_*` metrics |
| Encounter close reward | SCOPE.md `r_enc` | Phase C |
| Trace replay | `snapshot_step` | Feed `EncounterTracker` |

---

## 14. Open decisions

1. **Head-on both-vessel eval** — sim only controls ownship; score ownship R14 compliance only, or also score contact script as “surrogate other guy”?
2. **Goal + COLREGS** — mission success and protocol score reported separately (recommended); combined `avoid_score_v2` is product for ranking only.
3. **Stand-on in extremis** — default `r_extremis_m` and whether leaving waypoint for traffic triggers compensation (aligns with recent escape reward tuning).
4. **COG vs heading** — paper warns Rule 14 should use compass heading; we use `heading_rad` (no current/wind split). Document error budget or add COG in phase 2.
5. **C++ evaluator** — Python library is reference implementation; export `EncounterResult` schema for future `bnrl_colregs_score_t` in SCOPE.md.

---

## 15. Success criteria

- Eval run reports **mean safety S** and **mean protocol R** per rule category matching manual assessment on 5 canonical scenarios (head-on, crossing GW/SO, overtaking, overtaken).
- Post-mission replay of `eval_traces.json` reproduces scores without re-running sim.
- Training can optionally log `r_enc` without regression on `success_rate` / `collision_rate`.
- Config tweaks (`R_min`, `α_14_crit`) change scores monotonically as in paper §6.2.

---

## 16. Immediate next step

Implement **P0 + P1 + P5 skeleton**: geometry, piecewise `S_r`, and `evaluate_trace()` called from `run_eval` with metrics logged but no training reward change. Validates the pipeline before investing in full Rule 16–17 maneuver parsing.
