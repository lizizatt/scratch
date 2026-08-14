# Foundational Derivations

These short proofs support internal `proved` claims in `artifacts/claims.json`.
They do not prove global Navier-Stokes regularity.

## Mixed-norm scaling

Let

$$
u_\lambda(x,t)=\lambda u(\lambda x,\lambda^2t)
$$

and let $I_\lambda=\{t:\lambda^2t\in I\}$. For finite $s,r$,

$$
\begin{aligned}
\|u_\lambda\|_{L^s(I_\lambda;L^r)}^s
&=\int_{I_\lambda}
\left(\int_{\mathbb R^3}
|\lambda u(\lambda x,\lambda^2t)|^r\,dx\right)^{s/r}dt\\
&=\lambda^{s(1-3/r)-2}
\|u\|_{L^s(I;L^r)}^s.
\end{aligned}
$$

Thus

$$
\|u_\lambda\|_{L^s_tL^r_x}
=\lambda^{1-2/s-3/r}\|u\|_{L^s_tL^r_x}.
$$

When $s=\infty$ or $r=\infty$, the same formula follows by replacing the
corresponding integral with an essential supremum. At $(s,r)=(\infty,3)$ the
exponent is zero. At $(s,r)=(\infty,2)$ it is $-1/2$, agreeing with a direct
spatial change of variables.

## Energy interpolation line

The energy class and Sobolev embedding give

$$
u\in L^\infty_tL^2_x\cap L^2_tL^6_x.
$$

Complex or real interpolation with $0\leq\theta\leq1$ yields

$$
\frac1s=\frac\theta2,
\qquad
\frac1r=\frac{1-\theta}{2}+\frac\theta6
=\frac12-\frac\theta3.
$$

Every pair on this interpolation line therefore has

$$
\frac2s+\frac3r
=\theta+\frac32-\theta
=\frac32>1.
$$

No interpolation between these two energy endpoints reaches the
Ladyzhenskaya-Prodi-Serrin region $2/s+3/r\leq1$.

## Whole-space equation and Sobolev scaling

For

$$
u_\lambda(x,t)=\lambda u(\lambda x,\lambda^2t),\quad
p_\lambda(x,t)=\lambda^2p(\lambda x,\lambda^2t),\quad
f_\lambda(x,t)=\lambda^3f(\lambda x,\lambda^2t),
$$

each term in

$$
\partial_tu+(u\cdot\nabla)u+\nabla p=\nu\Delta u+f
$$

acquires the factor $\lambda^3$, while
$\nabla\cdot u_\lambda=\lambda^2(\nabla\cdot u)(\lambda x,\lambda^2t)$.
Thus the whole-space equation and divergence constraint are invariant.

At a fixed time, Fourier scaling or a change of variables gives

$$
\|u_\lambda(t)\|_{\dot H^s}
=\lambda^{s-1/2}\|u(\lambda^2t)\|_{\dot H^s}.
$$

At $s=0$ this is the $L^2$ law $\lambda^{-1/2}$; at $s=1/2$ the
exponent vanishes. Both endpoint checks disconfirm a reversed sign.

## Smooth energy identity

For a smooth, divergence-free, sufficiently decaying solution with
$f\cdot u\in L^1_x$, take
the $L^2$ inner product of

$$
\partial_tu+(u\cdot\nabla)u+\nabla p=\nu\Delta u+f
$$

with $u$. Integration by parts gives

$$
\langle(u\cdot\nabla)u,u\rangle
=\frac12\int u\cdot\nabla|u|^2=0,
\qquad
\langle\nabla p,u\rangle=-\int p\,\nabla\cdot u=0,
$$

and $\langle\Delta u,u\rangle=-\|\nabla u\|_2^2$. Hence

$$
\frac12\frac d{dt}\|u(t)\|_2^2
+\nu\|\nabla u(t)\|_2^2=\int_{\mathbb R^3}f\cdot u\,dx.
$$

The unforced identity used in the Clay-A dependency chain is the special case
$f=0$.

The decay or periodic boundary hypotheses are load-bearing: without them the
discarded boundary terms need not vanish.

## Compact similarity-orbit corollary

Let $v$ be a mild ancient whole-space solution and define

$$
K=\left\{\sqrt{-t}\,v(\sqrt{-t}\,\cdot,t):t<0\right\}
\subset L^3(\mathbb R^3).
$$

If $K$ is precompact, it is bounded. Mixed-norm scaling at
$(s,r)=(\infty,3)$ gives

$$
\left\|\sqrt{-t}\,v(\sqrt{-t}\,\cdot,t)\right\|_3
=\|v(t)\|_3.
$$

Choose any $t_k\downarrow-\infty$. Then
$\sup_k\|v(t_k)\|_3<\infty$, so Albritton-Barker Theorem 1.2 implies
$v\equiv0$. Constant fields do not contradict the statement because nonzero
constants are not in $L^3(\mathbb R^3)$.
