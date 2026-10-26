# Changelog

## 2.0.0 — QRecall AutoQEC (Q-Hack India 2026)

- New product focus: explainable quantum error correction with two connected modules; the original memory lab is preserved at `/legacy.html`.
- Module 1 (simulation): three-qubit bit-flip QEC Lab with Qiskit statevector stepping, feed-forward and Pauli-frame correction, exact energy (negative log-likelihood) decoder, exact Bayes reference, computed explanations and decision-boundary sensitivity; Message Lab; Circuit Inspector with transpilation and Aer cross-checks; Decoder Explainer for d = 3/5/7; resource-aware circuit optimizer (verified candidates, Aer p_L with Wilson intervals, hard constraints, normalized cost J, Pareto); seeded simulation benchmarks with held-out ambiguity and calibration studies.
- Module 2 (real hardware data): checksum-verified Google Quantum AI archive (Zenodo 10.5281/zenodo.6804040), raw-measurement re-derivation (131/131), PyMatching reproduction and degeneracy probe, held-out pij partitioning, exact noise-aware and uniform Ising/QUBO decoders (HiGHS MILP), paired McNemar statistics, per-round fits reproducing the published 2.914% / 3.028%, 3D space-time shot explorer, failure investigator and evidence-only configuration advisor.
- Reproducible pipelines (`python -m backend.hardware.pipeline …`, `python -m backend.generate_qec_results`), deployable real-shot subset, new test suites, documentation and presenter mode.
- Fixed a Windows-only path-separator mismatch in the legacy recorded-results digest test.

## 1.0.0 — 7 October 2026

- Interactive memory bank, trusted-erasure and soft-noisy-cue experiments.
- Shared conditioned Hebbian energy with Hopfield, Gibbs, exact references and real Qiskit/Aer QAOA.
- Gate/statevector playback and actual finite-shot measurement accumulation.
- Linked 3D networks, energy terrain, signed-weight sculptures and phase/measurement constellations.
- Four-tab Math lab with derived energy, complex amplitude, expectation and measurement diagnostics.
- Camera/focus/presentation controls, readable equation dialogs, reduced motion and functional 2D fallback.
- Bounded optimization, live/recorded benchmarks, cancellation and complete JSON/CSV exports.
- Independent benchmark batches, reproducible scenarios, mathematical specifications and primary references.
- Automated scientific/API/frontend/build checks and documented local/container workflows.
