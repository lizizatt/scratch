import unittest

from ns_millennium.functional_degree import (
    DegreeContribution,
    generator_degree_profile,
    highest_nonlinear_degree,
    nonlinear_degree_is_dissipation_supported,
    quadratic_generator_output_degree,
)


class FunctionalDegreeTests(unittest.TestCase):
    def test_quadratic_candidate_generates_cubic_nonlinear_term(self) -> None:
        self.assertEqual(
            generator_degree_profile((2,)),
            (
                DegreeContribution(2, "linear", 2),
                DegreeContribution(2, "quadratic", 3),
            ),
        )

    def test_quartic_candidate_generates_quintic_nonlinear_term(self) -> None:
        self.assertEqual(highest_nonlinear_degree((2, 4)), 5)

    def test_cubic_flux_generates_quartic_nonlinear_term(self) -> None:
        self.assertEqual(quadratic_generator_output_degree(3), 4)

    def test_dissipation_support_is_necessary_bookkeeping(self) -> None:
        self.assertFalse(nonlinear_degree_is_dissipation_supported((2, 4), (2, 4)))
        self.assertTrue(nonlinear_degree_is_dissipation_supported((2, 4), (2, 5)))

    def test_degrees_must_be_positive_even_integers(self) -> None:
        with self.assertRaises(ValueError):
            generator_degree_profile(())
        with self.assertRaises(ValueError):
            generator_degree_profile((3,))
        with self.assertRaises(ValueError):
            generator_degree_profile((0,))


if __name__ == "__main__":
    unittest.main()
