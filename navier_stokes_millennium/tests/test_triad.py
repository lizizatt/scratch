import unittest

from ns_millennium.triad import (
    convective_mode,
    critical_flux,
    galerkin_rhs,
    high_high_to_low_fixture,
    leray_project,
    low_h32_dissipation,
    shell_observables,
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

    def test_shell_observables_mark_high_amplitude_low_shell_bad(self) -> None:
        modes = high_high_to_low_fixture(amplitude=5.0)
        observables = shell_observables(modes, viscosity=0.1, theta=0.5)

        self.assertIn(0, observables)
        self.assertTrue(observables[0]["bad"])


if __name__ == "__main__":
    unittest.main()
