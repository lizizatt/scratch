# Critical Functional Design Loop

**Date:** 2026-08-18  
**Status:** blocked; no candidate survived the required first audit.

This loop tested four progressively different candidates against the same
criteria: Navier--Stokes critical scaling, a one-sided/coercive evolution law,
pressure handling, fixed profile times, and the record-scale local
anti-concentration target.

## Candidate 1: stress-completed instantaneous functional

$$
\Phi=\frac1{2\ell}\int\chi|u|^2
+\frac{\alpha\ell}{2}\int\chi|\omega|^2
+\beta\int_A\left(|u|^3+|p-(p)_{B_{2R}}|^{3/2}\right).
$$

**Failure:** differentiating the cubic velocity term produces
$\int |u|\,|p|^2$, which is not controlled by the $L^{3/2}$ pressure term;
differentiating the pressure term requires $p_t$, which is nonlocal and not
controlled by localized dissipation. A smooth pressure-free shear also defeats
any universal $c\Phi$ damping law.

## Candidate 2: windowed essential-supremum functional

$$
\Psi=\frac1\ell\operatorname*{ess\ sup}_{I}\int\chi|u|^2
+\frac\nu\ell\iint_I\chi|\nabla u|^2
+\frac\beta{\ell^2}\iint_I\eta_A
\left(|u|^3+|p-(p)_{B_{2R}}|^{3/2}\right).
$$

**Failure:** the $\ell^{-1}$ local kinetic term diverges for any nonzero
constant or smooth flow as $\ell\to0$. Differentiating the sliding essential
supremum also creates time-edge terms and restores the interior pressure flux.

## Candidate 3: time-averaged enstrophy and higher derivatives

A proposed combination of windowed $|\nabla u|^2$, annular $\ell^{-2}|u|^2$,
and $\ell^{-1}|\Delta u|^2$ terms is not homogeneous under Navier--Stokes
scaling. Correcting its powers produces an uncontrolled derivative hierarchy:
localized enstrophy exposes vortex stretching, while evolving the higher
regularity term produces $\nabla\Delta u$, $\Delta p$, and higher commutators.
It also gives only spacetime control, not fixed profile slices.

## Candidate 4: anisotropic signed-enstrophy modulation

A vorticity-parallel penalty such as

$$
\Phi=\frac1{2\ell}\int\chi|u|^2
+\frac\ell2\int\chi|\omega|^2
-c\ell\int\chi\frac{(u\cdot\omega)^2}{|\omega|^2}
$$

was tested as a materially different, pressure-free construction.

**Failure:** transverse high-high-to-low interactions can transfer energy while
$u\cdot\omega$ is small or zero, so the modulation does not see the dangerous
flux. The proposed enstrophy term also has incorrect critical homogeneity as
written. A dyadic wavelet/Besov sum proposed as a fallback accumulates a
logarithmic supercritical loss.

## Common result

Every candidate fails at one of three locations:

1. **instantaneous pressure:** differentiating a pressure moment requires
   unavailable $p_t$ control;
2. **critical transport:** cubic annular flux is not dominated by quadratic
   energy/enstrophy or by a transverse-insensitive penalty; or
3. **fixed-time transfer:** windowed estimates do not control prescribed KNSS
   profile slices.

No candidate establishes or refutes
`LOCAL-L2-ANTI-CONCENTRATION`. No new functional is promoted to `proved`.
The outcome is a structural design dead end for this class of local functionals,
not a proof that no possible functional exists.
