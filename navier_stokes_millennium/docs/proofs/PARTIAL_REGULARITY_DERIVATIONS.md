# Partial-Regularity Derivations

## Projection consequences of zero parabolic measure

Use the parabolic metric

$$
d_p((x,t),(y,s))=\max\{|x-y|,|t-s|^{1/2}\}.
$$

Suppose $\mathcal P^1(\Sigma)=0$. Given $\eta,\delta>0$, cover $\Sigma$
by parabolic balls of radii $r_i<\delta$ with $\sum_i r_i<\eta$.
Their spatial projections are covered by ordinary balls of radii $r_i$, so

$$
\mathcal H^1_\delta(\pi_x\Sigma)\leq C\sum_i r_i<C\eta.
$$

Hence $\mathcal H^1(\pi_x\Sigma)=0$, and every time slice
$\Sigma_t\subset\pi_x\Sigma$ has $\mathcal H^1(\Sigma_t)=0$.

The time projections are intervals of length at most $2r_i^2$. Therefore

$$
\mathcal H^{1/2}_{2\delta^2}(\pi_t\Sigma)
\leq C\sum_i(2r_i^2)^{1/2}
\leq C'\sum_i r_i<C'\eta.
$$

Letting $\eta,\delta\downarrow0$ gives
$\mathcal H^{1/2}(\pi_t\Sigma)=0$.

## Sharp limits of the CKN measure conclusion

Zero one-dimensional parabolic measure does not imply emptiness: a singleton
is nonempty and has zero $\mathcal P^1$ measure. More generally,
$C\times\{t_0\}$ has zero parabolic $\mathcal P^1$ measure whenever
$\mathcal H^1(C)=0$, even when $C$ is uncountable.

Nor does zero $\mathcal P^1$ measure imply parabolic dimension strictly less
than one. Here is an explicit construction. Start with one interval of length
$\ell_0=1$. At level $n$, retain two endpoint subintervals of length

$$
\ell_n=\frac{2^{-n}}{n+1}
$$

inside each level-$(n-1)$ interval. Since $2\ell_n<\ell_{n-1}$, this defines a
compact Cantor set $C$. Its level-$n$ cover has total length

$$
2^n\ell_n=\frac1{n+1}\longrightarrow0,
$$

so $\mathcal H^1(C)=0$.

To compute its dimension, give each level-$n$ interval mass $2^{-n}$. The
smallest gap between distinct level-$n$ intervals is

$$
g_n=\ell_{n-1}-2\ell_n
=\frac{2^{-(n-1)}}{n(n+1)}.
$$

If $\ell_n\leq r<\ell_{n-1}$, an interval of length $r$ meets at most
$2+r/g_n$ level-$n$ intervals. Its mass is therefore at most

$$
2^{-n}\left(2+\frac r{g_n}\right).
$$

For every $s<1$, division by $r^s$ and the bounds
$\ell_n\leq r<\ell_{n-1}$ show that both resulting terms are bounded by a
constant depending only on $s$: their worst factors are polynomial in $n$
times $2^{-n(1-s)}$. Hence $\mu(I)\leq C_s|I|^s$ for every interval $I$.
The mass-distribution principle gives $\dim_H C\geq s$ for every $s<1$;
therefore $\dim_H C=1$.

Embed $C$ in a fixed time slice. On that slice the parabolic and Euclidean
spatial metrics agree, so $C\times\{t_0\}$ has parabolic dimension one and
zero $\mathcal P^1$ measure. Thus the CKN conclusion permits a nonempty set of
parabolic dimension exactly one.

The vertical interval $\{x_0\}\times[a,b]$ is not a counterexample to these
claims: under the parabolic metric it has dimension two and therefore cannot
have zero $\mathcal P^1$ measure.
