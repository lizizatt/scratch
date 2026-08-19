# Helicity and Helical Functional Audit

**Date:** 2026-08-19
**Disposition:** blocked; positive helical energies retain nonlinear transfer,
while signed helicity is noncoercive.

## Candidate

Let $\Lambda=(-\Delta)^{1/2}$ and

$$
P_\pm=\frac12\left(\mathbb P\pm\Lambda^{-1}\nabla\times\right),
\qquad
E_\pm=\frac12\|\Lambda^{1/2}P_\pm u\|_2^2.
$$

The absolute critical helical energy is $\mathcal A=E_++E_-$ and signed
helicity is $H=2(E_+-E_-)=\int u\cdot\omega$.

## Evolution and sign obstruction

Writing $D_\pm=\|\Lambda^{3/2}u_\pm\|_2^2$ and $T_\pm$ for nonlinear
helical transfer,

$$
\dot E_\pm+\nu D_\pm=T_\pm.
$$

For the Euler nonlinearity the transfer into the two signs is shared, so a
positive combination $aE_++bE_-$ retains $(a+b)T$. Cancelling transfer requires
$a+b=0$, which is precisely signed helicity and is not coercive: it can vanish
for fields with large absolute energy.

## Stress tests

- A pressure-free shear has zero helicity and equal positive/negative helical
  energy while retaining large critical absolute energy.
- A Beltrami field occupies one helical sign and has benign transfer, but this is
  a special structure, not a general-data estimate.
- The exact planar high-high-to-low triad has $u\cdot\omega=0$ while absolute
  helical energy still receives nonlinear transfer. Signed helicity therefore
  misses the dangerous mode coupling.
- A concentrated straight vortex tube can have bounded energy and zero total
  helicity while its critical $\dot H^{1/2}$/local $L^3$ scale grows.
- Localizing helicity introduces the pressure flux
  $(p-|u|^2/2)\omega\cdot\nabla\chi$; global helical projection removes pressure
  only by making the functional nonlocal.

## Fixed-profile obstruction

Energy bounds provide at most time-integrated control of the critical helical
energy. They do not bound $E_++E_-$ at the prescribed KNSS profile times. A
uniform fixed-slice bound would supply the missing critical estimate rather than
derive it from finite energy.

## Disposition

The explicit positive-helical-energy/signed-helicity class fails its first
audit. The cancellation/coercivity dichotomy is decisive: positive combinations
retain nonlinear transfer, signed combinations lose coercivity. This does not
refute every nonlinear helical functional, but it blocks the basic helical
ansatz class.
