import dataclasses
import math

import numpy as np
import pytest

from hms_jazzy.config import SimulationConfig, load_config
from hms_jazzy.controllers import HeadingHold
from hms_jazzy.navigation import ThrusterCommand, heading_error
from hms_jazzy.physics import Simulator


@pytest.fixture
def ideal_config():
    return SimulationConfig(
        gps_noise_m=0, heading_noise_deg=0, velocity_noise_mps=0, yaw_rate_noise_deg_s=0,
        motor_time_constant_s=0,
        wave_height_m=0,
    )


@pytest.mark.parametrize("heading,direction", [(0, (0, 1)), (90, (1, 0)),
                                               (180, (0, -1)), (270, (-1, 0))])
def test_cardinal_thrust_and_model_landmarks(ideal_config, heading, direction):
    sim = Simulator(ideal_config)
    sim.reset(heading)
    forward = np.array(direction)
    port = np.array([-direction[1], direction[0]])
    origin = sim.data.body("board").xpos[:2]
    bow = sim.data.geom("bow").xpos[:2] - origin
    arm = sim.data.site("port").xpos[:2] - sim.data.site("starboard").xpos[:2]
    np.testing.assert_allclose(bow, forward * ideal_config.length_m * 0.4, atol=1e-12)
    np.testing.assert_allclose(arm, port * 2 * ideal_config.thruster_arm_m, atol=1e-12)
    sim.step(ThrusterCommand(1, 1), 100)
    assert np.dot(sim.data.qpos[:2], forward) > 0.2
    assert np.dot(sim.data.qpos[:2], port) == pytest.approx(0, abs=1e-12)
    assert heading_error(heading, sim.truth.heading_deg) == pytest.approx(0, abs=1e-10)
    np.testing.assert_allclose(sim.data.body("board").xpos[:2], sim.data.qpos[:2])


def test_reverse_and_spin(ideal_config):
    sim = Simulator(ideal_config)
    sim.step(ThrusterCommand(-1, -1), 100)
    assert sim.truth.north_m < -0.2
    sim.reset()
    sim.step(ThrusterCommand(1, -1), 100)
    assert 0 < sim.truth.heading_deg < 90
    assert sim.navigation.yaw_rate_deg_s > 0
    # Aft housing drag couples yaw to a small lateral translation.
    assert 0 < sim.truth.speed_mps < 0.02
    clockwise_velocity = sim.data.qvel[:2].copy()
    sim.reset()
    sim.step(ThrusterCommand(-1, 1), 100)
    assert 270 < sim.truth.heading_deg < 360
    np.testing.assert_allclose(sim.data.qvel[:2], clockwise_velocity * [-1, 1], atol=1e-12)


def test_site_actuator_force_and_torque(ideal_config):
    sim = Simulator(ideal_config)
    sim.reset(90)
    sim.step(ThrusterCommand(1, 0))
    force = ideal_config.max_thrust_n
    np.testing.assert_allclose(sim.data.qvel, [
        force / 110 * 0.01, 0, 0, 0,
        force * ideal_config.thruster_z_m / ideal_config.pitch_inertia_kg_m2 * 0.01,
        -force * 0.5 / 95 * 0.01,
    ], atol=1e-12)


@pytest.mark.parametrize("heading", [0, 90, 180, 270])
def test_drag_is_water_relative_and_dissipative(ideal_config, heading):
    sim = Simulator(ideal_config)
    sim.reset(heading)
    sim.set_current(0.5, -0.3)
    sim.data.qvel[:] = [0.5, -0.3, 0, 0, 0, 0]
    np.testing.assert_allclose(sim.drag_force(), np.zeros(6), atol=1e-12)
    sim.data.qvel[:] = [1.3, -0.7, 0.1, 0.1, -0.2, 0.4]
    relative = sim.data.qvel - np.array([0.5, -0.3, 0, 0, 0, 0])
    assert np.dot(sim.drag_force(), relative) < 0


def test_current_advects_unpowered_board(ideal_config):
    sim = Simulator(ideal_config)
    sim.set_current(0.5, 0)
    sim.step(steps=1000)
    assert sim.truth.east_m > 2
    assert 0 < sim.data.qvel[0] < 0.5


def test_drag_coasts_down(ideal_config):
    sim = Simulator(ideal_config)
    sim.step(ThrusterCommand(1, 1), 500)
    initial = sim.truth.speed_mps
    for _ in range(100):
        sim.step()
        assert 0 < sim.truth.speed_mps < initial
        initial = sim.truth.speed_mps


def test_motor_response_and_immediate_cut():
    sim = Simulator(SimulationConfig(wave_height_m=0))
    sim.step(ThrusterCommand(1, -1))
    assert sim.data.ctrl[0] == pytest.approx(1 - math.exp(-0.01 / 0.2))
    sim.cut_thrust()
    np.testing.assert_array_equal(sim.data.ctrl, [0, 0])
    assert sim.command == ThrusterCommand()


def test_samples_are_immutable_held_and_reset_reproducible():
    sim = Simulator()
    first = sim.navigation
    with pytest.raises(dataclasses.FrozenInstanceError):
        first.east_m = 10
    sim.step(ThrusterCommand(0.7, 0.4), 9)
    assert sim.navigation is first
    sim.step(ThrusterCommand(0.7, 0.4))
    assert sim.navigation.time_s == pytest.approx(0.1)
    assert sim.navigation is not first
    state = sim.data.qpos.copy()
    sample = sim.navigation
    sim.reset()
    assert sim.navigation == first
    sim.step(ThrusterCommand(0.7, 0.4), 10)
    np.testing.assert_array_equal(sim.data.qpos, state)
    assert sim.navigation == sample


def test_gps_enu_mapping_and_heading_without_motion(ideal_config):
    sim = Simulator(ideal_config)
    assert sim.navigation.course_deg is None
    assert sim.navigation.heading_deg == pytest.approx(0, abs=1e-12)
    sim.data.qpos[:2] = [100, 100]
    sim.step(steps=10)
    assert sim.navigation.latitude_deg > ideal_config.origin_latitude_deg
    assert sim.navigation.longitude_deg > ideal_config.origin_longitude_deg
    assert sim.navigation.east_m == 100
    assert sim.navigation.north_m == 100


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -1.01, 1.01])
def test_invalid_commands(value):
    with pytest.raises(ValueError):
        ThrusterCommand(value, 0)


@pytest.mark.parametrize("values", [{"mass_kg": 0}, {"sensor_hz": 13},
                                    {"max_thrust_n": float("inf")}, {"unknown": 2}])
def test_invalid_config(values):
    with pytest.raises(ValueError):
        SimulationConfig(**values)


def test_example_config():
    from pathlib import Path

    assert load_config(Path(__file__).parents[1] / "board.toml") == SimulationConfig()


@pytest.mark.parametrize("start,target", [(0, 90), (350, 10), (10, 350), (180, 0)])
def test_heading_controller_converges(ideal_config, start, target):
    sim = Simulator(ideal_config)
    sim.reset(start)
    controller = HeadingHold(target)
    for _ in range(3000):
        sim.step(controller.update(sim.navigation, ideal_config.timestep_s))
    assert abs(heading_error(target, sim.navigation.heading_deg)) < 1


def test_heading_wrap_and_saturation(ideal_config):
    sim = Simulator(ideal_config)
    sim.reset(359)
    cmd = HeadingHold(1, throttle=1).update(sim.navigation, 0.01)
    assert cmd.port > cmd.starboard
    assert cmd.port <= 1
