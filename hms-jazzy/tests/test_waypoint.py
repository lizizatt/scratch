from dataclasses import replace

import pytest

from hms_jazzy.config import SimulationConfig
from hms_jazzy.controllers import GoToWaypoint, Waypoint
from hms_jazzy.navigation import ThrusterCommand
from hms_jazzy.physics import Simulator
from hms_jazzy.server import MESSAGE_ADAPTER, HelmSession


@pytest.mark.parametrize("east,north,heading", [
    (0, 20, 0), (20, 0, 0), (0, -20, 0), (-20, 0, 0), (20, 20, 270), (0, 0, 0),
])
def test_waypoint_arrives_using_noisy_navigation(east, north, heading):
    sim = Simulator(SimulationConfig(wave_height_m=0))
    sim.reset(heading)
    controller = GoToWaypoint(Waypoint(east, north))
    for _ in range(18000):
        command = controller.update(sim.navigation, sim.config.timestep_s)
        assert max(abs(command.port), abs(command.starboard)) <= 0.5
        if controller.arrived:
            break
        sim.step(command)
    assert controller.arrived, (sim.truth, sim.navigation)
    assert controller.target.distance(sim.navigation) <= controller.target.arrival_radius_m
    assert sim.navigation.speed_mps <= 0.1
    assert command == ThrusterCommand()
    far_away = replace(sim.navigation, east_m=1000, north_m=1000)
    assert controller.update(far_away, 0.01) == ThrusterCommand()


def test_waypoint_brakes_inside_radius_before_arrival():
    nav = replace(Simulator().navigation, speed_mps=1, course_deg=0, heading_deg=0)
    controller = GoToWaypoint(Waypoint(0, 0))
    command = controller.update(nav, 0.01)
    assert not controller.arrived
    assert command.port < 0 and command.starboard < 0


def test_waypoint_bearing_uses_sample_not_truth_and_slows_near_target():
    nav = replace(Simulator().navigation, east_m=0, north_m=0, heading_deg=0,
                  yaw_rate_deg_s=0, speed_mps=0, course_deg=None)
    right = GoToWaypoint(Waypoint(20, 0)).update(nav, 0.01)
    left = GoToWaypoint(Waypoint(-20, 0)).update(nav, 0.01)
    assert right.port > right.starboard
    assert left.port < left.starboard
    far = GoToWaypoint(Waypoint(0, 20)).update(nav, 0.01)
    near = GoToWaypoint(Waypoint(0, 2)).update(nav, 0.01)
    assert 0 < near.port < far.port


@pytest.mark.parametrize("changes", [
    {"east_m": float("nan")}, {"north_m": float("inf")}, {"east_m": 10001},
    {"max_throttle": 0}, {"max_throttle": -0.5}, {"max_throttle": 1.01},
    {"arrival_radius_m": 0.1}, {"arrival_radius_m": 21},
])
def test_waypoint_parameters_rejected_at_both_boundaries(changes):
    values = {"east_m": 0.0, "north_m": 20.0, **changes}
    with pytest.raises(ValueError):
        Waypoint(**values)
    with pytest.raises(ValueError):
        MESSAGE_ADAPTER.validate_python({"type": "waypoint", **values})


@pytest.mark.parametrize("override", [
    {"type": "control", "port": 0.2, "starboard": 0.2},
    {"type": "heading", "heading_deg": 90, "throttle": 0.4},
    {"type": "stop"}, {"type": "reset"},
])
def test_waypoint_override_clears_target(override):
    session = HelmSession(SimulationConfig(), now=0)
    session.receive(MESSAGE_ADAPTER.validate_python(
        {"type": "waypoint", "east_m": 20, "north_m": 0}
    ), now=0)
    session.advance(10, now=0.1)
    assert session.snapshot()["mode"] == "waypoint"
    assert session.snapshot()["waypoint"]["status"] == "navigating"
    session.receive(MESSAGE_ADAPTER.validate_python(override), now=0.2)
    assert session.snapshot()["waypoint"] is None
    assert session.snapshot()["mode"] != "waypoint"


def test_waypoint_arrival_cuts_lag_and_reset_clears_status():
    session = HelmSession(SimulationConfig(), now=0)
    session.receive(MESSAGE_ADAPTER.validate_python(
        {"type": "waypoint", "east_m": 0, "north_m": 0}
    ), now=0)
    session.sim.data.ctrl[:] = 0.5
    session.advance(1, now=0.1)
    state = session.snapshot()
    assert state["waypoint"]["status"] == "arrived"
    assert state["thrust_n"] == {"port": 0, "starboard": 0}
    assert state["command"] == {"port": 0, "starboard": 0}
    session.receive(MESSAGE_ADAPTER.validate_python({"type": "reset"}), now=0.2)
    assert session.snapshot()["waypoint"] is None


def test_waypoint_pause_watchdog_and_no_heartbeat_reengagement():
    session = HelmSession(SimulationConfig(), now=0)
    session.receive(MESSAGE_ADAPTER.validate_python(
        {"type": "waypoint", "east_m": 20, "north_m": 0}
    ), now=0)
    session.receive(MESSAGE_ADAPTER.validate_python({"type": "pause", "paused": True}), now=0)
    session.advance(10, now=0.5)
    assert session.sim.time_s == 0
    assert session.snapshot()["mode"] == "waypoint"
    session.advance(10, now=1.1)
    session.receive(MESSAGE_ADAPTER.validate_python({"type": "heartbeat"}), now=1.2)
    assert session.watchdog
    assert session.snapshot()["waypoint"] is None
    assert session.command == ThrusterCommand()


def test_ten_pound_force_motor_default():
    assert SimulationConfig().max_thrust_n == pytest.approx(10 * 4.4482216152605)
