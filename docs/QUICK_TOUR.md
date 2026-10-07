# Quick tour

Open the [live demo](https://qrecall.graysea-2c087476.eastasia.azurecontainerapps.io/) or run locally using [README.md](../README.md). Wait for **LIVE COMPUTATION** before playing a trace.

## Eight chapters

| Chapter | Try this | What to inspect |
|---|---|---|
| **Store** | Select/edit/add a stored pattern; choose a matrix cell. | Learned positive, negative and zero couplings; the Hebbian equation. |
| **Damage** | Use **Edit input**; erase/restore pixels or switch to the noisy experiment. | Trusted versus free pixels, reliability, cue strength and conditioned fields. |
| **Recall** | Play, pause, step and scrub an update. | Selected neuron, neighbor contributions, local field, before/after spin and energy. |
| **Thermal** | Change temperature or retained sample count. | Actual conditional probability, seeded draw, uphill updates and exact thermal distribution. |
| **Quantum** | Inspect free/global mapping; play cost and mixer gates. | Gate angles, phases, amplitudes, probabilities and optimization history. |
| **Measure** | Play cumulative shot batches and select a state. | Ideal probability versus measured frequency, finite shots, modal output and ties. |
| **Compare** | Load each scenario; inspect saved evidence or run a benchmark. | Nearest-memory baseline, exact diagnostics, recovery versus energy and resource counts. |
| **Export** | Preview, copy or download JSON/CSV; import a valid configuration. | Reproducible configuration, trace, gates, counts, seeds, versions and evaluation. |

## Playback

**Play recall** on a setup/result chapter opens Recall. **Pause**, previous/next, timeline, speed and reset inspect the current computed trace. **Replay** restarts a completed trace. A configuration edit recomputes results and resets playback.

Store, Damage, Compare and Export have no solver-event timeline. A fully observed cue has no unknowns: it returns directly with no circuit or shots. Erase a pixel or load a scenario before expecting recovery animation.

**Present demo** loads the easy case and starts Recall after computation finishes. The presenter selects subsequent chapters; they do not advance automatically. **Escape** exits presentation or the active dialog/focus view.

## 3D and accessibility

Use the visualization selector for weight sculptures, energy constellations and phase/measurement constellations. **Cinematic** orbits during playback. Drag to orbit, zoom or pan; manual camera use suspends automatic orbit until **Reset camera**. **Focus 3D** enlarges the stage.

Choose **Reduced motion** to minimize movement while preserving event inspection. **2D** provides a functional SVG fallback. High/Low controls adjust rendering quality. Chapter keys **1–8**, **Space** and arrows work outside typing fields; presentation uses arrows for chapters.

## Math lab

- **State & energy:** inspect bit/spin mapping and the constant, pair and field contributions to conditioned energy.
- **Complex amplitude:** select an Argand point and inspect its real/imaginary components, magnitude and phase.
- **Expectation:** follow normalization, expected energy, variance, basis entropy and effective occupied states.
- **Measurement:** compare ideal probabilities with actual sampled frequencies and the modal decision.

Selectors, arrows and charts link to the same basis state. **Expand** shows a larger equation and symbol guide. Close with **Close**, an outside click or **Escape**.

## Reading results accurately

Filled pixels mean spin +1 and bit 0. Trusted observations stay fixed; soft noisy observations may change. Sphere volume reflects probability/frequency, not correctness confidence. Basis entropy is distribution spread, not entanglement. Cost gates preserve basis probabilities while changing phase; mixer gates can redistribute probability through interference.

The **Quantum worse** scenario is a reproducible counterexample to an unconditional superiority claim. Read the [benchmark report](BENCHMARK.md) and [mathematical specification](../MATH_SPEC.md) when explaining comparisons.
