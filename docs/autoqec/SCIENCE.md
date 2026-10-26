# QRecall AutoQEC — scientific documentation

This document specifies every model, decision rule and statistic used by AutoQEC, and states which
claims are and are not supported. Numbers quoted here are produced by the code in this repository and
recorded (with seeds, versions and hashes) in `results/`.

---

## 1. Module 1 — three-qubit bit-flip repetition code (simulation)

### 1.1 Code and conventions

* Logical state `|ψ_L⟩ = α|000⟩ + β|111⟩`, prepared by `U(θ, φ)` on `d0` followed by `CX d0→d1`, `CX d0→d2`.
* Stabilizers `S1 = Z0 Z1`, `S2 = Z1 Z2`. A measured eigenvalue `+1` is syndrome bit `0`; `−1` is bit `1`.
  Syndromes are written `s1 s2`; X-error patterns `e0 e1 e2` (qubit 0 first).
* Parity-check matrix `H = [[1,1,0],[0,1,1]]`, predicted syndrome `s(e) = H e mod 2`.

| Error | Syndrome |
|---|---|
| none | 00 |
| X on qubit 0 | 10 |
| X on qubit 1 | 11 |
| X on qubit 2 | 01 |

The benchmarks generalize to distance `n ∈ {3, 5, 7}` with checks `Z_j Z_{j+1}`.

**Scope boundary.** The bit-flip code corrects one X error. Z errors commute with both checks, give
syndrome `00` and act as a logical phase flip; the lab lets you inject them to show this limitation.

### 1.2 Noise model

Independent Bernoulli X flips with probability `p_i` per data qubit and independent flips of each
recorded syndrome bit with probability `q_j`. Each seed is expanded with `numpy.random.SeedSequence`
into separate streams for data and readout, so changing `q` never changes which data qubits flip.
Readout errors are drawn in the circuit as an X on the ancilla immediately before its measurement.
The decoder receives only the observed syndrome and a *declared* model, which may differ from the
simulated noise (model mismatch is a first-class experiment).

### 1.3 Energy (negative log-likelihood) decoder

For candidate `e` and observed syndrome `y`, the readout pattern needed to explain `y` is
`d = y ⊕ s(e)` and

```
E(e | y) = −Σ_i [e_i ln p_i + (1−e_i) ln(1−p_i)] − Σ_j [d_j ln q_j + (1−d_j) ln(1−q_j)]  =  −ln P(e, d)
```

All `2^n` candidates are enumerated exactly. For each the backend returns the predicted syndrome, the
readout pattern, the data and readout energy terms, the total energy, the rank, the model posterior
`P(e|y) ∝ exp(−E)` and (in simulation) what would happen if it were applied as the correction.
Probabilities of exactly 0 are hard constraints: candidates that would need an impossible event get
infinite energy and are labelled impossible. Ties break on energy (rounded to 1e−12), then Hamming
weight, then the binary string.

`ΔE = E₍₂₎ − E₍₁₎` is reported as a **model-based ambiguity indicator** (the runner-up is `exp(−ΔE)` times
as probable under the declared model). It is not a calibrated probability of successful recovery.

### 1.4 Recovery convention and degeneracy

Success is judged on the residual `r = e ⊕ ê` after an **ideal final round** (noiseless data readout +
majority vote), the convention of memory experiments and of the circuit's coherent majority verifier
(`CX, CX, CCX, U†`):

* `r = 000` — the codeword is restored;
* `weight(r) ≤ (n−1)/2` — the logical value is preserved but a residual remains for the next round;
* otherwise — a logical bit flip `X̄`.

We deliberately do **not** use an even/odd-weight rule (reading `Z̄ = Z0Z1Z2`), which would classify a
single leftover flip as a logical error and two flips as harmless. Because several error patterns
lead to the same logical outcome, we report for every decision the logical-class probabilities
`P(keep | y)` and `P(flip | y)` and the logical margin `ln P(keep) − ln P(flip)`, and we flag whether the
runner-up candidate is logically equivalent to the winner (pattern ambiguity) or not (logical ambiguity).

### 1.5 Decoders compared

| Decoder | Rule |
|---|---|
| None | No active correction (the ideal final round still majority-votes). |
| Lookup | Trusts the syndrome; minimum-weight table correction. |
| Energy | Minimum-energy (most probable) explanation, including readout errors. |
| Exact reference | Pure-Python enumeration with direct probability products; maximizes `P(logical value survives | y)`; ties prefer higher exact-restoration probability. |

The exact reference is a correctness oracle for the tiny model; it is not evidence of novelty. It can
legitimately differ from the energy decoder when several less likely explanations share a logical
outcome (e.g. `p = 0.1, q = 0.05, y = 10`: energy picks `100`, the reference picks `000`, because
leaving the data alone keeps the logical value in 93.1% vs 89.9% of the posterior).

### 1.6 Circuits

