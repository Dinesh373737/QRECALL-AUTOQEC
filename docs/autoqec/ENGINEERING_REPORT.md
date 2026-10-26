# QRecall AutoQEC — final engineering report

## 1. What works

**Module 1 — QEC Interactive Studio (simulation)**

| Capability | Status |
|---|---|
| QEC Lab: encode → inject (X/Y/Z, seeded random) → measure (with readout flips) → decode (4 decoders) → correct (feed-forward or Pauli frame) → verify (coherent majority verifier) on a real Qiskit circuit; play/pause/step; seeded replay; trial export | Working |
| Energy decoder with full candidate table (predicted syndrome, readout pattern, data and readout energy, total, rank, posterior, logical consequences), ΔE, logical-class probabilities and margin, computed Q&A, decision-boundary sensitivity | Working |
| Exact Bayes reference (independent implementation) and agreement checks | Working |
| Message Lab: UTF-8 → bits → repetition-code blocks, paired unprotected copy, readout noise, four decoders, animated per-character pipeline, per-bit drill-down with decoder evidence and circuit link, overhead, export | Working |
| Circuit Inspector: gate-by-gate statevector, mid-circuit measurement, `if_test` feed-forward vs Pauli frame, transpiled view on two coupling maps with layout, recursive metrics, Aer cross-check | Working |
| Decoder Explainer for d = 3/5/7 with per-qubit/per-check probabilities | Working |
| Resource Optimizer: 144 compilations → 59 (H graph) / 55 (line) unique verified candidates, Aer p_L with Wilson CI, hard constraints, normalized J, Pareto, no-feasible state, baseline vs selected deltas, custom-noise re-evaluation job, CSV/JSON export | Working |
| Simulation Benchmarks: failure curves d = 3/5/7, readout and asymmetric sweeps, oracle agreement, held-out gap study, calibration (matched/mismatched), runtime, reproducibility digest, rerun job, CSV/JSON | Working |

**Module 2 — Google Hardware Analyzer (real data)**

| Capability | Status |
|---|---|
| Zenodo download, MD5 verification, safe extraction, inventory, parsers (`.b8`, `.01`, DEM, circuits) checked against Stim | Working |
| Raw-measurement re-derivation of detection events and observables | 131/131 experiments match |
| PyMatching baseline on all 7,000,000 shots (circuit DEM, held-out pij DEM, correlated mode) + Google's supplied decoders | Working |
| Reproduction of Google's PyMatching predictions | Shot-exact in 73/131; remaining differences probed |
| Per-round fits; published 2.914% / 3.028% reproduced from Google's TN predictions | Working |
| Exact noise-aware and uniform Ising/QUBO decoders (HiGHS MILP), complementary gap, held-out gap study | Working on the ≤ 5-round experiments (30) |
| Dataset Explorer, Real Shot Explorer (3D + 2D), Decoder Benchmarks, Failure Investigator, Configuration Advisor | Working |
| Deployable real-shot subset (20.7 MB) with manifest and hashes; API serves subset or full archive transparently | Working |

## 2. What was tested

* `pytest backend/tests tests` — **252 passed** (166 original + 86 AutoQEC), on Windows with the full archive
  and again with only the subset installed (`QRECALL_GOOGLE_DATA` pointed elsewhere): Module 2 and API
  suites pass in both layouts.
* `npm test` — **56 passed** (49 original + 7 AutoQEC); `npm run build` — type-check and production build pass.
* Manual browser verification of every page (desktop, tablet and 375 px phone widths), presenter mode and
  the main interactions; no console errors.
* Not executed here: the optional Playwright suite (`npm run test:browser`, original memory-lab UI, now
  served at `/legacy.html`), and a Docker build (no Docker on this machine; the Dockerfile was updated).

## 3. Results

### Reproduced
* Detection events and observable flips from raw measurements: 131/131 bit-exact.
* Google's PyMatching predictions: 73/131 experiments shot-exact; in the others at most 1,564 of 50,000 shots
  differ. Probe (3 experiments): on all 53 probed disagreeing shots our prediction equals the exact
  minimum-weight optimum and Google's does not; the shots are near-degenerate; 120/120 control shots optimal.
* Published logical error per cycle: our fit of Google's tensor-network predictions gives 2.914% (d = 5) and
  3.028% (d = 3), the values in Nature 614, 676 (2023).

### Real-data decoder comparison
Exact Ising/QUBO decoding of real Google shots (first 5,000 shots for d = 3, 2,000 for d = 5, of every
surface-code experiment with ≤ 5 rounds). **Recorded so far: 28 of the 30 experiments (128,000 shots); the two
remaining d = 5 Z-basis runs (3 and 5 rounds) are still computing and will be added by `pipeline ising --resume`.**
All methods are scored on identical shots; pij-based methods use the complementary-parity model.

| Method | Failures | Shots | Pooled rate |
|---|---:|---:|---:|
| Google tensor network (supplied) | 9,004 | 128,000 | 7.03% |
| **Noise-aware Ising/QUBO (exact MLE, ours)** | **9,214** | 128,000 | **7.20%** |
| Google belief matching (supplied) | 9,385 | 128,000 | 7.33% |
| PyMatching correlated · pij DEM | 9,821 | 128,000 | 7.67% |
| Google correlated matching (supplied) | 10,185 | 128,000 | 7.96% |
| PyMatching · held-out pij DEM | 10,695 | 128,000 | 8.36% |
| PyMatching · circuit DEM | 11,010 | 128,000 | 8.60% |
| Uniform-weight Ising/QUBO (ablation) | 11,859 | 128,000 | 9.26% |

