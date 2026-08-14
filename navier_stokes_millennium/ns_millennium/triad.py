"""Exact finite-mode checks for Navier-Stokes Fourier interactions."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

Wavevector = tuple[int, int, int]
Vector = tuple[complex, complex, complex]
Modes = Mapping[Wavevector, Vector]


def _dot(left: Sequence[complex], right: Sequence[complex]) -> complex:
    return sum(a * b for a, b in zip(left, right, strict=True))


def _add(left: Vector, right: Vector) -> Vector:
    return tuple(a + b for a, b in zip(left, right, strict=True))  # type: ignore[return-value]


def _scale(factor: complex, vector: Vector) -> Vector:
    return tuple(factor * value for value in vector)  # type: ignore[return-value]


def _norm_squared(vector: Sequence[complex]) -> float:
    return float(sum(abs(value) ** 2 for value in vector))


def leray_project(wavevector: Wavevector, vector: Vector) -> Vector:
    """Project a Fourier coefficient onto the plane normal to its wavevector."""
    length_squared = sum(value * value for value in wavevector)
    if length_squared == 0:
        return vector
    longitudinal = _dot(wavevector, vector) / length_squared
    return tuple(
        value - longitudinal * frequency
        for value, frequency in zip(vector, wavevector, strict=True)
    )  # type: ignore[return-value]


def convective_mode(modes: Modes, output: Wavevector) -> Vector:
    """Return the Fourier coefficient of P div(u tensor u) at ``output``."""
    total: Vector = (0j, 0j, 0j)
    for first, first_value in modes.items():
        second = tuple(
            output[index] - first[index] for index in range(3)
        )  # type: ignore[assignment]
        second_value = modes.get(second)
        if second_value is None:
            continue
        contribution = _scale(1j * _dot(first_value, second), second_value)
        total = _add(total, contribution)
    return leray_project(output, total)


def critical_flux(modes: Modes, cutoff: float) -> float:
    """Return influx into low modes for the truncated H^(1/2) energy."""
    flux = 0j
    for wavevector, value in modes.items():
        frequency = sum(component * component for component in wavevector) ** 0.5
        if frequency <= cutoff:
            nonlinear = convective_mode(modes, wavevector)
            flux -= frequency * _dot(tuple(item.conjugate() for item in value), nonlinear)
    return float(flux.real)


def low_h32_dissipation(modes: Modes, cutoff: float) -> float:
    """Return the low-mode squared homogeneous H^(3/2) seminorm."""
    total = 0.0
    for wavevector, value in modes.items():
        frequency = sum(component * component for component in wavevector) ** 0.5
        if frequency <= cutoff:
            total += frequency**3 * _norm_squared(value)
    return total


def high_high_to_low_fixture(amplitude: float) -> dict[Wavevector, Vector]:
    """Build a real divergence-free field whose high modes feed one low mode."""
    low = (1, 0, 0)
    high_a = (0, 4, 0)
    high_b = (1, -4, 0)
    low_value = (0j, -1j, 0j)
    high_a_value = (complex(amplitude), 0j, 0j)
    high_b_value = (complex(4 * amplitude), complex(amplitude), 0j)
    return {
        low: low_value,
        tuple(-value for value in low): tuple(
            value.conjugate() for value in low_value
        ),
        high_a: high_a_value,
        tuple(-value for value in high_a): high_a_value,
        high_b: high_b_value,
        tuple(-value for value in high_b): high_b_value,
    }
