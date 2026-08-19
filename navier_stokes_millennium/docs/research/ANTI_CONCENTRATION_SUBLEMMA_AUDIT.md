# Anti-Concentration Sublemma Audit

**Date:** 2026-08-19
**Status:** all three sublemmas remain blocked; one fixed-time obligation can be
weakened without changing the rigidity endpoint.

## 1. Near-field pressure/cubic closure

The local pressure decomposition gives

$$
\mathcal D_{\rm near}(L)\lesssim L^{-1}\int_{B_{4L}}|v|^3,
$$

which is the exact critical cubic quantity the local energy argument is meant
to control. Calderon--Zygmund, div-curl, Bogovskii, and epsilon-regularity do
not provide a smaller term without assuming the target or an equivalent
critical bound.

**Disposition:** blocked at circularity. The smallest repair would be a new
sign-definite PDE estimate that separates near pressure from local cubic mass.

## 2. Far harmonic pressure tail

The rescaled far tail is

$$
\Theta(L)=L^3\int_{|z|>2L}\frac{|v(z)|^2}{|z|^4}\,dz.
$$

Finite global energy gives only the supercritical $M_k/L$-type loss in original
variables. Remote packets alter harmonic pressure traction while leaving local
velocity information unchanged. Multipole cancellation is not forced by
finite energy or divergence freedom.

Material-domain geometry does not solve this: a corrected pullback calculation
shows that an endpoint ball can have initial volume of order $L_k^3/M_k^3$
and initial weighted energy of order $L_k^3/M_k^2$, which can vanish when
$1\ll L_k\ll M_k^{2/3}$. The real obstruction remains pressure-tail production,
not that initial-domain volume estimate.

**Disposition:** blocked at nonlocal tail control.

## 3. Fixed-profile-time transfer

A good time selected from a spacetime average need not be a prescribed
$\tau_{k,j}=t_k+M_k^{-2}s_j$. On expanding balls, the localized energy has no
uniform rescaled-time modulus; expanding-ball boundary flux can create narrow
spikes invisible to the average.

The direct endpoint-transfer statement is therefore blocked. A weaker route
would suffice for the rigidity conclusion if one could prove, for fixed $s_j$ and
some $\delta>0$,

$$
\sup_j\limsup_k\frac1\delta
\int_{s_j-\delta}^{s_j}\int_{B_{L_k}}|v_k(y,s)|^2\,dy\,ds<\infty,
\qquad L_k\to\infty.
$$

Good-time selection inside each fixed profile window would then give local
ancient-profile $L^2$ control, and ancient energy monotonicity could propagate
that control to the desired sequence of profile slices. This is a weaker
quantifier than pointwise fixed-time transfer, but current energy estimates do
not establish it.

**Disposition:** blocked, not refuted. The weaker windowed expanding-ball lemma
is the best next subtarget.

## Consolidated result

The original target decomposes into three gates:

$$
\text{near cubic closure}
+\text{far tail control}
+\text{fixed-profile window control}
\Longrightarrow
\text{LOCAL-L2-ANTI-CONCENTRATION}.
$$

The first two are blocked by critical pressure/nonlocality. The third has a
potentially useful weakened formulation, but it is still not supplied by
finite energy. No sublemma was proved or refuted at the full Navier--Stokes
level.