Paired per-experiment verdicts for the noise-aware Ising decoder (exact McNemar, p < 0.05):

| Compared with | Ising significantly better | Ising significantly worse | Not resolved | Net failures |
|---|---:|---:|---:|---:|
| PyMatching · circuit DEM | 19 | 0 | 9 | −1,796 |
| PyMatching · held-out pij DEM (same model) | 18 | 0 | 10 | −1,481 |
| Google correlated matching | 15 | 0 | 13 | −971 |
| PyMatching correlated | 10 | 0 | 18 | −607 |
| Google belief matching | 1 | 0 | 27 | −171 |
| Google tensor network | 0 | 6 | 22 | +210 |

* The differences are unresolved at r = 1 (the problem is essentially graph-like) and resolved in favour of the
  exact decoder for most multi-round runs versus matching.
* **Google's tensor-network decoder remains better** (6 experiments significantly, 0 the other way): it
  approximates maximum-likelihood decoding over logical classes, while our decoder finds the single most likely
  error — the same distinction as Module 1's exact Bayes reference versus the energy decoder.
* Ablation: noise-aware weights beat uniform weights in 24 of 28 experiments (0 worse).
* Ambiguity: the complementary gap, thresholded on even shots and tested on odd shots, has held-out AUROC
  0.818–0.981 (median 0.882); pooled held-out failure is 30.6% for flagged shots vs 4.6% for the rest.
* Solver: 127,922 of 128,000 noise-aware solves proven optimal; 78 time-limited incumbents used and flagged;
  median 27 ms per shot (offline tool, not real time).

### Noise-model sensitivity (all shots, 131 experiments)
PyMatching with the experimentally re-weighted pij model (held-out parity) has significantly fewer failures
than with the prior circuit model in 88 experiments, more in 1, unresolved in 42 (median −0.36 percentage
points). PyMatching's correlated mode on the pij model is better in 122, worse in 1.

### Module 1 (simulation)
* Oracle agreement exact; energies equal −ln P(e, d) to 4×10⁻¹⁵.
* Readout noise q = 0.08 (p = 0.05): lookup 1.9%, energy 1.3%, exact reference 0.8% logical failure.
* Held-out: energy-gap AUROC 0.805 (logical margin 0.893); calibration ECE 0.0022 (matched) vs 0.0294 (mismatched).
* Optimizer (H graph, recorded run): the selected candidate (one ancilla reused, Q = 4, G2 = 7, D = 10) cuts
  qubits by 33%, two-qubit gates by 74% and depth by 58% versus the documented baseline, and its simulated
  p_L falls from 5.95% [5.45, 6.49] to 1.92% [1.65, 2.25] under the declared noise model. Other candidates show
  that fewer two-qubit gates do not always mean lower p_L, which is why p_L is simulated rather than assumed.

## 4. What could not be completed / known limitations

* Exact Ising/QUBO decoding is limited to experiments with ≤ 5 rounds (first 5,000 or 2,000 shots); 25-round
  d = 5 instances are too slow for exact MILP within the deadline. The live explorer disables exact decoding
  above 2,600 mechanisms and says so.
* MILP solves take milliseconds per shot (median ≈ 30 ms on a laptop CPU): an offline analysis tool, not a
  real-time decoder. Software timings are not hardware latency claims.
* The simulated-annealing QUBO solver is only a small-instance utility; no reported result relies on a
  heuristic Ising machine.
* Module 1 models independent X and readout noise only; the bit-flip code cannot correct Z errors.
* Optimizer p_L comes from a declared Aer noise model; nothing was executed on quantum hardware.
* The repetition-code experiment (d = 25) is included in the explorer and baseline, but not in the advisor
  (it protects only against bit flips) or the Ising benchmark.
* Shot-level reproduction of Google's PyMatching is not exact for 58 long/large experiments (explained above).
* FLASQ was investigated and deliberately not implemented (different regime); our J and Q × duration are our
  own proxies.

## 5. Artifacts

| Artifact | Path |
|---|---|
| Archive verification | `results/google/archive_verification.json` |
| All-shot baseline (JSON/CSV) | `results/google/baseline.json`, `results/google/baseline.csv` |
| Exact Ising benchmark (per-shot predictions, paired tests) | `results/google/ising.json` |
| PyMatching disagreement probe | `results/google/reproduction_probe.json` |
| Module 1 benchmarks and optimizer runs | `results/qec/*.json`, `results/qec/simulation_benchmark.csv` |
| Real-shot subset + manifest | `data/google_subset/` |

## 6. Exact commands

```sh
# install
python3.12 -m venv .venv && .venv/bin/python -m pip install -r backend/requirements.lock.txt && npm ci
# run the complete demo
npm run dev            # → http://127.0.0.1:5173 (press "Present demo")
# verify
.venv/bin/python -m pytest backend/tests tests -q && npm test && npm run build
# regenerate evidence (optional; needs the 315 MB archive and several hours for the Ising step)
python -m backend.hardware.pipeline fetch
python -m backend.hardware.pipeline baseline
python -m backend.hardware.pipeline probe
python -m backend.hardware.pipeline ising --resume
python -m backend.hardware.pipeline ising-pairs
python -m backend.hardware.pipeline subset
python -m backend.generate_qec_results
```
