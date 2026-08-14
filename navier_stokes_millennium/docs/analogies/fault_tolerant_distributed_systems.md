# Fault-Tolerant Distributed Systems and Multiscale Control

**Status:** `refuted` as a transfer mechanism, 2026-08-13
**Primary-source count:** 6 works
**Verdict:** Reject the transfer. Quorum intersection preserves agreement among
replicas of one discrete value; Navier-Stokes shells are interacting degrees of
freedom, not replicas. The only exact PDE statement suggested by the analogy is
false, and repairing it requires an ordinary triadic flux estimate with no
remaining fault-tolerance mechanism.

## Claim ledger

| Claim | Status | Dependencies | Audit result |
|---|---|---|---|
| FTDS-1: intersecting crash-fault quorums preserve one chosen value only when acceptors also obey the Paxos proposal invariant | `established` | Lamport, P1, P2, P2b, P2c | Author copy checked against the stated asynchronous, non-Byzantine model. |
| FTDS-2: replicated-state safety in Raft follows from named log and election invariants, not majority overlap alone | `established` | Ongaro--Ousterhout, Figure 3 and Sections 5.3--5.4 | Official proceedings copy checked. |
| FTDS-3: agreement thresholds and impossibility conclusions depend on the exact failure and timing model | `established` | Lamport--Shostak--Pease, Theorems 1--2; Fischer--Lynch--Paterson, Theorem 1 | Author copies checked. |
| FTDS-4: self-stabilization requires closure of legitimate states and finite-time convergence under every allowed daemon choice | `established` | Dijkstra's definition and three constructions | Author archive transcription checked. |
| FTDS-PDE-1: a fixed-width overlap band absorbs every flux across a dyadic cutoff | `refuted` | Definition and checks below | Fails amplitude scaling and an explicit high-high-to-low partition. |

## Primary-source audit

1. **Lamport, “Paxos Made Simple” (2001), Sections 2.1--2.4.** In the
   asynchronous non-Byzantine model, agents may stop and restart; messages may
   be delayed, duplicated, or lost, but not corrupted. A value is chosen by a
   majority. Pairwise majority intersection is used inside the induction from
   P2c to P2b and P2, while P1a and persistent acceptor state constrain later
   proposals. Safety does not follow from intersection alone. The article has
   no numbered theorem and no article-specific DOI; the DOI sometimes attached
   to it, `10.1145/568425.568433`, is for the enclosing SIGACT column.
   [Author PDF](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf).

