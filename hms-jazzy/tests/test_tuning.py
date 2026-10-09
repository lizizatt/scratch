import numpy as np
import pytest
from fastapi.testclient import TestClient

from hms_jazzy.config import SimulationConfig
from hms_jazzy.navigation import ThrusterCommand
from hms_jazzy.physics import Simulator
from hms_jazzy.server import MESSAGE_ADAPTER, HelmSession, create_app


@pytest.mark.parametrize("height,period", [(0, 0.1), (0.6, 1.5), (3, 12), (20, 0.5)])
def test_wave_settings_have_no_arbitrary_range_or_steepness_limits(height, period):
    config = SimulationConfig(wave_height_m=height, wave_period_s=period)
    sim = Simulator(config)
    session = HelmSession(SimulationConfig(), now=0)
    session.receive(MESSAGE_ADAPTER.validate_python({
        "type": "waves", "height_m": height, "period_s": period, "direction_deg": 120,
    }), now=0)
    applied = session.snapshot()["water"]
    assert applied["height_m"] == height and applied["period_s"] == period
    assert applied["components"][0]["amplitude_m"] == height / 2
    elevation, velocity = sim.water.sample(np.array([[0., 0., 0.], [2., 3., -0.5]]), 0.3)
    assert np.all(np.isfinite(elevation)) and np.all(np.isfinite(velocity))


@pytest.mark.parametrize("field,value", [
    ("height_m", -1), ("height_m", float("nan")), ("height_m", float("inf")),
    ("period_s", 0), ("period_s", -1), ("period_s", float("nan")),
    ("period_s", float("inf")),
])
def test_waves_still_reject_invalid_values(field, value):
    values = {"height_m": 0.3, "period_s": 2.4, "direction_deg": 0, field: value}
    with pytest.raises(ValueError):
        MESSAGE_ADAPTER.validate_python({"type": "waves", **values})
    sim = Simulator()
    original = sim.water.snapshot()
    with pytest.raises(ValueError):
        sim.set_waves(**values)
    assert sim.water.snapshot() == original


def test_unrepresentable_wave_coefficients_leave_previous_water_intact():
    sim = Simulator()
    original = sim.water.snapshot()
    with pytest.raises(ValueError, match="floating-point"):
        sim.set_waves(0.3, 1e-300, 0)
    assert sim.water.snapshot() == original


@pytest.mark.parametrize("heading", [0, 90, 180, 270])
@pytest.mark.parametrize("strength", [4.4482216152605, 444.82216152605])
def test_motor_strength_changes_actual_force_and_torque(heading, strength):
    config = SimulationConfig(wave_height_m=0, initial_heading_deg=heading,
                              motor_time_constant_s=0)
    sim = Simulator(config)
    sim.set_motor_strength(strength)
    rotation = sim.data.body("board").xmat.reshape(3, 3).copy()
    sim.step(ThrusterCommand(1, 0))
    np.testing.assert_allclose(sim.data.qvel[:3],
                               rotation @ [strength / config.mass_kg * config.timestep_s, 0, 0],
                               atol=1e-12)
    np.testing.assert_allclose(sim.data.qvel[3:], [
        0, config.thruster_z_m * strength / config.pitch_inertia_kg_m2 * config.timestep_s,
        -config.thruster_arm_m * strength / config.yaw_inertia_kg_m2 * config.timestep_s,
    ], atol=1e-12)


def test_strength_change_preserves_session_state_except_commands():
    session = HelmSession(SimulationConfig(wave_height_m=0), now=0)
    session.receive(MESSAGE_ADAPTER.validate_python({
        "type": "waypoint", "east_m": 20, "north_m": 20,
    }), now=0)
    session.advance(20, now=0.2)
    session.sim.set_waves(1.2, 12, 45)
    session.sim.set_current(0.2, -0.3)
    session.paused = True
    original_pose, original_velocity = session.sim.data.qpos.copy(), session.sim.data.qvel.copy()
    original_sample = session.sim.navigation
    session.receive(MESSAGE_ADAPTER.validate_python({
        "type": "motor_strength", "max_thrust_n": 100,
    }), now=0.3)
    state = session.snapshot()
    assert state["config"]["max_thrust_n"] == 100
    assert state["water"]["height_m"] == 1.2
    assert state["current"] == {"east_mps": 0.2, "north_mps": -0.3}
    assert state["time_s"] == 0.2 and state["revision"] == 0 and state["paused"]
    np.testing.assert_array_equal(session.sim.data.qpos, original_pose)
    np.testing.assert_array_equal(session.sim.data.qvel, original_velocity)
    assert session.sim.navigation is original_sample
    assert state["mode"] == "manual" and state["waypoint"] is None
    assert state["command"] == state["thrust_n"] == {"port": 0, "starboard": 0}
    np.testing.assert_array_equal(session.sim._motor_lag, 0)
    session.receive(MESSAGE_ADAPTER.validate_python({"type": "reset"}), now=0.4)
    session.receive(MESSAGE_ADAPTER.validate_python({
        "type": "mounts", "longitudinal_m": 0.5, "half_spacing_m": 0.8,
    }), now=0.5)
    assert session.sim.config.max_thrust_n == 100
    np.testing.assert_array_equal(session.sim.model.actuator_gear[:, 0], [100, 100])
    assert HelmSession(SimulationConfig(), now=0).sim.config.max_thrust_n != 100


@pytest.mark.parametrize("value", [0, -1, float("nan"), float("inf")])
def test_invalid_motor_strength_does_not_change_model_or_commands(value):
    sim = Simulator()
    sim.step(ThrusterCommand(0.5, 0.2), steps=10)
    original_config, original_command = sim.config, sim.command
    original_ctrl = sim.data.ctrl.copy()
    original_gears = sim.model.actuator_gear.copy()
    with pytest.raises(ValueError):
        sim.set_motor_strength(value)
    assert sim.config == original_config and sim.command == original_command
    np.testing.assert_array_equal(sim.data.ctrl, original_ctrl)
    np.testing.assert_array_equal(sim.model.actuator_gear, original_gears)
    with pytest.raises(ValueError):
        MESSAGE_ADAPTER.validate_python({"type": "motor_strength", "max_thrust_n": value})


def test_websocket_unrestricted_waves_and_motor_strength():
    with TestClient(create_app()) as client, client.websocket_connect("/ws") as socket:
        socket.receive_json()
        socket.send_json({"type": "pause", "paused": True})
        for _ in range(30):
            if socket.receive_json()["paused"]:
                break
        socket.send_json({"type": "waves", "height_m": 3, "period_s": 0.5,
                          "direction_deg": 0})
        socket.send_json({"type": "motor_strength", "max_thrust_n": 88.96443230521})
        for _ in range(30):
            state = socket.receive_json()
            assert state["type"] == "state", state
            if state["config"]["max_thrust_n"] == 88.96443230521:
                break
        else:
            pytest.fail("strength update not received")
        assert state["water"]["height_m"] == 3 and state["water"]["period_s"] == 0.5
        assert state["paused"] and state["revision"] == 0
        assert state["mode"] == "manual" and state["command"] == {"port": 0, "starboard": 0}
