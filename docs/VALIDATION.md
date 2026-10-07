# Validation record

Updated 7 October 2026 (Asia/Kolkata). Automated tests, recorded interaction acceptance and public deployment checks have separate scopes.

## Source verification — 7 October 2026

| Check | Executed result |
|---|---|
| Python dependency compatibility | `pip check`: no broken requirements |
| Scientific core, API, jobs, exports and recorded results | **166 tests passed** |
| Frontend playback, equations, Math lab and scene helpers | **49 tests passed** |
| TypeScript and production frontend | **Passed** |

The scientific suite covers total-pixel normalization, symmetric zero-diagonal weights, full/reduced energy equality, trusted clamps, soft cues, asynchronous updates, Gibbs draws, Hamiltonian/gate signs, bit order, seeded Aer shots, measured prefixes, modal decisions, evaluation isolation, jobs, bounded exports and derived diagnostics.

Scientific source SHA256: `222cb51f12da4926bed97968956ac8855391554b501ea20d38eba04317b87401`. This identifies the scientific modules and generator rather than the full interface. Recorded-result tests reject stale scientific artifacts.

A non-fatal Starlette/TestClient deprecation warning and Vite's large-bundle advisory remain. They do not prevent the current tests or build from passing. GitHub Actions independently runs the source checks on repository pushes and pull requests.

## Local interaction acceptance

Recorded real-browser acceptance on 6 October covered **104 feature scenes** and **22 expanded formula types**. All successful capture groups reported zero runtime page errors. Representative desktop, mobile, equation, circuit, Math lab and encoded-video frames were visually inspected.

Demonstrated paths include memory/cue edits, trusted/soft inputs, seed controls, all playback controls, parameter edits, real optimization/benchmark cancellation, actual circuit/shot playback, all Math lab tabs, state/chart selection, formula dialogs, camera/focus/cinematic/motion/quality controls, presenter/mobile layouts, 2D fallback, scenario comparisons, imports, full JSON/CSV downloads and science notes. Malformed import retained the previous result.

The complete portable Playwright suite remains authored rather than executed as a full suite. Recorded paths do not certify arbitrary inputs, automatic reconnection, all performance conditions or every duplicated entry point.

## Public deployment checks

Release `math3d-20261006-2` passed exact-container and public HTTP checks on 6 October. The deployed frontend assets, feature labels, health and real experiments were verified:

- Default case: eight free qubits, 256 states, 47 ideal snapshots and 1,024 actual Aer shots.
- Diagnostic norms/probability sums equal one within numerical tolerance; energy contributions and expectations agree with the exported results.
- Trusted output pixels remain fixed.
- Fully observed cue: no circuit shots and empty counts.
- Noisy case: 64 actual shots, with ideal diagnostic quantities separately labeled.

Prior public screenshots belong to their original releases. Later local recorded acceptance does not establish a new public-Azure browser check. The README overview is an actual frame of the local current interface.

## Recorded evidence

Independent 12-case benchmark seeds are **7102026** and **7102027**; scenario curation uses **5102026**. Nearest/Hopfield/Gibbs/QAOA exact recoveries are **11/10/9/5** and **12/11/11/10**, with zero trusted violations. Definitions, budgets, uncertainty and resources are in [BENCHMARK.md](BENCHMARK.md) and `results/`.

The experiments are small classical simulations. No quantum advantage, hardware speedup, statistically established superiority or production restoration capability is claimed. Ideal basis entropy/effective-state counts describe distribution spread, not entanglement or recovery confidence.

## Known numerical boundary

An extreme imported bias such as `1e308` can overflow computation and return API 500. This remains unresolved and is not represented as a passing case. The intended demos use bounded small-model configurations. Automatic reconnection and the full portable browser regression suite need separate acceptance checks.