2. **Malkhi and Reiter, “Byzantine Quorum Systems” (1997/1998).** For universe
   $U$, fail-prone family $\mathcal B$, and quorum family $\mathcal Q$, the
   relevant strengthening of ordinary intersection is

   $$
   \forall Q_1,Q_2\in\mathcal Q\;\forall B\in\mathcal B,
   \qquad Q_1\cap Q_2\not\subseteq B,
   $$

   together with availability
   $\forall B\in\mathcal B\;\exists Q\in\mathcal Q:Q\cap B=\varnothing$.
   Thus an overlap must contain a nonfaulty member under every admissible fault
   set. The original is STOC '97, pp. 569--578,
   [doi:10.1145/258533.258650](https://doi.org/10.1145/258533.258650); the
   expanded journal version is *Distributed Computing* 11(4), 203--213,
   [doi:10.1007/s004460050050](https://doi.org/10.1007/s004460050050).
   Publisher metadata and the primary records were checked, but full theorem
   text was access-gated in this audit; no theorem number from this source is
   asserted or used below.

3. **Ongaro and Ousterhout, “In Search of an Understandable Consensus
   Algorithm” (USENIX ATC 2014), Figure 3.** The exact named properties are
   **Election Safety**, **Leader Append-Only**, **Log Matching**, **Leader
   Completeness**, and **State Machine Safety**. In particular, if one server
   applies an entry at an index, State Machine Safety says no server ever
   applies a different entry at that index. Section 5.4 obtains this through
   majority elections plus the up-to-date-log voting rule and current-term
   commit rule. Figure 8 explicitly shows that replica count alone can be
   insufficient for an old-term entry. [Official
   PDF](https://www.usenix.org/system/files/conference/atc14/atc14-paper-ongaro.pdf).

4. **Lamport, Shostak, and Pease, “The Byzantine Generals Problem” (1982).**
   The agreement conditions are IC1 (all loyal lieutenants obey the same order)
   and IC2 (a loyal commander's order is obeyed). Under oral-message assumptions
   A1--A3, Theorem 1 proves OM($m$) correct with more than $3m$ generals and at
   most $m$ traitors; the preceding three-general reduction supplies the
   matching impossibility at $3m$ or fewer. Under unforgeable-signature
   assumption A4, Theorem 2 proves SM($m$) correct with at most $m$ traitors.
   *TOPLAS* 4(3), 382--401.
   [Author PDF](https://lamport.azurewebsites.net/pubs/byz.pdf),
   [doi:10.1145/357172.357176](https://doi.org/10.1145/357172.357176).

5. **Fischer, Lynch, and Paterson, “Impossibility of Distributed Consensus with
   One Faulty Process” (1985), Theorem 1.** “No consensus protocol is totally
   correct in spite of one fault.” Here protocols are deterministic and fully
   asynchronous; an admissible run has at most one process taking finitely many
   steps and eventually delivers every message sent to a nonfaulty process.
   The theorem constructs an admissible nondeciding run from a bivalent initial
   configuration. It is a liveness impossibility, not a failure of agreement in
   every run. *JACM* 32(2), 374--382.
   [Author PDF](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf),
   [doi:10.1145/3149.214121](https://doi.org/10.1145/3149.214121).

6. **Dijkstra, “Self-stabilizing Systems in Spite of Distributed Control”
   (1974).** A legitimate state is closed under every possible move. A system
   is self-stabilizing iff, from every initial state and regardless of the
   central daemon's successive privilege choices, a privilege is always
   present and a legitimate state is reached after finitely many moves. The
   paper then supplies three concrete ring protocols; the definition by itself
   is not a convergence argument. *CACM* 17(11), 643--644.
   [Author archive](https://www.cs.utexas.edu/~EWD/transcriptions/EWD04xx/EWD426.html),
   [doi:10.1145/361179.361202](https://doi.org/10.1145/361179.361202).

## Exact translation dictionary

Work on $\mathbb T^3=(\mathbb R/2\pi\mathbb Z)^3$ with normalized measure. Let
$P_{\le N}$ be sharp Fourier projection to $|k|\le 2^N$ and
$P_j=P_{\le j}-P_{\le j-1}$. For a smooth mean-zero divergence-free field $v$,
define

$$
E_j(v)=\frac12\|P_jv\|_2^2,
\qquad
T_j(v)=\left|\left\langle P_jv,
 P_j\mathbb P\nabla\!\cdot(v\otimes v)\right\rangle\right|,
$$

and the explicitly declared “fault set”
$B_\eta(v)=\{j:T_j(v)>\eta\nu 2^{2j}\|P_jv\|_2^2\}$.

| Systems concept used in the transfer | Mathematical object | Defect in the identification |
|---|---|---|
| participant / acceptor | shell index $j\in\mathbb Z$ | A shell is a distinct coordinate, not a copy of one value. |
| replica state | truncation $P_{\le N}v$ and energy $\|P_{\le N}v\|_2^2/2$ | Different cutoffs intentionally contain different states. |
| proposal or log entry | claimed value of the cross-cutoff flux $\Pi_N(v)$ | Flux is generated continuously by triads; nobody selects or persists it. |
| quorum at cutoff $N$ | fixed boundary band $Q_{N,r}=\{N-r,\ldots,N+r\}$ | Cardinality has no analytic weight and is not preserved by concentration. |
| Byzantine member | shell $j\in B_\eta(v)$ whose transfer is not absorbed locally | There is no a priori bound on the number or density of such shells. |
| Byzantine quorum intersection | $(Q\cap Q')\setminus B_\eta(v)\ne\varnothing$ | One controlled shell gives no bound on the other triadic factors. |
| agreement / state-machine safety | one uniform bound for all cutoff balances, strong enough to control $\sup_t\|u(t)\|_3$ | Equality of replicated values is replaced by a missing quantitative estimate. |
| term and leader | a chosen time slab and active cutoff $N(t)$ | Navier-Stokes supplies no election rule that makes this cutoff coercive. |
| append-only stable state | cumulative dissipation $\nu\int_0^t\|\nabla u\|_2^2\,ds$ | Its monotonicity is exactly the existing energy identity. |
| asynchronous adversary / partition | worst-case placement and phasing of Fourier triads across a chosen shell partition | PDE time evolution has no message scheduler; only the estimate is adversarial. |
| legitimate set | $\mathcal L_M=\{v:\|v\|_3\le M\}$ | No known energy-class argument makes this set absorbing or invariant. |
| daemon move and stabilization | exact Navier-Stokes evolution, and finite-time entry into and closure of $\mathcal L_M$ | Dijkstra's protocols provide special transition rules; the PDE does not inherit them. |

## The one candidate PDE lemma

Define the nonlinear energy influx into the low modes by

$$
\Pi_N(v)=-\left\langle P_{\le N}v,
 P_{\le N}\mathbb P\nabla\!\cdot(v\otimes v)\right\rangle.
$$

**FTDS-PDE-1 (quorum-band absorption, candidate).** There exist a fixed
$r\in\mathbb N$ and $0<\eta<1$, independent of $v$ and $N$, such that every
smooth mean-zero divergence-free trigonometric polynomial $v$ and every
$N\ge r+2$ satisfy

$$
\boxed{
|\Pi_N(v)|\le
\eta\nu\sum_{j=N-r}^{N+r}2^{2j}\|P_jv\|_2^2.}
\tag{Q}
$$

This is the strongest literal quorum transfer worth testing: a fixed overlap
band would certify and viscously absorb every transaction crossing a cutoff.
If (Q) were true, it would be a real PDE mechanism rather than an analogy.

### Scaling check

For the periodic Navier-Stokes scaling
$v^{(m)}(x)=2^m v(2^m x)$ with $m\in\mathbb N_0$, shift the cutoff from $N$ to
$N+m$. Then

$$
|\Pi_{N+m}(v^{(m)})|=2^{4m}|\Pi_N(v)|,
\qquad
\sum_{j=N-r}^{N+r}2^{2(j+m)}
 \|P_{j+m}v^{(m)}\|_2^2
=2^{4m}\sum_{j=N-r}^{N+r}2^{2j}\|P_jv\|_2^2.
$$

Thus (Q) passes equation scaling; no gain appears. Under independent amplitude
scaling $v\mapsto Av$, however, its left side is $A^3|\Pi_N(v)|$ and its right
side is $A^2$ times the original band dissipation. Any example with nonzero
flux violates (Q) for sufficiently large $A$. Quorum cardinality supplies no
amplitude smallness.

### Adversarial-partition check

The failure is stronger than amplitude scaling. Fix $r$, choose $N\ge r+2$,
and take an integer $M>2^{N+r+1}$. With

$$
k=(1,0,0),\quad p=(0,M,0),\quad q=k-p=(1,-M,0),
$$

set $a=e_2$, $b=e_1$, $c=e_1+M^{-1}e_2$ and

$$
v_M(x)=-2a\sin x_1+2b\cos(Mx_2)
       +2c\cos(x_1-Mx_2).
$$

The checks $k\cdot a=p\cdot b=q\cdot c=0$ make $v_M$ divergence-free. Its
only low modes are $\pm k$ and its other modes lie above $2^{N+r}$, so

$$
P_jv_M=0\quad(N-r\le j\le N+r).
$$

Nevertheless $p+q=k$. At the $k$ mode, the two ordered high-high interactions
give

$$
i\big[(b\cdot q)c+(c\cdot p)b\big]=i(b+c),
\qquad a\cdot(b+c)=M^{-1}.
$$

The conjugate mode contributes equally, so with normalized torus measure
$|\Pi_N(v_M)|=2/M>0$, while the right side of (Q) is zero. A high-high-to-low
triad therefore jumps an arbitrarily wide empty “quorum” band. This explicitly
refutes FTDS-PDE-1.

## Disposition

- **Quorum intersection:** rejects. Set overlap contains no coercivity, sign,
  amplitude, or summability information. Byzantine intersection is even less
  transferable because no independent fail-prone family bounds bad shells.
- **Replicated-state invariants:** rejects. Raft's servers reproduce one ordered
  log; frequency shells exchange energy and are not required to agree. Mapping
  stable storage to cumulative dissipation merely renames the energy identity.
- **Agreement impossibility:** rejects. The Byzantine and FLP theorems are
  model-relative statements about faulty processes, message timing, and
  termination. Navier-Stokes has neither independent process faults nor an
  asynchronous scheduler, so they imply no PDE obstruction.
- **Self-stabilization:** rejects. Dijkstra proves convergence by special local
  update rules. A PDE transfer would need a new Lyapunov or contraction estimate
  making a critical regularity set absorbing and invariant; the framework does
  not provide one.

Any repair of (Q) must include the omitted high-frequency tail, the amplitudes
and phases of all interacting triads, and dyadic summability. That is precisely
an ordinary Fourier/Littlewood--Paley energy-flux estimate. Fault-tolerance
terminology adds no mechanism beyond that estimate, so this lost-mode branch is
closed as `refuted`, not promoted to a Navier-Stokes proof obligation.
