import math

import mujoco
import numpy as np
import pytest

from hms_jazzy.config import SimulationConfig
from hms_jazzy.navigation import ThrusterCommand, heading_error
from hms_jazzy.physics import Simulator
from hms_jazzy.server import MESSAGE_ADAPTER, HelmSession
from hms_jazzy.water import GRAVITY, Water


def test_free_body_floats_at_displacement_equilibrium():
    sim = Simulator(SimulationConfig(wave_height_m=0))
    assert (sim.model.nq, sim.model.nv) == (7, 6)
    origin = sim.data.qpos.copy()
    buoyancy, torque, drag, _ = sim._water_loads()
    np.testing.assert_allclose(buoyancy, [0, 0, sim.config.mass_kg * GRAVITY], atol=1e-10)
    np.testing.assert_allclose(torque, 0, atol=1e-10)
    np.testing.assert_allclose(drag, 0, atol=1e-10)
    sim.step(steps=1000)
    np.testing.assert_allclose(sim.data.qpos, origin, atol=1e-10)
    np.testing.assert_allclose(sim.data.qvel, 0, atol=1e-10)


@pytest.mark.parametrize("axis", [[1, 0, 0], [0, 1, 0]])
def test_buoyancy_restores_small_roll_pitch_and_heave(axis):
    sim = Simulator(SimulationConfig(wave_height_m=0, initial_heading_deg=90))
    original_z = sim.truth.up_m
    mujoco.mju_axisAngle2Quat(sim.data.qpos[3:7], np.array(axis, dtype=float), 0.08)
    sim.data.qpos[2] += 0.03
    sim.step(steps=1500)
    assert abs(sim.truth.roll_deg) < 0.05
    assert abs(sim.truth.pitch_deg) < 0.05
    assert abs(sim.truth.up_m - original_z) < 0.001


def test_dry_board_falls_without_water_drag_or_thrust():
    sim = Simulator(SimulationConfig(wave_height_m=0, motor_time_constant_s=0))
    sim.data.qpos[2] = 2
    sim.data.qvel[0] = 1
    np.testing.assert_allclose(sim.drag_force(), 0)
    sim.step(ThrusterCommand(1, 1))
    np.testing.assert_allclose(sim.data.ctrl, 0)
    assert sim.data.qvel[2] == pytest.approx(-GRAVITY * sim.config.timestep_s)


@pytest.mark.parametrize("heading", [0, 90, 180, 270])
def test_mount_sites_and_force_moments_in_3d(heading):
    c = SimulationConfig(wave_height_m=0, initial_heading_deg=heading,
                         motor_time_constant_s=0, thruster_x_m=1.1, thruster_arm_m=0.8)
    sim = Simulator(c)
    rotation = sim.data.body("board").xmat.reshape(3, 3).copy()
    for name, sign in [("port", 1), ("starboard", -1)]:
        expected = sim.data.qpos[:3] + rotation @ [c.thruster_x_m, sign * c.thruster_arm_m,
                                                 c.thruster_z_m]
        np.testing.assert_allclose(sim.data.site(name).xpos, expected, atol=1e-12)
    sim.step(ThrusterCommand(1, 0))
    np.testing.assert_allclose(sim.data.qvel[:3], rotation @ [
        c.max_thrust_n / c.mass_kg * c.timestep_s, 0, 0,
    ], atol=1e-12)
    np.testing.assert_allclose(sim.data.qvel[3:], [
        0, c.thruster_z_m * c.max_thrust_n / c.pitch_inertia_kg_m2 * c.timestep_s,
        -c.thruster_arm_m * c.max_thrust_n / c.yaw_inertia_kg_m2 * c.timestep_s,
    ], atol=1e-12)


