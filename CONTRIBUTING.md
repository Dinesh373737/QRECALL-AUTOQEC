# Contributing to QRecall

Follow [README.md](README.md) for setup. Keep scientific computation in `backend/core/` and presentation in `src/`. Renderers consume computed events instead of reproducing solver decisions.

## Scientific changes

Read [MATH_SPEC.md](MATH_SPEC.md). Preserve spin encoding, total-pixel normalization, symmetric zero-diagonal weights, trusted clamping, soft-cue freedom, little-endian mapping and target-independent modal decisions. Keep the eight-free-qubit limit explicit.

Add meaningful independent tests for scientific behavior. If a core change invalidates source digests, regenerate recorded artifacts using `python -m backend.generate_results` in the project environment. Preserve declared seeds and budgets; do not select outcomes after execution. Explain recovery and energy optimization separately.

## Interface changes

Keep input revision handling, keyboard controls, reduced motion, readable formulas and the 2D fallback functional. Inspect desktop and narrow layouts. Label illustrative geometry and ideal/noisy quantities accurately.

## Before a pull request

```sh
.venv/bin/python -m pip check
.venv/bin/python -m pytest backend/tests tests -q
npm test
npm run build
```

For interaction changes, run relevant Playwright tests after installing Chromium. Describe user-visible behavior, scientific implications and checks actually executed. Keep credentials, dependency folders, raw recordings and working artifacts out of commits. Use a focused branch, such as `codex/your-change`, and avoid unrelated formatting or benchmark changes.
