# Multi-domain Fanout Iteration 001

**Status:** exploratory; no regularity theorem claimed.

Objective: run parallel framework probes outside the current frequency-first path, each with a falsifiable gate.

## Fanout tracks

### Track A: Physical-space concentration compactness at record centers

- **Question:** can one extract a minimal ancient profile from record-center rescalings with enough locality to force rigidity?
- **Target claim:** `PROFILE-COMPACTNESS-LOCAL` (`blocked`).
- **First gate:** prove tightness of localized pressure defects under the rescaling sequence.
- **Kill test:** construct a bounded-energy sequence where velocity profiles converge weakly but pressure defect fails compactness at the same scales.

### Track B: Vorticity-geometry depletion route

- **Question:** can geometric depletion of vortex stretching produce a scale-critical coercive bound near record scales?
- **Target claim:** `DEPLETION-TO-CRITICAL` (`blocked`).
- **First gate:** derive a quantitative inequality of the form
  $$(\omega\cdot\nabla u,\omega)_{Q_r}\le (1-\eta)\,\nu\|\nabla\omega\|_{L^2(Q_r)}^2+\text{controlled remainder}$$
  with explicit hypotheses that can be checked from suitable-solution data.
- **Kill test:** produce a smooth packeted flow with strong local alignment yet no usable reduction in the stretching term.

### Track C: Backward-uniqueness/Carleman route

- **Question:** can a Carleman-weighted argument rule out nontrivial critical ancient limits compatible with record-center blowup extraction?
- **Target claim:** `CARLEMAN-ANCIENT-RIGIDITY` (`blocked`).
- **First gate:** identify a weight and function class where lower-order transport/pressure terms are absorbable.
- **Kill test:** show the weight class forces assumptions stronger than the missing critical bound, making the route circular.

### Track D: Local energy defect-measure route

- **Question:** can one define a defect measure stronger than time-frequency bad-box counting that directly controls CKN cylinders?
- **Target claim:** `DEFECT-MEASURE-CKN-BRIDGE` (`blocked`).
- **First gate:** define a scale-invariant local measure with non-overcounting and pressure decomposition included.
- **Kill test:** exhibit a smooth example with vanishing proposed defect but arbitrarily large scale-invariant cubic velocity in the same cylinder.

### Track E: Data-to-solution robustness / quantitative continuation route

- **Question:** can verified finite-dimensional control inequalities be lifted to a genuine uniform continuation bound in the critical class?
- **Target claim:** `ROBUSTNESS-TO-CRITICAL-UNIFORM` (`blocked`).
- **First gate:** specify cutoff-uniform constants and a convergence theorem from controlled Galerkin trajectories to suitable solutions in the needed norm.
- **Kill test:** constants degrade with cutoff so that the limiting PDE statement is empty.

## Shared deliverable format

Each track should return one note with:

1. exact target lemma and hypotheses;
2. first unsupported inference;
3. smallest plausible repair;
4. one explicit falsification attempt.

## Prioritization (next round)

1. **Track D** (closest to existing phase-space machinery).
2. **Track A** (directly attacks record-center obstruction).
3. **Track C** (possible rigidity upgrade if A succeeds).
4. **Track B** (high upside, historically fragile assumptions).
5. **Track E** (important for certification, less likely to close core estimate alone).

## Disposition

Frequency-domain work remains active, but this fanout shifts the bottleneck search to five non-identical mechanisms. No track currently upgrades `LOCAL-L3-BOUND-DERIVATION` from `blocked`.