def test_sampled_heading_rate_is_projected_bow_rate_when_tilted():
    c = SimulationConfig(wave_height_m=0, initial_heading_deg=90, heading_noise_deg=0,
                         yaw_rate_noise_deg_s=0)
    sim = Simulator(c)
    mujoco.mju_axisAngle2Quat(sim.data.qpos[3:7], np.array([0., 1., 0.]), 0.3)
    sim.data.qvel[3:] = [0.2, -0.1, 0.4]
    mujoco.mj_forward(sim.model, sim.data)
    before = sim._sample_navigation()
    mujoco.mj_integratePos(sim.model, sim.data.qpos, sim.data.qvel, 1e-6)
    mujoco.mj_forward(sim.model, sim.data)
    measured = heading_error(sim.truth.heading_deg, before.heading_deg) / 1e-6
    assert before.yaw_rate_deg_s == pytest.approx(measured, abs=1e-4)


@pytest.mark.parametrize("mount_x", [-1, 1])
def test_fore_aft_mount_position_changes_thrust_when_pitched(mount_x):
    c = SimulationConfig(wave_height_m=0, thruster_x_m=mount_x, motor_time_constant_s=0)
    sim = Simulator(c)
    sim.data.qpos[2] += 0.1
    mujoco.mju_axisAngle2Quat(sim.data.qpos[3:7], np.array([0., 1., 0.]), 0.1)
    motor_z = sim.data.qpos[2] + c.thruster_z_m * math.cos(0.1) - mount_x * math.sin(0.1)
    immersion = np.clip((0.06 - motor_z) / 0.12, 0, 1)
    sim.step(ThrusterCommand(0.4, 0.4))
    np.testing.assert_allclose(sim.data.ctrl, [0.4 * immersion] * 2, atol=1e-12)
    assert immersion == (1 if mount_x > 0 else 0)


def test_roll_partially_exposes_only_port_propeller():
    c = SimulationConfig(wave_height_m=0, motor_time_constant_s=0)
    sim = Simulator(c)
    sim.data.qpos[2] += 0.06
    mujoco.mju_axisAngle2Quat(sim.data.qpos[3:7], np.array([1., 0., 0.]), 0.15)
    depths = []
    for y in [c.thruster_arm_m, -c.thruster_arm_m]:
        z = sim.data.qpos[2] + c.thruster_z_m * math.cos(0.15) + y * math.sin(0.15)
        depths.append(np.clip((0.06 - z) / 0.12, 0, 1))
    sim.step(ThrusterCommand(1, 1))
    np.testing.assert_allclose(sim.data.ctrl, depths, atol=1e-12)
    assert 0 < sim.data.ctrl[0] < sim.data.ctrl[1] == 1


def test_full_throttle_cannot_beat_two_knot_head_current():
    calm = Simulator(SimulationConfig(wave_height_m=0))
    calm.step(ThrusterCommand(1, 1), 4000)
    assert 1.5 < calm.truth.speed_mps / 0.514444444 < 1.9
    head_current = Simulator(SimulationConfig(wave_height_m=0, current_north_mps=-1.028888889))
    head_current.step(ThrusterCommand(1, 1), 4000)
    assert head_current.data.qvel[1] < -0.1
    assert head_current.truth.north_m < -4
    assert head_current.data.qvel[1] + 1.028888889 == pytest.approx(calm.truth.speed_mps, abs=0.005)


def test_wave_motion_is_3d_bounded_and_repeatable():
    sim = Simulator()
    samples = []
    for _ in range(200):
        sim.step(steps=10)
        samples.append([sim.truth.up_m, sim.truth.roll_deg, sim.truth.pitch_deg])
    samples = np.array(samples)
    assert np.ptp(samples[:, 0]) > 0.2
    assert np.ptp(samples[:, 1]) > 5
    assert np.ptp(samples[:, 2]) > 2
    assert np.max(np.abs(samples[:, 1:])) < 30
    final = sim.data.qpos.copy()
    sim.reset()
    sim.step(steps=2000)
    np.testing.assert_array_equal(sim.data.qpos, final)
    assert np.linalg.norm(sim.data.qpos[3:]) == pytest.approx(1)


