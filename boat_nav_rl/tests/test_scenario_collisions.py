"""Scenario library must include a substantial collision-prone traffic set."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
from scenario_risk import (
    audit_kinematic_risk,
    audit_naive_collisions,
    is_kinematically_risky,
    rollout_collides,
    seeds_for_category,
)
from scenarios import generate_all_scenarios, split_train_eval
from train import BoatNavEnv, filter_seeds_for_mode


class TestScenarioCollisionCoverage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.all_avoid = filter_seeds_for_mode(generate_all_scenarios(), "avoid")
        _, eval_seeds = split_train_eval(generate_all_scenarios())
        cls.eval_avoid = filter_seeds_for_mode(eval_seeds, "avoid")
        cls.env = BoatNavEnv(
            mode="avoid",
            training_randomize=False,
            dynamics_jitter=False,
            current_enabled=False,
            contact_obs_noise_m=0.0,
            contact_obs_noise_bearing_rad=0.0,
        )

    def test_traffic_library_has_high_conflict_category(self):
        cats = {s.category for s in self.all_avoid}
        self.assertIn("traffic/high_conflict", cats)
        self.assertGreaterEqual(len(seeds_for_category(self.all_avoid, "high_conflict")), 32)

    def test_kinematic_risk_fraction(self):
        stats = audit_kinematic_risk(self.all_avoid)
        self.assertGreaterEqual(
            stats["risk_rate"],
            0.22,
            msg=f"only {stats['risky']}/{stats['n']} scenarios CPA<safe under hold course",
        )

    def test_head_on_always_collide_under_naive_navigate(self):
        head_on = seeds_for_category(self.all_avoid, "head_on")
        self.assertGreaterEqual(len(head_on), 20)
        for seed in head_on:
            self.assertTrue(
                rollout_collides(seed, env=self.env),
                msg=f"head-on scenario did not collide: {seed.name}",
            )

    def test_high_conflict_majority_collide_under_naive_navigate(self):
        hc = seeds_for_category(self.all_avoid, "high_conflict")
        self.assertGreaterEqual(len(hc), 32)
        hits = sum(rollout_collides(s, env=self.env) for s in hc)
        rate = hits / len(hc)
        self.assertGreaterEqual(
            rate,
            0.35,
            msg=f"high_conflict naive collision rate {rate:.1%} ({hits}/{len(hc)})",
        )

    def test_eval_holdout_includes_many_kinematic_risks(self):
        risky = sum(1 for s in self.eval_avoid if is_kinematically_risky(s))
        self.assertGreaterEqual(
            risky,
            40,
            msg=f"eval holdout has only {risky} kinematically risky scenarios",
        )

    def test_naive_collision_count_on_eval_sample(self):
        # Every 4th eval scenario keeps runtime reasonable while checking sim collisions.
        sample = self.eval_avoid[::4]
        self.assertGreaterEqual(len(sample), 50)
        stats = audit_naive_collisions(sample, env=self.env)
        self.assertGreaterEqual(
            stats["collisions"],
            8,
            msg=(
                f"eval sample naive collisions {stats['collisions']}/{stats['n']} "
                f"({stats['collision_rate']:.1%})"
            ),
        )

    def test_multiple_categories_contribute_kinematic_risk(self):
        stats = audit_kinematic_risk(self.all_avoid)
        risky_cats = [
            cat
            for cat, row in stats["by_category"].items()
            if row["n"] and row["risky"] / row["n"] >= 0.10
        ]
        self.assertIn("traffic/head_on", risky_cats)
        self.assertIn("traffic/high_conflict", risky_cats)
        self.assertGreaterEqual(len(risky_cats), 5)


if __name__ == "__main__":
    unittest.main()
