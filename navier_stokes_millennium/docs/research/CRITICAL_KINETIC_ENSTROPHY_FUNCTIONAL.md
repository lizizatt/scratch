# Critical Kinetic-Enstrophy Functional

**Date:** 2026-08-18
**Status:** blocked; structural candidate only.

## Candidate

Let $\omega=\nabla\times u$, let $\chi_{a,R}$ equal one on $B_R(a)$ and
vanish outside $B_{2R}(a)$, and let $\ell$ be the record length
$\ell=M^{-1}$. Define

$$
\Phi_{\ell,R,a}(t)
=\frac{1}{2\ell}\int\chi_{a,R}|u|^2\,dx
 +\frac{\alpha\ell}{2}\int\chi_{a,R}|\omega|^2\,dx,
\qquad \alpha>0.
$$

The first term dominates the target quantity on $B_R(a)$:
$\Phi_{\ell,R,a}\geq (2\ell)^{-1}\int_{B_R(a)}|u|^2$. The enstrophy term
is included to expose and potentially absorb vortex stretching rather than to
replace the local kinetic energy.

## Critical scaling

Under

$$
 u_\lambda(x,t)=\lambda u(\lambda x,\lambda^2t),
 \qquad \omega_\lambda(x,t)=\lambda^2\omega(\lambda x,\lambda^2t),
$$

with $\ell\mapsto\ell/\lambda$ and $R\mapsto R/\lambda$, both terms are
invariant. In record variables $v(y,s)=\ell u(a+\ell y,t+\ell^2s)$,
$L=R/\ell$, the functional is

$$
\Phi=\frac12\int\chi_{0,L}|v|^2\,dy
 +\frac{\alpha}{2}\int\chi_{0,L}|\nabla_y\times v|^2\,dy.
$$

Thus $L\to\infty$ is the required expanding-ball limit.

## Formal evolution identity

For a smooth solution of
$\partial_tu+(u\cdot\nabla)u-\nu\Delta u+\nabla p=0$, direct integration by parts gives

$$
\begin{aligned}
\dot\Phi={}&-\frac{\nu}{\ell}\int\chi|\nabla u|^2
-\alpha\nu\ell\int\chi|\nabla\omega|^2
+\frac{\nu}{2\ell}\int|u|^2\Delta\chi \\
&+\frac1\ell\int\left(\frac{|u|^2}{2}+p\right)u\cdot\nabla\chi
+\alpha\ell\int\chi\,\omega\cdot S\omega \\
&+\frac{\alpha\ell}{2}\int|\omega|^2u\cdot\nabla\chi
+\frac{\alpha\nu\ell}{2}\int|\omega|^2\Delta\chi,
\end{aligned}
$$

where $S=(\nabla u+\nabla u^\mathsf T)/2$. The terms supported in the
annulus $B_{2R}(a)\setminus B_R(a)$ are the tail remainder.

The interior stretching term can be rewritten using $\nabla\cdot\omega=0$:

$$
\int\chi\,\omega\cdot S\omega
=-\int\chi\,u\cdot(\omega\cdot\nabla)\omega
-\int(u\cdot\omega)(\omega\cdot\nabla\chi).
$$

Using $|u|\leq\gamma/\ell$ on the relevant KNSS backward interval and
Young's inequality, the first term can absorb part of
$\alpha\nu\ell\int\chi|\nabla\omega|^2$ at the cost of

$$
C\frac{\alpha\gamma^2}{\nu\ell}\int\chi|\omega|^2,
$$

which is comparable to the kinetic dissipation because
$\|\omega\|_2\lesssim\|\nabla u\|_2$ after localization, up to further annular
terms. Choosing $\alpha$ sufficiently small relative to $\nu^2$ gives a
conditional interior absorption. This is the genuine gain over the bare
kinetic identity.

## First missing lemma

The required new statement is an annular-tail estimate, uniform over the KNSS
sequence and fixed profile times:

$$
\mathcal R_{k,j}
\leq c\left(\frac{\nu}{\ell_k}\int\chi_k|\nabla u|^2
+\alpha\nu\ell_k\int\chi_k|\nabla\omega|^2\right)+C,
$$

where $\mathcal R_{k,j}$ contains the cutoff transport, pressure, diffusion,
and vorticity-stretching boundary terms at
$\tau_{k,j}=t_k+\ell_k^2s_j$. This estimate must hold with constants uniform in
$k$ and $j$ and must be strong enough to bound $\Phi_{\ell_k,R_k,a_k}$ on
expanding record-scale balls.

Finite energy does not provide this: the pressure term is nonlocal, the
transport term is cubic, and annular estimates naturally produce only
spacetime or good-time bounds.

## Kill test

Take the exact smooth periodic shear

$$
 u_A(x,t)=Ae^{-\nu N^2t}e_1\cos(Nx_2),\qquad p=0.
$$

It has zero convection, pressure, and vortex stretching. Yet if
$\ell=A^{-1}$ and $R=L/A$ with $L\to\infty$, the functional grows like
$L^3$ on the expanding rescaled ball while its dissipation is only the linear
viscous decay. Therefore no universal inequality of the form
$\ell^2\dot\Phi+c\Phi\leq C$ can hold for arbitrary smooth flows based only on
local flux and dissipation. This is not a counterexample to the endpoint
anti-concentration target, because the shear is periodic and not a singular
finite-energy record sequence; it is a stress test against overstrong
coercivity.

## Disposition

The candidate is **critical** and has a conditional **interior coercive**
component, but the required fixed-time annular-tail lemma is exactly the
remaining anti-concentration problem. The functional is therefore blocked,
not proved or refuted. Its useful contribution is diagnostic: any successful
functional must control the absolute annular velocity/pressure tail, not only
vortex stretching or nonlinear flux.
