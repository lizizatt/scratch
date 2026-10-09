"""Passive housing loads, current-induced yaw, and rotational energy loss."""

import math

import mujoco
import numpy as np
import pytest

from hms_jazzy.config import SimulationConfig
from hms_jazzy.navigation import heading_error
from hms_jazzy.physics import Simulator


@pytest.mark.parametrize("heading", [0, 90, 180, 270])
@pytest.mark.parametrize("mount_x", [-0.6, 0, 0.6])
def test_side_current_applies_housing_force_at_actual_mount(heading, mount_x):
    sim = Simulator(SimulationConfig(wave_height_m=0, initial_heading_deg=heading,
                                     thruster_x_m=mount_x))
    rotation = sim.data.body("board").xmat.reshape(3, 3).copy()
    current = rotation @ [0, 0.5, 0]
    sim.set_current(*current[:2])
    force = sim.drag_force()
    # Two fully submerged capsules: cylinder length .36 m, radius .085 m, Cd=1.
    motor_force = 2 * 0.5 * sim.config.water_density_kg_m3 * (
        2 * 0.085 * 0.36 + math.pi * 0.085**2
    ) * 0.5**2
    hull_force = sim.config.sway_linear_drag * 0.5 + sim.config.sway_quadratic_drag * 0.5**2
    np.testing.assert_allclose(rotation.T @ force[:3], [0, hull_force + motor_force, 0],
                               atol=1e-10)
    assert force[5] == pytest.approx(mount_x * motor_force, abs=1e-10)
    assert force[3] == pytest.approx(
        (sim.config.com_height_m + sim.config.thickness_m / 2) * hull_force
        - sim.config.thruster_z_m * motor_force
    )


@pytest.mark.parametrize("heading", [0, 90, 180, 270])
@pytest.mark.parametrize("axis", [0, 1, 2])
@pytest.mark.parametrize("rate", [-0.2, 0.2])
def test_rotational_drag_opposes_each_body_axis(heading, axis, rate):
    sim = Simulator(SimulationConfig(wave_height_m=0, initial_heading_deg=heading))
    sim.data.qvel[3 + axis] = rate
    assert sim.drag_force()[3 + axis] * rate < 0


@pytest.mark.parametrize("mount_x,turn_sign", [(-0.6, -1), (0, 0), (0.6, 1)])
def test_cross_current_gradually_turns_and_advects_unpowered_board(mount_x, turn_sign):
    sim = Simulator(SimulationConfig(wave_height_m=0, thruster_x_m=mount_x))
    sim.set_current(0.5, 0)
    sim.step()
    assert abs(heading_error(sim.truth.heading_deg, 0)) < 0.01
    sim.step(steps=1999)
    turn = heading_error(sim.truth.heading_deg, 0)
    assert sim.truth.east_m > 8
    if turn_sign:
        assert 2 < turn * turn_sign < 60
    else:
        assert abs(turn) < 1e-8
    sim.step(steps=4000)
    assert abs(sim.data.qvel[5]) < 1e-3


@pytest.mark.parametrize("rate", [-0.3, 0.3])
def test_neutral_yaw_rate_coasts_down_without_artificial_spin(rate):
    sim = Simulator(SimulationConfig(wave_height_m=0))
    sim.data.qvel[5] = rate
    sim.step(steps=2000)
    assert abs(sim.data.qvel[5]) < abs(rate) / 100
    assert np.linalg.norm(sim.data.qvel[:2]) < 0.01


def motor_loads(sim):
    mujoco.mj_forward(sim.model, sim.data)
    rotation = sim.data.body("board").xmat.reshape(3, 3)
    force, torque = sim._motor_water_loads(rotation)
    return np.concatenate((force, rotation.T @ torque))


@pytest.mark.parametrize("tilted", [False, True])
@pytest.mark.parametrize("heading", [0, 90, 180, 270])
def test_motor_drag_is_water_relative_and_dissipative(tilted, heading):
    sim = Simulator(SimulationConfig(wave_height_m=0, initial_heading_deg=heading))
    if tilted:
        tilt = np.empty(4)
        mujoco.mju_axisAngle2Quat(tilt, np.array([1., 2., 0.]) / math.sqrt(5), 0.35)
        result = np.empty(4)
        mujoco.mju_mulQuat(result, sim.data.qpos[3:].copy(), tilt)
        sim.data.qpos[3:] = result
    sim.set_current(0.4, -0.3)
    sim.data.qvel[:] = [0.4, -0.3, 0, 0, 0, 0]
    np.testing.assert_allclose(motor_loads(sim), 0, atol=1e-12)
    sim.data.qvel[:] = [0.7, -0.1, -0.2, 0.3, -0.4, 0.5]
    relative = sim.data.qvel - [0.4, -0.3, 0, 0, 0, 0]
    assert np.dot(motor_loads(sim), relative) < 0
    assert np.dot(sim.drag_force(), relative) < 0


