# Critical Profile Iterations 002-003

**Status:** blocked; no proof or disproof of the Millennium problem.

These six attacks test three possible ways to obtain the backward $L^3$ sequence
required by the Albritton-Barker Liouville theorem:

1. global tail tightness at moving rescaled times;
2. precompactness of the ancient similarity orbit;
3. fixed rescaled backward-time selection from finite $L^4_tL^3_x$ control.

## Modality A: global tail tightness

The exact sufficient weighted condition is scale-adapted:

$$
\sup_n\int W\!\left(\frac{|x-x_n|}{r_n}\right)|u(x,\tau_n)|^3dx<\infty,
\qquad W(R)\to\infty.
$$

It is equivalent to uniform $L^3$ tail tightness of the rescaled slices. A
fixed physical weighted moment is not enough, because

$$
\int |y|^\alpha |v_n(y)|^3dy
=r_n^{-\alpha}\int |x-x_n|^\alpha|u(x)|^3dx.
$$

For any nonzero fixed $f\in L^3$ and $r_n\downarrow0$,
$g_n(y)=r_nf(x_n+r_ny)$ satisfies

$$
\|g_n\|_3=\|f\|_3,
\qquad
\int_{B_R}|g_n|^3\to0
$$

for every fixed $R$. Thus all the mass escapes to rescaled infinity. Schwartz
regularity, compact physical support, finite energy, and uniformly bounded
physical moments do not prevent this estimate-level obstruction.

For a genuine singular trajectory, proving the scale-adapted estimate would be
new PDE information; it does not follow from the standard energy inequality or
local energy inequality. The modality remains blocked at the PDE-specific
step.

## Modality B: similarity-orbit precompactness

A sufficient conditional theorem is immediate from Fréchet--Kolmogorov. If
normalized ancient slices $w_t$ satisfy uniform global $L^3$ boundedness,
spatial tail tightness, and translation equicontinuity, while retaining a
nonzero local concentration, then their orbit is precompact in $L^3$ and the
Liouville theorem applies.

The bridge from a hypothetical singularity is missing. Concentration functions
can rule out vanishing but not dichotomy. Separated bubbles

$$
 f_n=\phi+\psi(\cdot-R_ne_1),\qquad R_n\to\infty,
$$

have bounded $L^3$ norms, uniform translation equicontinuity, and bounded
Riesz-transform pressure norms, yet no globally precompact orbit. Local energy
and pressure estimates do not remove this escape mechanism. A one-bubble
profile theorem would require minimality plus a nonlinear profile-decomposition
and perturbation theorem, or an equivalent global coercive estimate.

This is an estimate-level obstruction, not a counterexample to a single ancient
Navier--Stokes solution.

## Modality C: fixed backward-time selection

Energy interpolation gives only

$$
\int_0^{T_*}\|u(t)\|_3^4dt<\infty.
$$

For rescaling $v_n(y,s)=r_nu(x_n+r_ny,t_n+r_n^2s)$,

$$
\int_I\|v_n(s)\|_3^4ds
=r_n^{-2}\int_{t_n+r_n^2I}\|u(t)\|_3^4dt.
$$

Absolute continuity gives no uniform $O(r_n^2)$ control on the shrinking
physical windows. A scalar smooth model can have finite $L^4$ time norm while
its rescaled profiles satisfy $a(\tau)\to\infty$ as $\tau\to-\infty$.
Therefore averaging, Chebyshev, record-time selection, and mapping a fixed
original time do not produce the required fixed profile times.

A favorable Navier--Stokes time-selection theorem would still be possible, but
it would be genuinely PDE-specific and essentially critical information.

## Final disposition

The three modalities provide conditional sufficient lemmas and rigorous
obstructions to weaker estimate transfers. None supplies

$$
\exists\,\tau_k\downarrow-\infty:
\sup_k\|v(\tau_k)\|_{L^3(\mathbb R^3)}<\infty.
$$

The profile route remains blocked by global $L^3$ tightness, one-bubble orbit
compactness, pressure/mildness passage, and backward time selection. No
admissible finite-time singular solution was found.
