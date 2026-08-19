# Frequency Packing Sharpening Audit

**Date:** 2026-08-19
**Disposition:** the combined `FREQ-PACKING` conjecture is blocked as
underspecified; occupancy-only packing is insufficient for regularity.

## Current claim problem

The existing `FREQ-PACKING` statement allows a solution-dependent constant and
says that bad boxes may include unspecified spatial and pressure terms. That is
not a single falsifiable lemma. It mixes at least three claims:

1. a pure frequency-time occupancy estimate;
2. a pressure/space-localized packing estimate; and
3. a bridge from packing to a regular CKN scale and then continuation.

These must be separated before a proof or counterexample can be meaningful.

## Exact occupancy stress test

Take nested bad intervals

$$
\tau_j=4^{-j},\qquad B_j=(-\tau_j,0),
$$

and charge each interval by its lifetime. On the parent interval $I=(-1,0)$,

$$
\frac{1}{|I|}\sum_{j=0}^{K}|B_j|
=\sum_{j=0}^{K}4^{-j}<\frac43.
$$

The exact computation for depths $1,4,16,64$ gives charges approaching
$4/3$ from below. Thus a uniformly bounded Carleson occupancy norm is
compatible with one bad event at every nested scale. Occupancy controls total
branching/measure, not depth along a single concentration chain.

This does not construct a Navier--Stokes solution. It refutes only the logical
bridge “bounded occupancy implies a regular scale” when no amplitude, pressure,
or persistence term is included.

## Exact shear stress test

The smooth periodic shear

$$
 u_A(x,t)=A e^{-\nu N^2t}e_1\cos(Nx_2),\qquad p=0,
$$

has zero nonlinear flux and zero pressure defect. Nevertheless, on any finite
nested family of sufficiently large parabolic cylinders with $Nr\leq1/3$,
its scale-invariant cubic velocity quantity satisfies

$$
 r^{-2}\iint_{Q_r}|u_A|^3\gtrsim (Ar)^3.
$$

Choosing the amplitude relative to the smallest tested radius makes every
member of that finite family CKN-nonsmall while the occupancy indicator remains
zero. This kills any flux/pressure-only packing-to-CKN bridge based on finite
local energy alone. It is not a singular whole-space counterexample.

## Sharpened live statement

The only worthwhile surviving formulation is a fixed, cutoff-uniform lemma of
the form

$$
\sup_N\operatorname{Car}_{\theta,N}(u^N)
\leq F(X(u_0,\nu)),
$$

with $\theta$, the data functional $X$, the parabolic boxes, pressure term, and
solution approximation fixed in advance. This is a flux/occupancy theorem only;
it has no regularity consequence until a separate bridge adds absolute velocity
amplitude, pressure tails, and fixed-profile persistence.

A successful regularity bridge would need to charge at least one of:

- absolute local velocity concentration;
- pressure/harmonic tails;
- persistence at prescribed KNSS profile times; or
- a sign-definite defect that dominates all three.

Adding those charges makes the desired statement close to
`LOCAL-L2-ANTI-CONCENTRATION` itself, so it is not a shortcut unless a new
coercive inequality is supplied.

## Status change

`FREQ-PACKING` is downgraded from `conjectured` to `blocked` as a combined
regularity route: its statement requires quantifier repair, and the occupancy-
to-regular-scale bridge is false without additional amplitude information. A
separate, fully quantified occupancy-only conjecture may remain as a harmonic-
analysis question, but it is not currently a Navier--Stokes regularity route.