def test_housing_drag_scales_quadratically_and_crossflow_is_axisymmetric():
    sim = Simulator(SimulationConfig(wave_height_m=0, initial_heading_deg=90))
    sim.data.qvel[1] = 0.3
    base = motor_loads(sim)
    sim.data.qvel[1] = 0.6
    np.testing.assert_allclose(motor_loads(sim), base * 4, atol=1e-12)
    sim.data.qvel[1] = -0.3
    np.testing.assert_allclose(motor_loads(sim), -base, atol=1e-12)
    sim.data.qvel[1:3] = 0.3 / math.sqrt(2)
    diagonal = motor_loads(sim)
    assert np.linalg.norm(diagonal[:3]) == pytest.approx(np.linalg.norm(base[:3]))
    np.testing.assert_allclose(diagonal[1:3], base[1] / math.sqrt(2), atol=1e-12)


@pytest.mark.parametrize("height,wet", [(0.265, 1), (0.35, 0.5), (0.435, 0)])
def test_housing_drag_immersion_even_when_hull_is_dry(height, wet):
    sim = Simulator(SimulationConfig(wave_height_m=0, initial_heading_deg=90))
    sim.data.qvel[0] = 0.5
    full = motor_loads(sim)
    sim.data.qpos[2] = height
    np.testing.assert_allclose(motor_loads(sim), full * wet, atol=1e-12)
    if height >= 0.35:
        np.testing.assert_allclose(sim.drag_force(), full * wet, atol=1e-12)


def test_rolled_housing_exposure_produces_unequal_drag_and_yaw():
    sim = Simulator(SimulationConfig(wave_height_m=0, initial_heading_deg=90))
    sim.data.qpos[2] = 0.35
    mujoco.mju_axisAngle2Quat(sim.data.qpos[3:], np.array([1., 0., 0.]), 0.3)
    sim.data.qvel[0] = 0.5
    load = motor_loads(sim)
    # Port housing is dry, starboard is wet; its aft-directed drag yaws clockwise.
    assert sim.data.site("port").xpos[2] > 0.085
    assert sim.data.site("starboard").xpos[2] < -0.085
    assert load[0] < 0 and load[5] < 0


def test_motor_drag_samples_local_wave_flow_at_each_mount():
    sim = Simulator(SimulationConfig(initial_heading_deg=90))
    points = sim.data.site_xpos.copy()
    elevation, flow = sim.water.sample(points, sim.time_s)
    assert not np.allclose(flow[0], flow[1])
    velocity = -flow
    area = math.pi * 0.085**2
    forces = np.empty_like(velocity)
    forces[:, 0] = -0.5 * 1025 * 0.2 * area * velocity[:, 0] * abs(velocity[:, 0])
    forces[:, 1:] = -0.5 * 1025 * (0.17 * 0.36 + area) * (
        np.linalg.norm(velocity[:, 1:], axis=1, keepdims=True) * velocity[:, 1:]
    )
    forces *= np.clip((elevation - points[:, 2] + 0.085) / 0.17, 0, 1)[:, None]
    expected = np.concatenate((forces.sum(axis=0),
                               np.cross(points - sim.data.qpos[:3], forces).sum(axis=0)))
    np.testing.assert_allclose(motor_loads(sim), expected, atol=1e-12)


def test_passive_drag_is_independent_of_thrust_strength_and_can_be_disabled():
    sim = Simulator(SimulationConfig(wave_height_m=0))
    sim.data.qvel[:] = [0.4, -0.3, 0, 0.2, 0.1, -0.3]
    before = motor_loads(sim)
    sim.set_motor_strength(1000)
    np.testing.assert_allclose(motor_loads(sim), before, atol=1e-12)
    bare = Simulator(SimulationConfig(wave_height_m=0, motor_axial_drag_coefficient=0,
                                      motor_crossflow_drag_coefficient=0))
    bare.data.qvel[:] = sim.data.qvel
    np.testing.assert_array_equal(motor_loads(bare), 0)
    np.testing.assert_allclose(sim.drag_force() - bare.drag_force(), before, atol=1e-12)


@pytest.mark.parametrize("field", [
    "motor_axial_drag_coefficient", "motor_crossflow_drag_coefficient",
])
@pytest.mark.parametrize("value", [-1, float("nan"), float("inf")])
def test_invalid_motor_drag_coefficients(field, value):
    with pytest.raises(ValueError):
        SimulationConfig(**{field: value})


def test_current_turning_converges_with_timestep_and_reset_is_repeatable():
    poses = []
    for timestep in [0.005, 0.01, 0.02]:
        sim = Simulator(SimulationConfig(wave_height_m=0, timestep_s=timestep,
                                         current_east_mps=0.5))
        sim.step(steps=round(20 / timestep))
        poses.append(sim.data.qpos.copy())
        sim.reset()
        sim.step(steps=round(20 / timestep))
        np.testing.assert_array_equal(sim.data.qpos, poses[-1])
    # Euler integration should converge; allow millimetre-scale travel differences.
    np.testing.assert_allclose(poses[1], poses[0], atol=0.005)
    np.testing.assert_allclose(poses[2], poses[0], atol=0.01)
    assert np.linalg.norm(poses[1] - poses[0]) < np.linalg.norm(poses[2] - poses[0]) / 2
