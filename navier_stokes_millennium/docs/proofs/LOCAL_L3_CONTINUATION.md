# Local Uniform L3 Continuation Criterion

## Statement

Let $u$ be a whole-space mild Navier-Stokes solution on $[0,T)$ from smooth
rapidly decreasing data, with $T<\infty$ maximal. Suppose that for some
$R,\delta>0$,

$$
M_R:=\operatorname*{ess\ sup}_{T-\delta<t<T}
\sup_{a\in\mathbb R^3}\int_{B_R(a)}|u(x,t)|^3\,dx<\infty.
$$

Then $T$ is not a singular endpoint.

## Proof

Assume instead that $T$ is a finite singular endpoint. By KNSS Lemma 6.1 and
Proposition 6.1, applied to the record-point rescalings of the mild solution,
there are points $(x_n,t_n)$, scales $r_n\downarrow0$, and rescaled solutions

$$
 v_n(y,s)=r_nu(x_n+r_n y,t_n+r_n^2s)
$$

which converge locally uniformly, after a subsequence, to a nonzero mild
ancient solution $v$ on $\mathbb R^3\times(-\infty,0)$, with
$|v(0,0)|=1$.

Fix any $s<0$ and $L>0$. For all sufficiently large $n$,
$t_n+r_n^2s\in(T-\delta,T)$ and $Lr_n<R$. Critical change of variables gives

$$
\int_{B_L}|v_n(y,s)|^3dy
=
\int_{B_{Lr_n}(x_n)}|u(x,t_n+r_n^2s)|^3dx
\le M_R.
$$

Local uniform convergence implies convergence in $L^3(B_L)$, hence

$$
\int_{B_L}|v(y,s)|^3dy\le M_R.
$$

Letting $L\to\infty$ yields

$$
\|v(s)\|_{L^3(\mathbb R^3)}^3\le M_R
\qquad\text{for every fixed }s<0.
$$

In particular, for $s_k=-k$,
$\sup_k\|v(s_k)\|_3\le M_R^{1/3}$. The established
Albritton--Barker Liouville theorem then gives $v\equiv0$, contradicting
$|v(0,0)|=1$. Therefore no finite singular endpoint exists. ∎

## Scope

This is a conditional continuation theorem. It does not derive $M_R<\infty$
from the Leray energy bounds. It is therefore strictly weaker as a target than
`CRITICAL-BOUND`, but still requires a new uniform local critical estimate over
all spatial centers near the endpoint.

The proof uses the pressure-free mild formulation in the KNSS profile theorem;
no independent global pressure-tail estimate is needed for this conditional
criterion. The criterion is not a CKN smallness statement: boundedness of
$M_R$ supplies a Liouville contradiction after rescaling rather than direct
one-scale epsilon smallness.