The lab circuit is built with Qiskit and stepped instruction by instruction with `Statevector`
(projective measurements are deterministic for Pauli errors; otherwise a seeded branch is reported with
its probability). Two correction styles implement the same decision: classical feed-forward
(`if_test` blocks with X gates) and a Pauli-frame update applied in software to a Z-basis readout.
Metrics recurse into control-flow blocks. The transpiled circuit targets basis `{rz, sx, x, cx}` on a
5-qubit line or a 7-qubit H-shaped graph. An independent Aer run cross-checks every circuit.

### 1.7 Resource-aware circuit selection

Logical task (identical for every candidate): one QEC cycle of the 3-qubit memory for `|0_L⟩` and
`|1_L⟩`, decoded in software with the lookup Pauli frame and majority readout. Candidates vary the
syndrome-extraction family (two ancillas sequential/interleaved, or one ancilla reused with mid-circuit
measurement and reset) and Qiskit transpiler settings (optimization level 0–3, layout trivial/dense/sabre,
routing basic/sabre, two seeds). Identical compiled circuits are merged (144 compilations → 59 unique on
the H graph).

Each candidate is verified in noiseless simulation for both logical inputs and every single-X
injection, and its logical failure `p_L` is estimated with Aer under one declared model (depolarizing
`p1` on 1-qubit gates, `p2` on CX, `p_idle` per idle layer slot via explicit `id` markers, readout error
`p_meas`) with Wilson intervals. Selection applies hard constraints first (`Q ≤ Qmax`, `G2 ≤ G2max`,
`D ≤ Dmax`, `p_L ≤ p_Lmax`, optionally on the 95% upper bound), then minimizes

```
J(c) = w_Q · Q/Q_ref + w_G · G2/G2_ref + w_D · D/D_ref
```

with references from the documented baseline (two ancillas, sequential, opt level 0, trivial layout,
basic routing, seed 11). Pareto flags use (Q, G2, D, p_L). Duration is a critical-path estimate from
declared gate times, distinct from depth. This is a modeling analysis, not hardware validation, and it
is a different problem from decoding.

**FLASQ.** Google's FLuid Allocation of Surface code Qubits cost model (Huggins et al., arXiv:2511.08508,
implemented in Qualtran under `qualtran/surface_code/flasq`) estimates lattice-surgery ancilla spacetime
volume for fault-tolerant algorithms (T/Toffoli/rotation costs, cultivation, reaction time). It does not
apply to choosing compilations of a small physical circuit, so we do not implement or name it as our
objective; our `Q × duration` "spacetime proxy" is our own simplification.

### 1.8 Module 1 evaluation protocol

* Failure curves for `d = 3, 5, 7` versus `p` (with and without readout noise), readout-noise sweep and
  a one-bad-qubit sweep, 50,000 shots per point, Wilson intervals.
* Oracle agreement: vectorized decision tables vs the pure-Python reference for random models
  (all match; `max |E + ln P| ≈ 4e−15`).
* Held-out ambiguity study: each trial draws its own known noise parameters (`p_i ~ U(0.005, 0.2)`,
  `q_j ~ U(0, 0.15)`); a threshold flagging the lowest 10% of energy gaps is chosen on a validation seed
  and frozen before a separate held-out seed is evaluated. Recorded result: held-out AUROC 0.805 for
  the gap (0.893 for the logical margin); flagged decisions fail several times more often.
* Calibration: reliability diagram of the model posterior `P(keep|y)`; ECE 0.002 when the model is right,
  0.029 under a deliberately mismatched model.

---

## 2. Module 2 — Google surface-code hardware data

### 2.1 Data

Google Quantum AI, *Data for "Suppressing quantum errors by scaling a surface code logical qubit"*,
Zenodo record 6804040 (DOI 10.5281/zenodo.6804040, CC-BY-4.0), archive MD5
`a7fd8b481c3087090093106382dc217d` (verified), paper *Nature* 614, 676–681 (2023). 131 experiments:
distance-3 memories at four patch locations and a distance-5 memory, X and Z bases, 1–25 rounds,
50,000 shots each, plus a distance-25 repetition code (500,000 shots). Files used: `circuit_ideal.stim`,
`detection_events.b8`, `measurements.b8`, `sweep.b8`, `obs_flips_actual.01`, Google's decoder predictions
and three detector error models (DEMs). See [DATASET.md](DATASET.md).

### 2.2 Integrity and reproduction

* For every experiment, detection events and observable flips were re-derived from raw measurements and
  sweep bits with Stim's measurement-to-detection converter: **131/131 match bit-for-bit**.
