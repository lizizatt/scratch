"""Audit: do policies see intruders in obs, and do they react?"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

import prepare as P
from exercise import init_session
from policy_infer import safe_model_predict
from train import BoatNavEnv, filter_seeds_for_mode

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "runs"


def main() -> None:
    train = P.load_train_seeds()
    avoid = filter_seeds_for_mode(train, "avoid")
    nav = filter_seeds_for_mode(train, "navigate")
    print("=== SCENARIO FILTER ===")
    print(f"train={len(train)} avoid={len(avoid)} navigate={len(nav)}")

    env = BoatNavEnv(mode="avoid", train_seeds=avoid[:50], training_randomize=True)
    n_with_mask = sum(
        1 for s in range(30) if env.reset(seed=s)[0][65:73].sum() > 0
    )
    print(f"avoid env: contact mask active in {n_with_mask}/30 resets")

    env_n = BoatNavEnv(mode="navigate", train_seeds=nav[:50], training_randomize=True)
    n_nav_mask = sum(
        1 for s in range(30) if env_n.reset(seed=s)[0][65:73].sum() > 0
    )
    print(f"navigate env: contact mask active in {n_nav_mask}/30 resets")

    print(f"\n=== OBS LAYOUT (contact slot 0) ===")
    print("indices 9-15: sin/cos brg, range, sin/cos cog, sog, radius")
    print("indices 65-72: contact presence masks")
    print(f"RANGE_SCALE_M={P.RANGE_SCALE_M} RADIUS_SCALE_M={P.RADIUS_SCALE_M}")

    runs = sorted(
        [
            p
            for p in RUNS.iterdir()
            if (p / "model.zip").exists() and p.name != "_training"
        ],
        key=lambda p: p.name,
        reverse=True,
    )

    def close_intruder_delta(run_id: str) -> float:
        s = init_session(run_id)
        base = s.vessels[0]._last_obs.copy()
        obs = base.copy()
        # 250 m dead ahead, moderate SOG
        obs[9:16] = [0.0, 1.0, 250.0 / P.RANGE_SCALE_M, 0.0, 1.0, 0.5, 0.43]
        obs[65] = 1.0
        a0, _ = safe_model_predict(s.model, base, deterministic=True)
        a1, _ = safe_model_predict(s.model, obs, deterministic=True)
        return float(np.linalg.norm(a1 - a0))

    print("\n=== POLICY SENSITIVITY (inject 250m intruder ahead) ===")
    for r in runs[:10]:
        m = json.loads((r / "metrics.json").read_text())
        try:
            d = close_intruder_delta(r.name)
            print(
                f"  {r.name} mode={m.get('mode', '?'):8s} "
                f"delta={d:.4f} avoid={m.get('avoid_score')} nav={m.get('nav_score')}"
            )
        except Exception as exc:
            print(f"  {r.name} error: {exc}")

    # Exercise spawn path
    avoid_runs = [
        r
        for r in runs
        if json.loads((r / "metrics.json").read_text()).get("mode") == "avoid"
    ]
    rid = avoid_runs[0].name if avoid_runs else runs[0].name
    s = init_session(rid)
    s.add_intruder(0, 300, 270, 4.0, "workboat")
    obs = s.vessels[0]._last_obs
    print(f"\n=== EXERCISE SPAWN ({rid}) ===")
    print(f"mask sum={obs[65:73].sum()} slot0 range_norm={obs[11]:.3f} sog={obs[14]:.3f} rad={obs[15]:.3f}")
    a_clear, _ = safe_model_predict(s.model, s.vessels[0]._last_obs, deterministic=True)
    s.clear_intruders()
    a0, _ = safe_model_predict(s.model, s.vessels[0]._last_obs, deterministic=True)
    print(f"spawn vs clear action delta={float(np.linalg.norm(a_clear - a0)):.4f}")


if __name__ == "__main__":
    main()
