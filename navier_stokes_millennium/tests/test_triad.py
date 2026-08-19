import unittest
from math import factorial, pi

from ns_millennium.triad import (
    closed_ball_modes,
    convective_mode,
    critical_flux,
    dyadic_shell_index,
    galerkin_rhs,
    high_high_to_low_fixture,
    leray_project,
    low_h32_dissipation,
    rk4_step,
    shell_observables,
    spatial_shell_dissipation_density,
    spatial_shell_energy_density,
    spatial_shell_flux_density,
)


class FourierTriadTests(unittest.TestCase):
    def test_fixture_is_real_and_divergence_free(self) -> None:
        modes = high_high_to_low_fixture(amplitude=3.0)

        for wavevector, value in modes.items():
            opposite = tuple(-component for component in wavevector)
            self.assertEqual(
                modes[opposite], tuple(component.conjugate() for component in value)
            )
            self.assertEqual(leray_project(wavevector, value), value)

    def test_exact_projected_interaction_reaches_low_mode(self) -> None:
        modes = high_high_to_low_fixture(amplitude=2.0)

        self.assertEqual(convective_mode(modes, (1, 0, 0)), (0j, 4j, 0j))

    def test_flux_grows_quadratically_while_low_dissipation_is_fixed(self) -> None:
        small = high_high_to_low_fixture(amplitude=1.0)
        large = high_high_to_low_fixture(amplitude=5.0)

        self.assertAlmostEqual(critical_flux(small, cutoff=1.5), 2.0)
        self.assertAlmostEqual(critical_flux(large, cutoff=1.5), 50.0)
        self.assertAlmostEqual(low_h32_dissipation(small, cutoff=1.5), 2.0)
        self.assertAlmostEqual(low_h32_dissipation(large, cutoff=1.5), 2.0)

    def test_critical_flux_is_cubic_under_uniform_field_scaling(self) -> None:
        base = high_high_to_low_fixture(amplitude=1.0)
        scaled = {
            wavevector: tuple(3.0 * component for component in value)
            for wavevector, value in base.items()
        }

        self.assertAlmostEqual(critical_flux(base, cutoff=1.5), 2.0)
        self.assertAlmostEqual(critical_flux(scaled, cutoff=1.5), 54.0)

    def test_galerkin_rhs_has_correct_sign_and_preserves_reality(self) -> None:
        modes = high_high_to_low_fixture(amplitude=1.5)
        rhs = galerkin_rhs(modes, viscosity=0.1)

        for wavevector, value in rhs.items():
            opposite = tuple(-component for component in wavevector)
            self.assertEqual(
                rhs[opposite], tuple(component.conjugate() for component in value)
            )
            self.assertAlmostEqual(sum(
                wavevector[index] * value[index].real for index in range(3)
            ), 0.0)
            self.assertAlmostEqual(sum(
                wavevector[index] * value[index].imag for index in range(3)
            ), 0.0)

    def test_galerkin_nonlinearity_conserves_truncated_energy(self) -> None:
        modes = high_high_to_low_fixture(amplitude=2.0)
        rhs = galerkin_rhs(modes, viscosity=0.0)

        nonlinear_energy_rate = sum(
            sum(value[index].conjugate() * rhs[wavevector][index]
                for index in range(3)).real
            for wavevector, value in modes.items()
        )

        self.assertAlmostEqual(nonlinear_energy_rate, 0.0)

    def test_galerkin_rhs_filters_inactive_modes(self) -> None:
        modes = high_high_to_low_fixture(amplitude=3.0)
        low_only = {(1, 0, 0)}

        filtered = galerkin_rhs(
            modes, viscosity=0.0, active_modes=low_only
        )
        isolated = galerkin_rhs(
            {key: modes[key] for key in low_only},
            viscosity=0.0,
            active_modes=low_only,
        )

        self.assertEqual(filtered, isolated)

    def test_closed_ball_is_conjugation_symmetric(self) -> None:
        active = closed_ball_modes(3)

        self.assertIn((0, 0, 0), active)
        for wavevector in active:
            opposite = tuple(-component for component in wavevector)
            self.assertIn(opposite, active)
            self.assertLessEqual(sum(component * component for component in wavevector), 9)

        radius_one = {
            (0, 0, 0),
            (1, 0, 0), (-1, 0, 0),
            (0, 1, 0), (0, -1, 0),
            (0, 0, 1), (0, 0, -1),
        }
        self.assertEqual(closed_ball_modes(1), radius_one)
        self.assertEqual(len(closed_ball_modes(2)), 33)
        with self.assertRaises(ValueError):
            closed_ball_modes(-1)

    def test_rk4_step_stays_projected_and_preserves_reality(self) -> None:
        active = closed_ball_modes(2)
        modes = {
            wavevector: leray_project(
                wavevector,
                (
                    complex(wavevector[0] + 1),
                    complex(wavevector[1] - 2),
                    0j if wavevector == (0, 0, 0) else 1j,
                ),
            )
            for wavevector in active
            if wavevector <= tuple(-component for component in wavevector)
        }
        for wavevector in tuple(modes):
            opposite = tuple(-component for component in wavevector)
            modes[opposite] = tuple(component.conjugate() for component in modes[wavevector])

        updated = rk4_step(
            modes,
            viscosity=0.05,
            timestep=0.001,
            active_modes=active,
        )

        self.assertEqual(set(updated), active)
        for wavevector, value in updated.items():
            opposite = tuple(-component for component in wavevector)
            for actual, expected in zip(
                updated[opposite],
                (component.conjugate() for component in value),
                strict=True,
            ):
                self.assertAlmostEqual(actual.real, expected.real)
                self.assertAlmostEqual(actual.imag, expected.imag)
            self.assertAlmostEqual(sum(
                wavevector[index] * value[index].real for index in range(3)
            ), 0.0)
            self.assertAlmostEqual(sum(
                wavevector[index] * value[index].imag for index in range(3)
            ), 0.0)

    def test_rk4_step_matches_single_mode_viscous_solution(self) -> None:
        wavevector = (1, 0, 0)
        timestep = 0.1
        viscosity = 0.5
        initial_value = (0j, 1 + 0j, 0j)
        updated = rk4_step(
            {wavevector: initial_value},
            viscosity=viscosity,
            timestep=timestep,
            active_modes={wavevector},
        )

        decay = -viscosity * sum(component * component for component in wavevector)
        expected_factor = sum(
            (decay * timestep) ** power / factorial
            for power, factorial in enumerate((1, 1, 2, 6, 24))
        )
        self.assertAlmostEqual(updated[wavevector][1].real, expected_factor)
        self.assertAlmostEqual(updated[wavevector][1].imag, 0.0)

    def test_spatial_shell_density_satisfies_discrete_parseval(self) -> None:
        modes = high_high_to_low_fixture(amplitude=2.0)
        modes[(8, 0, 0)] = (0j, 1.0 + 0j, 0j)
        modes[(-8, 0, 0)] = (0j, 1.0 + 0j, 0j)
        grid_size = 16
        shell = 2
        sampled_mean = sum(
            spatial_shell_energy_density(
                modes,
                (
                    2 * pi * first / grid_size,
                    2 * pi * second / grid_size,
                    2 * pi * third / grid_size,
                ),
                shell=shell,
            )
            for first in range(grid_size)
            for second in range(grid_size)
            for third in range(grid_size)
        ) / grid_size**3
        modal_energy = 0.5 * sum(
            sum(abs(component) ** 2 for component in value)
            for wavevector, value in modes.items()
            if dyadic_shell_index(wavevector) == shell
        )

        self.assertAlmostEqual(sampled_mean, modal_energy)

    def test_spatial_flux_and_dissipation_match_modal_observables(self) -> None:
        modes = high_high_to_low_fixture(amplitude=2.0)
        grid_size = 16
        shell = 0
        viscosity = 0.1
        sampled_flux = 0.0
        sampled_dissipation = 0.0
        for first in range(grid_size):
            for second in range(grid_size):
                for third in range(grid_size):
                    point = (
                        2 * pi * first / grid_size,
                        2 * pi * second / grid_size,
                        2 * pi * third / grid_size,
                    )
                    sampled_flux += spatial_shell_flux_density(
                        modes, point, shell=shell
                    )
                    sampled_dissipation += spatial_shell_dissipation_density(
                        modes, point, shell=shell, viscosity=viscosity
                    )
        sampled_flux /= grid_size**3
        sampled_dissipation /= grid_size**3
        expected = shell_observables(
            modes, viscosity=viscosity, theta=0.5
        )[shell]

        self.assertAlmostEqual(sampled_flux, float(expected["influx"]))
        self.assertAlmostEqual(
            sampled_dissipation, float(expected["dissipation"])
        )

    def test_spatial_flux_is_invariant_to_zero_padding(self) -> None:
        modes = high_high_to_low_fixture(amplitude=2.0)
        padded = dict(modes)
        for first in modes:
            for second in modes:
                output = tuple(first[index] + second[index] for index in range(3))
                padded.setdefault(output, (0j, 0j, 0j))

        point = (0.31, 0.47, 0.29)
        self.assertAlmostEqual(
            spatial_shell_flux_density(modes, point, shell=2),
            spatial_shell_flux_density(padded, point, shell=2),
        )

    def test_spatial_dissipation_requires_non_aliasing_grid(self) -> None:
        modes = {
            (8, 0, 0): (0j, 1.0 + 0j, 0j),
            (-8, 0, 0): (0j, 1.0 + 0j, 0j),
        }
        viscosity = 0.1
        sampled = sum(
            spatial_shell_dissipation_density(
                modes,
                (2 * pi * index / 17, 0.0, 0.0),
                shell=3,
                viscosity=viscosity,
            )
            for index in range(17)
        ) / 17

        self.assertAlmostEqual(sampled, 12.8)

    def test_spatial_dissipation_rejects_negative_viscosity(self) -> None:
        with self.assertRaises(ValueError):
            spatial_shell_dissipation_density(
                {(1, 0, 0): (0j, 1 + 0j, 0j)},
                (0.0, 0.0, 0.0),
                shell=0,
                viscosity=-0.1,
            )

    def test_shell_observables_mark_high_amplitude_low_shell_bad(self) -> None:
        modes = high_high_to_low_fixture(amplitude=5.0)
        observables = shell_observables(modes, viscosity=0.1, theta=0.5)

        self.assertIn(0, observables)
        self.assertTrue(observables[0]["bad"])


if __name__ == "__main__":
    unittest.main()
