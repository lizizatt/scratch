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
