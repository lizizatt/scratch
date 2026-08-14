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
