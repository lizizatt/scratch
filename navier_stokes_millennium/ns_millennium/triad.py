"""Exact finite-mode checks for Navier-Stokes Fourier interactions."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import math

Wavevector = tuple[int, int, int]
Vector = tuple[complex, complex, complex]
Modes = Mapping[Wavevector, Vector]


def _zero_vector() -> Vector:
    return (0j, 0j, 0j)


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


def galerkin_rhs(
    modes: Modes,
    *,
    viscosity: float,
    active_modes: set[Wavevector] | None = None,
) -> dict[Wavevector, Vector]:
    """Return the exact projected ODE RHS on a finite Fourier mode set.

    Modes outside ``active_modes`` are discarded by the Galerkin projection;
    they are not silently evolved or treated as resolved physical modes.
    """
    active = set(modes) if active_modes is None else set(active_modes)
    active_modes_dict = {
        wavevector: modes[wavevector]
        for wavevector in active
        if wavevector in modes
    }
    rhs: dict[Wavevector, Vector] = {}
    for wavevector in active:
        value = modes.get(wavevector, _zero_vector())
        nonlinear = convective_mode(active_modes_dict, wavevector)
        frequency_squared = sum(component * component for component in wavevector)
        rhs[wavevector] = tuple(
            -nonlinear[index] - viscosity * frequency_squared * value[index]
            for index in range(3)
        )  # type: ignore[assignment]
    return rhs


def closed_ball_modes(radius: int) -> set[Wavevector]:
    """Return the integer Fourier ball used by a finite Galerkin probe."""
    if radius < 0:
        raise ValueError("radius must be non-negative")
    return {
        (first, second, third)
        for first in range(-radius, radius + 1)
        for second in range(-radius, radius + 1)
        for third in range(-radius, radius + 1)
        if first * first + second * second + third * third <= radius * radius
    }


def rk4_step(
    modes: Modes,
    *,
    viscosity: float,
    timestep: float,
    active_modes: set[Wavevector] | None = None,
) -> dict[Wavevector, Vector]:
    """Advance the projected finite-mode ODE by one classical RK4 step."""
    active = set(modes) if active_modes is None else set(active_modes)
    state = {
        wavevector: modes.get(wavevector, _zero_vector())
        for wavevector in active
    }

    def shifted(
        base: Modes,
        derivative: Modes,
        factor: float,
    ) -> dict[Wavevector, Vector]:
        return {
            wavevector: _add(
                base[wavevector],
                _scale(factor, derivative[wavevector]),
            )
            for wavevector in active
        }

    first = galerkin_rhs(state, viscosity=viscosity, active_modes=active)
    second = galerkin_rhs(
        shifted(state, first, 0.5 * timestep),
        viscosity=viscosity,
        active_modes=active,
    )
    third = galerkin_rhs(
        shifted(state, second, 0.5 * timestep),
        viscosity=viscosity,
        active_modes=active,
    )
    fourth = galerkin_rhs(
        shifted(state, third, timestep),
        viscosity=viscosity,
        active_modes=active,
    )
    return {
        wavevector: _add(
            state[wavevector],
            _scale(
                timestep / 6.0,
                _add(
                    _add(first[wavevector], _scale(2.0, second[wavevector])),
                    _add(_scale(2.0, third[wavevector]), fourth[wavevector]),
                ),
            ),
        )
        for wavevector in active
    }


def dyadic_shell_index(wavevector: Wavevector) -> int | None:
    """Return the shell index for ``2**j <= |k| < 2**(j+1)``."""
    frequency = math.sqrt(sum(component * component for component in wavevector))
    if frequency < 1:
        return None
    return math.floor(math.log2(frequency))


def shell_observables(
    modes: Modes,
    *,
    viscosity: float,
    theta: float,
) -> dict[int, dict[str, float | bool]]:
    """Measure shell energy, nonlinear influx, and badness for a finite field."""
    observables: dict[int, dict[str, float | bool]] = {}
    for wavevector, value in modes.items():
        shell = dyadic_shell_index(wavevector)
        if shell is None:
            continue
        entry = observables.setdefault(
            shell, {"energy": 0.0, "influx": 0.0, "dissipation": 0.0}
        )
        frequency_squared = sum(component * component for component in wavevector)
        energy = 0.5 * _norm_squared(value)
        nonlinear = convective_mode(modes, wavevector)
        influx = -_dot(
            tuple(item.conjugate() for item in value), nonlinear
        ).real
        entry["energy"] = float(entry["energy"]) + energy
        entry["influx"] = float(entry["influx"]) + influx
        entry["dissipation"] = (
            float(entry["dissipation"]) + viscosity * frequency_squared * _norm_squared(value)
        )

    for entry in observables.values():
        energy = float(entry["energy"])
        dissipation = float(entry["dissipation"])
        entry["bad"] = bool(
            energy > 0
            and float(entry["influx"]) > theta * dissipation
        )
    return observables


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