@pytest.mark.parametrize("timestep", [0.005, 0.02])
def test_wave_motion_remains_bounded_at_supported_timesteps(timestep):
    sim = Simulator(SimulationConfig(timestep_s=timestep))
    for _ in range(100):
        sim.step(steps=round(0.1 / timestep))
        assert abs(sim.truth.roll_deg) < 30
        assert abs(sim.truth.pitch_deg) < 15
        assert -0.2 < sim.truth.up_m < 0.7
        assert np.linalg.norm(sim.data.qpos[3:]) == pytest.approx(1)


def test_wave_surface_kinematics_and_descriptor_agree():
    water = Water(SimulationConfig())
    points = np.array([[0., 0., 0.], [2., -1., -1.]])
    height, velocity = water.sample(points, 1.2)
    descriptor = water.snapshot()
    expected = np.zeros(2)
    for component in descriptor["components"]:
        k, omega = component["wave_number_rad_m"], component["omega_rad_s"]
        assert omega**2 == pytest.approx(GRAVITY * k)
        phase = k * (points[:, 0] * component["east"] + points[:, 1] * component["north"])
        phase -= omega * 1.2 - component["phase_rad"]
        expected += component["amplitude_m"] * np.cos(phase)
    np.testing.assert_allclose(height, expected)
    later, _ = water.sample(points, 1.2 + 1e-6)
    assert (later[0] - height[0]) / 1e-6 == pytest.approx(velocity[0, 2], abs=1e-5)
    calm_height, calm_velocity = Water(SimulationConfig(wave_height_m=0)).sample(points, 40)
    np.testing.assert_array_equal(calm_height, 0)
    np.testing.assert_array_equal(calm_velocity, 0)


@pytest.mark.parametrize("changes", [
    {"thruster_x_m": 2}, {"thruster_arm_m": 0}, {"thruster_arm_m": 2.1},
    {"wave_period_s": 0}, {"wave_period_s": -1}, {"wave_height_m": -1},
    {"com_height_m": -1}, {"roll_inertia_kg_m2": 500}, {"mass_kg": 1000},
])
def test_invalid_3d_config(changes):
    with pytest.raises(ValueError):
        SimulationConfig(**changes)


def test_mount_rebuild_neutralizes_resets_and_retains_mounts_on_reset():
    session = HelmSession(SimulationConfig(), now=0)
    session.receive(MESSAGE_ADAPTER.validate_python({
        "type": "waypoint", "east_m": 20, "north_m": 20,
    }), now=0)
    session.advance(20, now=0.1)
    session.receive(MESSAGE_ADAPTER.validate_python({
        "type": "mounts", "longitudinal_m": 0.9, "half_spacing_m": 0.8,
    }), now=0.2)
    state = session.snapshot()
    assert state["time_s"] == 0 and state["revision"] == 1
    assert state["mode"] == "manual" and state["waypoint"] is None
    assert state["command"] == {"port": 0, "starboard": 0}
    assert state["config"]["thruster_x_m"] == 0.9
    session.receive(MESSAGE_ADAPTER.validate_python({"type": "reset"}), now=0.3)
    assert session.sim.config.thruster_arm_m == 0.8
    assert session.snapshot()["revision"] == 2


def test_invalid_mount_or_wave_update_is_atomic():
    session = HelmSession(SimulationConfig(), now=0)
    for payload in [
        {"type": "mounts", "longitudinal_m": 10, "half_spacing_m": 0.8},
        {"type": "waves", "height_m": 0.6, "period_s": 0, "direction_deg": 0},
    ]:
        before = session.snapshot()
        with pytest.raises(ValueError):
            session.receive(MESSAGE_ADAPTER.validate_python(payload), now=0.2)
        assert session.snapshot() == before


def test_calm_wave_command_and_reset_defaults():
    session = HelmSession(SimulationConfig(), now=0)
    session.receive(MESSAGE_ADAPTER.validate_python({
        "type": "waves", "height_m": 0, "period_s": 2.4, "direction_deg": 0,
    }), now=0)
    assert session.snapshot()["water"]["height_m"] == 0
    session.receive(MESSAGE_ADAPTER.validate_python({"type": "reset"}), now=0.1)
    assert session.snapshot()["water"]["height_m"] == 0.3
