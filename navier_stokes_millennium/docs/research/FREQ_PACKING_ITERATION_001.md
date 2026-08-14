# Frequency-Packing Iteration 001

**Status:** conjectural research note; no regularity theorem claimed.

This iteration refines `FREQ-PACKING` after independent brainstorms. The
pointwise absorption idea is already refuted by the exact high-high-to-low
triad. The target is instead a packing statement about when and at which
scales bad transfer occurs.

## Definitions and normalization

This iteration is formulated on the unit three-torus with dimensionless time.
For a physical torus of side length $L$ and viscosity $\nu$, use

$$
\widetilde t=\frac{\nu t}{L^2}.
$$

A whole-space version would need an explicit spatial phase-space measure; this
note does not define one.

Let `Delta_j` be a homogeneous Littlewood-Paley block and write

$$
E_j(t)=\frac12\|\Delta_j u(t)\|_2^2,
$$

$$
\Pi_j(t)= -\left\langle \Delta_j u(t),
\Delta_j\mathbb P\nabla\!\cdot(u\otimes u)(t)\right\rangle.
$$

For `E_j(t)>0`, call `(j,t)` bad when

$$
\Pi_j(t)>\theta\,\nu\,2^{2j}E_j(t).
$$

This displayed threshold is dimensionless under the unit-volume periodic
normalization. On $\mathbb R^3$, it must be replaced by a spatially localized
energy density; the global $L^2$ shell energy cannot be inserted into the same
formula without that qualification.

The natural parabolic time height of shell `j` is

$$
\tau_j=2^{-2j}.
$$

## Corrected packing candidate

The prior draft weighted bad time directly by `2^(2j)`. That is a useful
occupancy heuristic, but it is not the standard Carleson measure normalization.
A cleaner time-scale measure is

$$
\mu_\theta(dt,d\tau)
=\sum_j \mathbf 1_{B_j}(t)\,dt\,\delta_{\tau_j}(d\tau),
\qquad
B_j=\{t:(j,t)\text{ is bad}\}.
$$

For a time interval `I`, its upper Carleson box is

$$
T(I)=I\times(0,|I|].
$$

The refined conjecture is

> There exists a dimensionless threshold $\theta>0$ such that every smooth
> normalized periodic solution has a finite solution-dependent constant
> $C(u,\theta)$ satisfying $\mu_\theta(T(I))\leq C(u,\theta)|I|$ for every
> dimensionless interval $I$, possibly after adding spatial localization and
> pressure-defect terms.

This says bad activity can occur, including at arbitrarily high frequencies,
but cannot occupy too much total parabolic time beneath one time interval.
It is a conjecture for the normalized periodic setting, not an established
bridge to regularity or a whole-space statement.

## Why this is better than pointwise absorption

The exact triad shows that a single shell can be bad. The packing statement
allows that. It asks instead whether infinitely many nested bad events can have
too much total parabolic occupancy before a finite time.

This aligns with the successful pattern in harmonic-map heat flow:

$$
\text{scale-local control}
+\longrightarrow
+\text{epsilon regularity}
+\longrightarrow
+\text{exclusion of persistent concentration}.
$$

For Navier-Stokes, the missing bridge is still substantial. A time-frequency
packing bound alone does not control where in space the concentration occurs,
and it does not automatically imply bounded `L^infinity_t L^3_x`.

## First standard estimate

The usual critical estimate has the schematic form

$$
\frac{d}{dt}\|u\|_{\dot H^{1/2}}^2
+\nu\|u\|_{\dot H^{3/2}}^2
\lesssim
\|u\|_{\dot H^{1/2}}\|u\|_{\dot H^{3/2}}^2.
$$

It closes for small critical data, but supplies no large-data packing theorem.
A successful FREQ-PACKING proof would need a genuinely new summability or
cancellation statement for the bad boxes, with the full pressure decomposition
and high-high-to-low terms retained.

## Computational probe, corrected

A finite experiment can falsify a proposed packing inequality but cannot prove
the universal statement. The current single-triad evaluator is useful for one
bad box, but it is not yet a Navier-Stokes time integrator:

- its fixed mode dictionary does not add newly generated convolution modes;
- the fixture is not closed under all triadic sums and differences;
- forward Euler needs a stability/convergence check at high frequency;
- a finite shell set cannot test infinite nested packing.

A valid finite Galerkin probe should:

1. choose a finite wavevector set closed under retained convolution outputs;
2. project every generated output back into that set;
3. use a convergent time integrator and compare step refinements;
4. record `E_j`, exact projected `Pi_j`, bad intervals, and
   `mu_theta(T(I)) / |I|` over every dyadic time interval;
5. increase the Fourier cutoff and test whether the observed packing ratio is
   stable or grows with the cutoff.

The repository now provides `galerkin_rhs` and `shell_observables` in
`ns_millennium/triad.py`. The RHS uses the Navier-Stokes sign convention,
projects onto the retained modes, and exposes shell energy, influx,
dissipation, and badness. It is an exact finite Galerkin diagnostic, not a
closed model of the infinite PDE.

A growing ratio is a counterexample to that finite-family inequality, not a
proof of Navier-Stokes blowup. A bounded ratio is only evidence about the
chosen finite Galerkin systems.

## Next mathematical gate

The next useful lemma is not "packing implies regularity" in one leap. Split it:

1. **Flux lemma:** derive a scale-local upper bound for `Pi_j` whose bad-box
   measure has the proposed Carleson packing.
2. **Local bridge:** prove that packing plus suitable local energy and pressure
   bounds forces one epsilon-regular scale in every parabolic cylinder.
3. **Continuation bridge:** show that repeated local regular scales prevent the
   critical `L^3` norm from diverging at a finite endpoint.

Failure at any one gate is useful information. The present status of all three
is `blocked`.
