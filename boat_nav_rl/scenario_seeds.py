"""Train/eval scenario seed loading and mode filtering."""

from __future__ import annotations

from typing import Dict, List

import prepare as P
from curriculum import filter_seeds_by_prefix
import train_config as C

_EVAL_SEEDS_CACHE: Dict[tuple, List[P.ScenarioSeed]] = {}
_TRAIN_SEEDS_CACHE: Dict[tuple, List[P.ScenarioSeed]] = {}


def clear_seed_caches() -> None:
    _EVAL_SEEDS_CACHE.clear()
    _TRAIN_SEEDS_CACHE.clear()


def _seed_cache_key(mode: str) -> tuple:
    return (mode, tuple(C.SCENARIO_CATEGORY_PREFIXES))


def apply_scenario_prefix_filter(seeds: List[P.ScenarioSeed]) -> List[P.ScenarioSeed]:
    return filter_seeds_by_prefix(seeds, C.SCENARIO_CATEGORY_PREFIXES)


def filter_seeds_for_mode(seeds: List[P.ScenarioSeed], mode: str) -> List[P.ScenarioSeed]:
    if mode == "all":
        return list(seeds)
    if mode == "avoid":
        return [s for s in seeds if s.contacts]
    return [s for s in seeds if not s.contacts]


def train_seeds_for_mode(mode: str) -> List[P.ScenarioSeed]:
    key = _seed_cache_key(mode)
    if key in _TRAIN_SEEDS_CACHE:
        return _TRAIN_SEEDS_CACHE[key]
    seeds = filter_seeds_for_mode(P.load_train_seeds(), mode)
    seeds = apply_scenario_prefix_filter(seeds)
    if not seeds:
        raise RuntimeError(
            f"No train seeds for mode={mode} filter={C.SCENARIO_CATEGORY_PREFIXES}. Run prepare.py first."
        )
    _TRAIN_SEEDS_CACHE[key] = seeds
    return seeds


def eval_seeds_for_mode(mode: str) -> List[P.ScenarioSeed]:
    key = _seed_cache_key(mode)
    if key in _EVAL_SEEDS_CACHE:
        return _EVAL_SEEDS_CACHE[key]
    seeds = filter_seeds_for_mode(P.load_eval_seeds(), mode)
    seeds = apply_scenario_prefix_filter(seeds)
    if not seeds:
        raise RuntimeError(
            f"No eval seeds for mode={mode} filter={C.SCENARIO_CATEGORY_PREFIXES}. Run prepare.py first."
        )
    _EVAL_SEEDS_CACHE[key] = seeds
    return seeds
