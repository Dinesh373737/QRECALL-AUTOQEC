# Architecture and design

QRecall keeps the scientific core independent from the visual interface. One validated experiment produces a shared conditioned energy, method results, event traces and reproducibility metadata. Every linked visualization reads that result.

## Component responsibilities

| Layer | Implementation | Responsibility |
|---|---|---|
| Interface | React, TypeScript, Vite | Memory/cue editors, controls, dialogs, revision handling and playback |
| Visual explanation | Three.js, React Three Fiber, KaTeX, SVG | Computed-state 3D views, formulas, charts and functional 2D fallback |
| HTTP boundary | FastAPI, Pydantic | Bounded validated requests, response contracts, errors and jobs |
| Shared model | NumPy | Hebbian weights, trusted conditioning, soft fields and energy enumeration |
| Classical methods | NumPy, SciPy | Hopfield updates, seeded Gibbs, exact references and observation-only retrieval |
| Quantum experiment | Qiskit, Aer, SciPy | Actual cost/mixer circuits, statevector snapshots, finite shots and bounded optimization |
| Evaluation | Independent backend functions | Target-isolated recovery metrics, constraints, uncertainty and resources |
| Evidence | Generated JSON/CSV | Configurations, seeds, counts, versions, source digests and benchmark definitions |

## Experiment flow

1. The interface submits stored memories, cue assumptions, seeds and method parameters. The source-memory label belongs to evaluation, not solver input.
2. The API validates shape, finite values, dimensions, free-variable count and computation budgets.
3. The core constructs symmetric zero-diagonal weights using total-pixel normalization. Trusted observations are eliminated analytically; untrusted observations add soft fields.
4. Hopfield, Gibbs and QAOA use this conditioned energy. Exact enumeration provides a small-model reference rather than replacing a quantum solver.
5. Actual solver events and circuit snapshots drive playback. Gibbs traces retain genuine probabilities/draws; measurement prefixes follow actual Aer shot memory.
6. Diagnostics derive energy contributions, normalization, expectation, variance and distribution spread from the computed results without changing decisions.
7. The interface accepts the result only for the current revision. Editing an experiment resets playback and prevents older results from overwriting newer inputs.

## Jobs, replay and exports

Optimization and live benchmark operations expose progress and cancellation. Their bounded work runs through the backend job interface. Jobs and experiment records are process-local, so the production service uses one worker; a multi-process deployment would require a shared job/result store.

Four curated scenarios are recorded illustrations. Benchmark replay retains its original seed, budget and computation metadata and is distinguished from a fresh live run. JSON/CSV exports include complete results even when the on-screen preview is shortened.

## Presentation semantics

Signed-weight displacement encodes the actual coupling. Energy-node height/color uses enumerated energy. Probability/frequency determines sphere volume in 3D and circle area in 2D. Quantum color/dials use relative phase; measurement highlights the declared modal state.

Constellation spacing, interpolated terrain and between-event movement are illustrative geometry. They do not change solver states or establish hardware speed. Device-noise shots are separate from the ideal pure-state amplitude/phase lesson.

## Runtime

The local launcher starts the API on 8000 and UI on 5173, with readiness and port checks. Vite forwards `/api` requests to FastAPI. The production container serves compiled assets and the API from the same origin, runs as an unprivileged user and needs no application API keys.

See [MATH_SPEC.md](../MATH_SPEC.md) for the scientific contract and [BENCHMARK.md](BENCHMARK.md) for evaluation definitions and measured evidence.
