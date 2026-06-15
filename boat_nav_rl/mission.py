"""Shared navigation mission controller — waypoint legs for train and exercise."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, List, Optional

import numpy as np

import prepare as P
from prepare import ScenarioSeed

GOAL_DUPLICATE_EPS_M = 5.0
GoalRangeFn = Callable[[float, float, float, float], float]
DEFAULT_GOAL_RANGE_FN: GoalRangeFn = P.goal_range_xy


@dataclass(frozen=True)
class WaypointEvent:
    goal_x_m: float
    goal_y_m: float
    trigger: str = "start"
    delay_sec_min: Optional[float] = None
    delay_sec_max: Optional[float] = None
    progress_frac_min: Optional[float] = None
    progress_frac_max: Optional[float] = None


@dataclass
class MissionTransition:
    goal_x: float
    goal_y: float
    leg_start_x: float
    leg_start_y: float
    goal_hold_steps: int = 0
    initial_goal_range: float = 0.0
    prev_goal_range: float = 0.0
    goal_changed: bool = True
    leg_index: int = 0


@dataclass
class _PendingTrigger:
    goal_x: float
    goal_y: float
    kind: str
    fire_at_step: Optional[int] = None
    progress_threshold: Optional[float] = None


def scenario_waypoint_events(scenario: ScenarioSeed) -> List[WaypointEvent]:
    """Normalize legacy relocate fields and explicit waypoint_events."""
    raw = getattr(scenario, "waypoint_events", None) or []
    if raw:
        out: List[WaypointEvent] = []
        for item in raw:
            if isinstance(item, WaypointEvent):
                out.append(item)
            else:
                out.append(WaypointEvent(**item))
        return out

    events = [
        WaypointEvent(scenario.goal_x_m, scenario.goal_y_m, "start"),
    ]
    rx = scenario.goal_relocate_x_m
    ry = scenario.goal_relocate_y_m
    if rx is not None and ry is not None:
        events.append(
            WaypointEvent(
                float(rx),
                float(ry),
                "delay_sec",
                delay_sec_min=scenario.goal_relocate_delay_sec_min,
                delay_sec_max=scenario.goal_relocate_delay_sec_max,
            )
        )
    return events


def mission_leg_count(scenario: ScenarioSeed) -> int:
    return len(scenario_waypoint_events(scenario))


class NavigationMission:
    """Schedules waypoint changes; Exercise uses set_goal for external updates."""

    def __init__(
        self,
        events: List[WaypointEvent],
        rng: np.random.Generator,
        *,
        dt_s: float = 1.0,
    ) -> None:
        if not events:
            raise ValueError("NavigationMission requires at least one WaypointEvent")
        self.events = list(events)
        self.rng = rng
        self.dt_s = dt_s
        self.leg_index = 0
        self.pending: List[_PendingTrigger] = []
        self._build_pending()

    @classmethod
    def from_scenario(
        cls,
        scenario: ScenarioSeed,
        rng: np.random.Generator,
        *,
        dt_s: float = 1.0,
    ) -> NavigationMission:
        return cls(scenario_waypoint_events(scenario), rng, dt_s=dt_s)

    @classmethod
    def single_goal(
        cls,
        goal_x: float,
        goal_y: float,
        rng: np.random.Generator,
        *,
        dt_s: float = 1.0,
    ) -> NavigationMission:
        return cls([WaypointEvent(goal_x, goal_y, "start")], rng, dt_s=dt_s)

    def _build_pending(self) -> None:
        self.pending.clear()
        for ev in self.events[1:]:
            trig = _PendingTrigger(float(ev.goal_x_m), float(ev.goal_y_m), ev.trigger)
            if ev.trigger == "delay_sec":
                lo = ev.delay_sec_min if ev.delay_sec_min is not None else 5.0
                hi = ev.delay_sec_max if ev.delay_sec_max is not None else lo
                if hi < lo:
                    lo, hi = hi, lo
                delay_sec = float(self.rng.uniform(lo, hi))
                trig.fire_at_step = max(1, int(round(delay_sec / self.dt_s)))
            elif ev.trigger == "progress_frac":
                lo = ev.progress_frac_min if ev.progress_frac_min is not None else 0.4
                hi = ev.progress_frac_max if ev.progress_frac_max is not None else 0.7
                if hi < lo:
                    lo, hi = hi, lo
                trig.progress_threshold = float(self.rng.uniform(lo, hi))
            self.pending.append(trig)

    def initial_goal(self) -> tuple[float, float]:
        ev = self.events[0]
        return float(ev.goal_x_m), float(ev.goal_y_m)

    def is_on_final_leg(self) -> bool:
        return len(self.pending) == 0

    def _same_goal(self, x: float, y: float, gx: float, gy: float) -> bool:
        return math.hypot(x - gx, y - gy) < GOAL_DUPLICATE_EPS_M

    def _make_transition(
        self,
        own_x: float,
        own_y: float,
        goal_x: float,
        goal_y: float,
        goal_range_fn: Callable[[float, float, float, float], float],
        *,
        leg_index: int,
    ) -> MissionTransition:
        gr = goal_range_fn(own_x, own_y, goal_x, goal_y)
        return MissionTransition(
            goal_x=goal_x,
            goal_y=goal_y,
            leg_start_x=own_x,
            leg_start_y=own_y,
            goal_hold_steps=0,
            initial_goal_range=gr,
            prev_goal_range=gr,
            goal_changed=True,
            leg_index=leg_index,
        )

    def _pop_and_advance(self, own_x: float, own_y: float, goal_range_fn) -> MissionTransition:
        trig = self.pending.pop(0)
        self.leg_index += 1
        return self._make_transition(
            own_x,
            own_y,
            trig.goal_x,
            trig.goal_y,
            goal_range_fn,
            leg_index=self.leg_index,
        )

    def set_goal(
        self,
        own_x: float,
        own_y: float,
        goal_x: float,
        goal_y: float,
        current_goal_x: float,
        current_goal_y: float,
        goal_range_fn: Callable[[float, float, float, float], float],
    ) -> Optional[MissionTransition]:
        """Exercise click-to-set; ignores duplicate clicks."""
        if self._same_goal(goal_x, goal_y, current_goal_x, current_goal_y):
            return None
        self.pending.clear()
        self.leg_index = max(self.leg_index, 0)
        return self._make_transition(
            own_x,
            own_y,
            goal_x,
            goal_y,
            goal_range_fn,
            leg_index=self.leg_index,
        )

    def check_scheduled(
        self,
        step_count: int,
        own_x: float,
        own_y: float,
        *,
        curr_goal_range: float,
        initial_goal_range: float,
        goal_range_fn: Callable[[float, float, float, float], float],
    ) -> Optional[MissionTransition]:
        """Time- and progress-based waypoint changes (before reward for this step)."""
        if not self.pending:
            return None

        head = self.pending[0]
        if head.kind == "delay_sec" and head.fire_at_step is not None:
            if step_count >= head.fire_at_step:
                return self._pop_and_advance(own_x, own_y, goal_range_fn)

        if head.kind == "progress_frac" and head.progress_threshold is not None:
            if initial_goal_range > 1.0:
                progress = 1.0 - curr_goal_range / initial_goal_range
                if progress >= head.progress_threshold:
                    return self._pop_and_advance(own_x, own_y, goal_range_fn)

        return None

    def check_hold_advance(
        self,
        own_x: float,
        own_y: float,
        *,
        in_goal_zone: bool,
        goal_hold_steps: int,
        goal_hold_steps_required: int,
        goal_range_fn: Callable[[float, float, float, float], float],
    ) -> Optional[MissionTransition]:
        """Advance to next leg after hold completes on the current waypoint."""
        if not self.pending:
            return None
        head = self.pending[0]
        if (
            head.kind == "hold_complete"
            and in_goal_zone
            and goal_hold_steps >= goal_hold_steps_required
        ):
            return self._pop_and_advance(own_x, own_y, goal_range_fn)
        return None

    def on_step(
        self,
        step_count: int,
        own_x: float,
        own_y: float,
        *,
        in_goal_zone: bool,
        goal_hold_steps: int,
        goal_hold_steps_required: int,
        curr_goal_range: float,
        initial_goal_range: float,
        goal_range_fn: Callable[[float, float, float, float], float],
    ) -> Optional[MissionTransition]:
        tr = self.check_scheduled(
            step_count,
            own_x,
            own_y,
            curr_goal_range=curr_goal_range,
            initial_goal_range=initial_goal_range,
            goal_range_fn=goal_range_fn,
        )
        if tr is not None:
            return tr
        return self.check_hold_advance(
            own_x,
            own_y,
            in_goal_zone=in_goal_zone,
            goal_hold_steps=goal_hold_steps,
            goal_hold_steps_required=goal_hold_steps_required,
            goal_range_fn=goal_range_fn,
        )

    def extra_max_steps(self, goal_hold_sec: int) -> int:
        """Budget for multi-leg travel between holds."""
        extra_legs = max(0, len(self.events) - 1)
        return extra_legs * (goal_hold_sec + 120)
