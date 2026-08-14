import unittest

from ns_millennium.triad import (
    convective_mode,
    critical_flux,
    high_high_to_low_fixture,
    leray_project,
    low_h32_dissipation,
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


if __name__ == "__main__":
    unittest.main()
