# Checked Counterexamples

## Energy class does not uniformly control a Serrin class

Let $\phi\in C_c^\infty(\mathbb R^3;\mathbb R^3)$ be nonzero and
divergence-free, and let $\chi\in C_c^\infty(0,1)$ be nonzero. For
$\lambda\to\infty$, set

$$
v_\lambda(t,x)=\lambda^{3/2}\phi(\lambda x)\chi(\lambda^2t).
$$

Then

$$
\|v_\lambda\|_{L^\infty_tL^2_x}=O(1),\qquad
\|\nabla v_\lambda\|_{L^2_{t,x}}=O(1),
$$

but

$$
\|v_\lambda\|_{L^\infty_tL^3_x}
=\lambda^{1/2}\|\phi\|_3\|\chi\|_\infty\to\infty.
$$

More generally,

$$
\|v_\lambda\|_{L^s_tL^r_x}
=C_{\phi,\chi}\lambda^{3/2-2/s-3/r}.
$$

For every Serrin pair $2/s+3/r\leq1$, the exponent is at least $1/2$.
Thus no estimate of any Serrin norm can depend only on the two energy norms
with a scale-independent bound.

Each $v_\lambda$ is smooth and belongs to every finite mixed-norm class; this
family refutes uniform control, not literal set membership. These fields are
not asserted to solve Navier-Stokes; the counterexample targets only an
estimate inferred from the energy bounds alone.

## Constant ancient solution

For any nonzero constant vector $c$, the pair

$$
u(x,t)=c,\qquad p(x,t)=0
$$

is a smooth bounded ancient solution of the unforced incompressible
Navier-Stokes equations on $\mathbb R^3\times(-\infty,0)$. It refutes the
unqualified statement that every bounded ancient solution in full three
dimensions is zero. It does not contradict $L^3$ Liouville theorems because a
nonzero constant is not in $L^3(\mathbb R^3)$.

## Forced nonuniqueness does not establish Clay C

The forced nonuniqueness theorem reviewed in
`docs/research/raw/01_problem_foundations.md` uses a force singular at the
initial time and proves multiplicity of suitable Leray-Hopf solutions. Clay C
requires smooth rapidly decreasing data and force and the nonexistence of any
accepted global smooth solution. Failing both the force hypothesis and the
logical conclusion refutes the implication from that theorem to Clay C.

## Energy interpolation does not give a uniform local L3 bound

Let $\phi\in C_c^\infty(B_1;\mathbb R^3)$ be nonzero and divergence-free,
let $\kappa=12\nu\|\nabla\phi\|_2^2/\|\phi\|_2^2$, and set
$\rho(t)=\sqrt{\kappa(T-t)}$. Define

$$
w(x,t)=A\,\rho(t)^{-4/3}\,\phi(x/\rho(t)).
$$

The choice of $\kappa$ makes $w$ satisfy the exact scalar energy identity
$\tfrac12\tfrac d{dt}\|w(t)\|_2^2+\nu\|\nabla w(t)\|_2^2=0$, so
$m_R(t):=\sup_a\int_{B_R(a)}|w|^3\in L^{4/3}(0,T)$, matching the bound that
energy plus Serrin interpolation actually supplies. Nevertheless, once
$\rho(t)<R$,

$$
m_R(t)\ge\int_{B_R}|w|^3=A^3\|\phi\|_3^3\,\rho(t)^{-1}\to\infty
\qquad(t\uparrow T).
$$

Thus $m_R\in L^{4/3}_t$ but $m_R\notin L^\infty_t$: the exact energy law is
compatible with an unbounded local $L^3$ mass at every fixed radius near $T$.
This field is not asserted to solve the full Navier-Stokes system; it refutes
only the inference from the energy inequality and Serrin-type interpolation to
the local $L^3$ hypothesis of `LOCAL-L3-CONTINUATION`
(`docs/proofs/LOCAL_L3_CONTINUATION.md`).

## CKN singular-set smallness does not give a uniform local L3 bound

Let $\phi\in C_c^\infty(B_1;\mathbb R^3)$ be nonzero, divergence-free, with
$\phi(0)\neq0$, and set $\tau=T-t$, $\ell(t)=c\sqrt\tau$ for
$c^2\ge8\|\nabla\phi\|_2^2/\|\phi\|_2^2$. Define

$$
w(x,t)=\ell(t)^{-5/4}\phi(x/\ell(t)).
$$

Then $w\in L^\infty_tL^2_x\cap L^2_t\dot H^1_x$ and satisfies the scalar
energy inequality $\tfrac d{dt}\|w(t)\|_2^2+2\|\nabla w(t)\|_2^2\le0$. Its
terminal singular set at $t=T$ is the single point $x=0$, so it has zero
$\mathcal H^1$ measure, matching CKN's partial-regularity conclusion.
Nevertheless, for every fixed $R,\delta>0$,

$$
\operatorname*{ess\ sup}_{T-\delta<t<T}\int_{B_R(0)}|w(x,t)|^3\,dx=\infty,
$$

and the CKN cubic quantity centered at the singular point diverges,
$\rho^{-2}\iint_{Q_\rho(0,T)}|w|^3\gtrsim\rho^{-3/4}\to\infty$. Thus
Hausdorff-measure-zero singular-set geometry is fully compatible with an
unbounded local $L^3$ mass exactly at the singular center. This field
satisfies only the scalar energy inequality, not the full suitable-solution
hypotheses (pressure, the distributional Navier-Stokes equations, and the
local energy inequality) behind PR-07's actual theorem; it refutes only the
narrower inference from singular-set-measure-zero geometry alone to the local
$L^3$ hypothesis of `LOCAL-L3-CONTINUATION`, not PR-07 itself and not a
Navier-Stokes solution.

## Zero nonlinear flux does not imply CKN smallness

On the three-torus, choose $a,k\in\mathbb R^3$ with $a\cdot k=0$, $|a|=1$,
and define

$$
u_A(x,t)=A e^{-\nu|k|^2(t+t_0)}a\cos(k\cdot x),
\qquad p(x,t)=0,
$$

for $t_0>0$. This is a smooth divergence-free Navier-Stokes solution because

$$
(u_A\cdot\nabla)u_A=0,
\qquad
\partial_tu_A-\nu\Delta u_A=0.
$$

Every quadratic Fourier interaction vanishes: each factor contains the
polarization contraction $a\cdot k=0$. Therefore every nonlinear shell flux
and every strict bad-event indicator based only on that flux is zero, with no
pressure remainder.

Nevertheless, take a parabolic cylinder centered where $\cos(k\cdot x)$ is
near one and choose $|k|r\leq 1/3$. Its scale-invariant cubic velocity
quantity obeys

$$
r^{-2}\iint_{Q_r}|u_A|^3
\geq c\,(Ar)^3
$$

for a fixed $c>0$. Choosing $Ar$ sufficiently large violates the CKN
smallness threshold while the flux-indicator measure and pressure defect stay
zero. Thus a zero-bad-flux condition alone cannot imply the CKN epsilon
criterion. This refutes only the flux-only bridge; it does not refute a future
defect functional that explicitly controls absolute velocity, pressure, and
localization errors.
