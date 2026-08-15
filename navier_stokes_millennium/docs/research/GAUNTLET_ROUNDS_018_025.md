# Gauntlet Rounds 018-025

These rounds attack the remaining phase-space and critical-continuation
obligations. They do not resolve the Millennium problem.

## Round 018: Naive measure geometry

> **Claim FREQ-NAIVE-MEASURE (`refuted`).** Charging every overlapping
> dyadic cube with unit spatial atom and weight $w(Q,j)=r_Q^{-1}$ yields a
> scale-invariant Carleson packing bound.

Take a top cube of side $R$ and a binary tree with $2^k$ selected cubes at
level $k$, each of side $r_k=R2^{-k}$. Set $j_k$ so that $2^{-2j_k}=r_k^2$ and
let each selected bad interval have length $r_k^2$. The level contribution is
$2^k r_k=R$, so depth $N$ contributes $(N+1)R$. The Carleson ratio is
unbounded. This refutes the naive weight and unrestricted generational
charging, not every possible stopping-tree measure.

## Round 019: Harmonic pressure

> **Claim FREQ-PRESSURE-LOCAL (`refuted`).** Local velocity, local flux, and
> local dissipation alone control the mean-free harmonic pressure remainder.

Let $w$ be a smooth compactly supported divergence-free swirl and translate a
packet $u_L(x)=L^2w(x-Le_3)$ outside $B_2$. The velocity and dissipation vanish
inside $B_2$, but the normalized pressure
$p_L=\partial_i\partial_jG*(u_{L,i}u_{L,j})$ is harmonic there and satisfies
$\partial_3p_L(0)\to-c\int|w|^2\ne0$. Thus outer data must enter the defect.
The broader `FREQ-PRESSURE-COMMUTATOR` claim remains blocked because it allows
an as-yet-unspecified exterior tail term.

## Round 020: Matched-scale commutator

> **Claim FREQ-MATCHED-COMMUTATOR (`refuted`).** Spatial and frequency
> localization at $r\simeq2^{-j}$ has an automatically absorbably small
> commutator, uniformly in $j$.

For $\Delta_jf=K_j*f$ and $\chi_r(x)=\chi((x-x_0)/r)$,
rescaling gives
$$
\|[\Delta_j,\chi_r]\|_{L^p\to L^p}
=\|[\Delta_0,\chi(\cdot/(2^jr))]\|_{L^p\to L^p}.
$$
At $r=c2^{-j}$ this is a fixed nonzero $O(1)$ quantity. There is no
high-frequency small parameter at matched scale. The full pressure/commutator
obligation remains blocked because a different scale-separated or compensated
formulation is still possible.

## Round 021: CLMS suitability transfer

> **Claim PR-CLMS-TRANSFER (`refuted`).** Leray-Hopf energy bounds plus a
> CLMS Hardy-space estimate automatically imply the local energy inequality.

CLMS gives $(u\cdot\nabla)u_j\in L^2_t\mathcal H^1_x$, but testing requires a
Hardy-BMO pairing and hence a factor in $L^2_tBMO_x$. Energy control gives only
$u\in L^2_tW^{1,2}_x$, not the required BMO control in dimension three. A
concentrating smooth scaling family keeps the energy norms bounded while the
localized BMO pairing grows like $\lambda^{1/2}$. This refutes the transfer,
not the underlying `PR-04` implication for actual Navier-Stokes solutions.

## Round 022: Critical L3

> **Claim CRITICAL-BOUND (`blocked`).** Every finite-time smooth solution from
> admissible Schwartz data has bounded $L^\infty_tL^3_x$ norm.

Energy interpolation gives only
$$
\int_0^{T_{\max}}\|u(t)\|_3^4\,dt
\lesssim \nu^{-1}\|u_0\|_2^4,
$$
which is not an $L^\infty_tL^3_x$ estimate. No actual finite-time singular
solution was produced, so failure of the energy method is not a disproof.

## Round 023: Galerkin uniformity

> **Claim FREQ-GALERKIN-UNIFORM (`refuted`).** A cutoff-uniform zero-flux
> observation from finite Galerkin probes by itself supplies compactness,
> suitability, and a CKN conclusion for the limit.

High-frequency exact shear solutions have zero flux and pressure at every
cutoff but need not be compact in the energy topology; a concentrating shear
can retain an order-one matched-scale CKN quantity while converging to zero.
A valid transfer additionally needs fixed-data approximation, time-derivative
compactness, nonlinear identification, and a vanishing local-energy residual.
The broader `FREQ-PACKING-UNIFORM` obligation remains blocked.

## Round 024: Packing-to-CKN bridge

> **Claim FREQ-PACKING-EPSILON-COMPARABLE (`refuted`).** Small bad-event
> packing plus bounded local energy and pressure forces a centered or
> comparable-scale CKN epsilon cylinder.

Use the exact shear $u=Ue^{-\nu N^2t}e_1\cos(Nx_2)$ with $r=\alpha/N$ and
$N=2^j$. Every nonlinear flux and pressure defect is zero, while the local
energy controls remain finite and scale-independent in $a=Ur$. The CKN cubic
quantity is bounded below by $c a^3$. Choosing $a$ large defeats every
comparable-scale criterion. Any surviving bridge must include a coercive
absolute-velocity term, which is the missing estimate rather than a consequence
of occupancy alone.

## Round 025: Dependency closure

> **Claim ROUND-025-CLOSURE (`blocked`).** The current dependency graph proves
> or disproves Clay-A.

The closure audit found no proof of `CRITICAL-BOUND` and no admissible whole-space
finite-time singular solution. The narrow claims above are refuted, but the
broader phase-space route remains blocked on measure geometry, nonlocal
pressure, commutators, cutoff-uniform suitable convergence, and a coercive
packing-to-epsilon bridge. Clay-A therefore remains blocked.

The finite probe is evidence about finite Galerkin systems only. It is not a
proof of regularity or blowup.