* PyMatching 2.4 with `circuit_detector_error_model.dem` (Google's configuration) reproduces Google's
  published PyMatching predictions **shot-for-shot in 73/131 experiments**. In the longer runs up to 1,564
  of 50,000 shots differ. A probe that solves the matching problem exactly (MILP on PyMatching's own
  float edge weights) on three of those experiments found that **all 53 probed disagreeing shots** are
  near-degenerate (median complementary gap 0.03–0.31 vs 0.52–1.79 for agreeing shots) and that our
  prediction equals the exact optimum on every one of them while Google's 2022 prediction never does
  (control: 120/120 agreeing shots are optimal). The residual differences therefore come from the 2022
  decoder implementation, not from data handling.
* Fitting Google's own tensor-network predictions with our per-round model and averaging over patches and
  bases gives **2.914% (d = 5) and 3.028% (d = 3) logical error per round**, matching the published values.

### 2.3 Splits and fairness

Google's `pij` DEMs were estimated from detection events of one shot parity. Every method that uses them
decodes the complementary parity (`pij_from_even_for_odd` on odd shots, `pij_from_odd_for_even` on even
shots). Observable flips are used only for scoring. All methods are scored on identical shot indices.

### 2.4 Decoders evaluated

| Method | Source | Model |
|---|---|---|
| PyMatching · circuit DEM | computed here | `circuit_detector_error_model.dem`, all shots |
| PyMatching · pij DEM | computed here | held-out pij partitioning |
| PyMatching correlated | computed here | PyMatching 2.4 `enable_correlations=True`, held-out pij |
| Noise-aware Ising/QUBO | computed here | exact MLE on the pij hypergraph, held-out partitioning |
| Uniform-weight Ising/QUBO | computed here | same hypergraph, all weights 1 (ablation) |
| Google PyMatching / correlated matching / belief matching / tensor network | supplied by Google | as documented in Google's README |

### 2.5 Syndrome-constrained Ising/QUBO decoder

Each `error(p)` instruction of a flattened DEM is one Bernoulli fault mechanism; its true detector set is
the XOR of stim's suggested `^` decomposition (hyperedges are kept), and duplicate mechanisms are merged
with `p = p1(1−p2) + p2(1−p1)`. With `x_i ∈ {0,1}`:

```
minimize   Σ_i w_i x_i            w_i = ln((1 − p_i)/p_i)   (noise-aware)   or   w_i = 1   (uniform)
subject to Σ_{i ∈ N(j)} x_i ≡ s_j  (mod 2)   for every detector j
prediction = Σ_i L_i x_i mod 2
```

Up to the constant `Σ −ln(1−p_i)` the objective is the negative log-likelihood of the fault set, so the
minimizer is the most likely error (MLE) on the full hypergraph. With spins `σ_i = 1 − 2x_i` the parity
constraints are multi-body Ising conditions `Π σ_i = (−1)^{s_j}`; the equivalent QUBO adds binary slack
variables `k_j` and the penalty `λ (Σ x_i − 2k_j − s_j)²` with `λ > Σ|w|` (tested to have the same minimum).

Solver: exact branch-and-bound MILP (HiGHS via `scipy.optimize.milp`) with the slack formulation and a
10 s limit per solve. A solve that stops at the limit is reported as `time_limit` (incumbent not proven
optimal) or `failed`; unsolved shots count as failures. Correctness is tested against brute-force
enumeration on hundreds of random tiny DEMs. A seeded simulated-annealing QUBO heuristic
(`ising.anneal_qubo`) is included for experimentation on tiny instances only; no reported result uses it.

**Complementary gap**: `min E(x) subject to the opposite observable − min E(x)`. It is an ambiguity
indicator (Bombín et al., PRX Quantum 5, 010302); its predictive value is measured on held-out shots
(threshold chosen on even shots, tested on odd shots).

**Scale**: exact decoding of the first 5,000 (d = 3) or 2,000 (d = 5) real shots of every surface-code
experiment with at most 5 rounds (30 experiments). Longer experiments are evaluated only with PyMatching
and Google's decoders. Median solve time is tens of milliseconds per shot on a laptop, so this is an
offline analysis tool, not a real-time decoder.

### 2.6 Statistics

Wilson 95% intervals for every rate; exact McNemar tests on paired outcomes (a method is called better or
worse only at p < 0.05, otherwise "not resolved"); paired multinomial bootstrap intervals for differences;
logical error per round from a weighted least-squares fit of `ln(1 − 2P_L(r)) = ln A + r ln(1 − 2ε)` over
tested rounds `r ≥ 3`. Per-round and per-shot metrics are never compared directly.

### 2.7 Configuration advisor

Ranks only experimentally evaluated (experiment, decoder) pairs. Constraints: qubit budget (from each
experiment's circuit: 17 for d = 3, 49 for d = 5), reliability target (per-shot failure at a tested round
count, or the fitted per-round ε), decoder latency where measured, and priorities. It returns
"No tested configuration meets these constraints." when nothing qualifies, never interpolates or
extrapolates, and states that re-decoding historical measurements does not change the processor.

---

## 3. Claims

**Supported:** the integrity and reproduction results above; Module 1 decoder and indicator results on
simulated data; Module 2 decoder comparisons on the stated real shots with the stated statistics.

**Not claimed:** quantum advantage; hardware speedup from a classical solver; a new decoding algorithm
(energy/Ising formulations, MLE decoding and noise-aware weights are prior work); hardware-validated
circuit optimization; perfect recovery; identification of the physical cause of an error from a syndrome;
calibrated confidence from an energy gap; that Google's dataset is simulated.

## 4. Limitations

See the *Sources & Limitations* page in the app and [ENGINEERING_REPORT.md](ENGINEERING_REPORT.md).
