# Judge demo — 3 to 4 minutes

Start the app (`npm run dev`, open http://127.0.0.1:5173) and press **Present demo** in the sidebar.
Presenter mode walks through the ten beats below, navigating to the right page with the right
parameters. Use **→ / ←** to move between beats and **Esc** to leave. Every number on screen comes from
the backend; if something is still loading, wait for it rather than narrating over a spinner.

| # | Time | Page (set by presenter mode) | Do | Say |
|---|---|---|---|---|
| 1 | 0:00 | Overview | Point at the two modules and the "published result reproduced" banner. | "Qubits flip and dephase. Error correction spreads one logical qubit over many and reads parity checks — syndromes. A decoder must infer the correction; we want to see *why*, and how it performs on real hardware." |
| 2 | 0:20 | QEC Lab (X on d1, \|+⟩) | Press **Play**; pause on *Measure syndrome*, then *Verify*. | "Both checks read −1: syndrome 11, the signature of qubit 1. Every state shown is a Qiskit statevector, and verification runs a real coherent majority decoder." |
| 3 | 0:45 | Message Lab (HELLO, p = 0.12) | Press **Play**; click a red bit. | "Each bit rides in its own three-qubit block. The unprotected copy is corrupted; protection fixes most bits, but two flips in one block still defeat a distance-3 code — we never force success." |
| 4 | 1:10 | Decoder Explainer (syndrome 10, q = 0.08) | Click the runner-up; drag the readout slider across the boundary. | "All candidate errors are ranked by negative log-likelihood. ΔE says how much less likely the runner-up is — an ambiguity indicator, not a success probability. When readout errors become likelier, the decoder starts blaming the measurement." |
| 5 | 1:35 | Resource Optimizer | Turn on Q ≤ 4, then tighten p_L. | "59 verified compilations of the *same* task. Constraints first, then the normalized cost J. Fewer CNOTs is not automatically lower logical error — we simulate it." |
| 6 | 1:55 | Dataset Explorer | Point at integrity 131/131; press **Run PyMatching now**. | "Now real data: Google's published surface-code experiments, checksum-verified. Detection events re-derived from raw measurements match exactly, and we reproduce Google's PyMatching predictions shot for shot." |
| 7 | 2:15 | Real Shot Explorer (d = 3, 5 rounds, shot 7) | Rotate the lattice; click a round. | "One real shot from Sycamore: detector events in space and time. The recorded logical flip is kept separate — it is the answer key." |
| 8 | 2:40 | Same shot, all overlays | Toggle PyMatching edges, Ising mechanisms and the opposite-outcome explanation. | "PyMatching matched these detector pairs; our noise-aware Ising/QUBO decoder solved the exact syndrome-constrained problem on the full hypergraph. This is what each decoder *inferred* — not a diagnosis of the physical defect." |
| 9 | 3:05 | Decoder Benchmarks | Read the verdict sentences; open *Held-out ambiguity test*. | "Identical shots for every method, models calibrated on even shots and tested on odd ones, exact McNemar tests. Where PyMatching wins or ties, the page says so — and the exact decoder costs milliseconds per shot, so it is an analysis tool, not a real-time decoder." |
| 10 | 3:35 | Configuration Advisor | Lower the per-round target until "No tested configuration meets these constraints." | "Recommendations come only from tested configurations — never extrapolated. Explainable decisions, honest uncertainty, real hardware evidence." |

## Likely questions

* **Is this quantum advantage?** No. Everything runs on classical hardware; Module 1 is simulation and
  Module 2 re-analyzes Google's recorded measurements.
* **Is the Ising decoder new?** No. Decoding as Ising ground-state search (e.g. Fujisaki et al. 2023) and
  most-likely-error decoding are prior work; our contribution is the integrated, explainable,
  reproducible evaluation on real data.
* **How do you know the data handling is right?** Detection events re-derived from raw measurements match
  131/131; PyMatching reproduces Google's predictions shot-for-shot in 73/131 experiments (remaining
  differences are near-degenerate shots, and our answers equal the exact optimum there); our fits of
  Google's tensor-network predictions reproduce the published 2.914% / 3.028% per round.
* **Is the energy gap a confidence?** Not by itself. It is tested on held-out data, and its calibration
  degrades when the noise model is wrong — both shown on the Simulation Benchmarks page.
* **Why not use FLASQ?** FLASQ prices fault-tolerant algorithms by lattice-surgery spacetime volume; our
  optimizer chooses compilations of a small physical circuit. Our J is labelled as our own proxy.
