# Measured prototype experiment

Generated locally on 5 October 2026 using `.venv/bin/python -m backend.generate_results`. Machine-specific timing is recorded, not promised. Scientific source is identified by the SHA256 `source_digest` in each JSON export; the recorded-results tests reject stale scientific source.

## Definition set before execution

- The same three 4×4 memories used in the default UI bank.
- One source selected uniformly from that bank for each independent case.
- Eight independently selected erased positions per cue; the other eight source pixels trusted and clamped.
- Twelve independent cue cases for seed **7102026**; a second complete independent batch uses **7102027**. Curation seed **5102026** is separate. Cases are not filtered after results are observed.
- Hopfield: cue plus separately seeded random missing pixels, sequential asynchronous updates, at most 32 sweeps.
- Gibbs: temperature 0.45, 24 burn-in sweeps, 256 retained full-sweep samples, thinning 1. Chain samples may be correlated.
- QAOA: depth 1, one seeded COBYLA start, up to 24 **ideal expected-energy** evaluations per case, then 1,024 actual Aer shots. No target identity is available to the objective or solver.
- Recall: converged Hopfield state and **modal** Gibbs/QAOA count state. Sample-count ties select the lowest local basis integer. Nearest-memory ties select the lowest bank index and remain visible.
- Error is Hamming disagreement across all 16 pixels; free-pixel error is separately exported. Exact minimum and exact Gibbs are diagnostics, not quantum algorithm substitutes.

## Observed results

| Method | First batch recovery | First-batch Wilson 95% interval | Independent repeat recovery | First mean bit error | First mean energy gap |
|---|---:|---:|---:|---:|---:|
| Nearest stored memory | 11 / 12 | 64.6%–98.5% | 12 / 12 | 1.04% | 0.240 |
| Hopfield | 10 / 12 | 55.2%–95.3% | 11 / 12 | 4.69% | 0.667 |
| Gibbs sample mode | 9 / 12 | 46.8%–91.1% | 11 / 12 | 5.73% | 0.000 |
| QAOA sample mode | 5 / 12 | 19.3%–68.0% | 10 / 12 | 11.46% | 2.573 |
| Exact minimum diagnostic | 10 / 12 | 55.2%–95.3% | 11 / 12 | 3.65% | 0.000 |
| Exact Gibbs mode diagnostic | 10 / 12 | 55.2%–95.3% | 11 / 12 | 3.65% | 0.000 |

All methods had **zero trusted-constraint violations** in both batches. Energy is in arbitrary normalized units. An energy gap of zero can accompany a recall failure: the conditioned Hebbian model can prefer another stored memory or a spurious state. Nearest-memory retrieval can recover a source that the chosen energy does not favor. The second quantum batch differs substantially from the first, which reinforces the need for independent experiments and wide uncertainty reporting.

Wilson intervals count independent generated cues, not individual circuit shots or Gibbs draws. A 12-case result is a small descriptive study on one bank, not generalization evidence or proof of a significant superiority claim.

## Different resources, separately reported

| Resource | First batch | Independent repeat |
|---|---:|---:|
| Hopfield bit updates | 192 | 200 |
| Gibbs conditional draws | 26,880 | 26,880 |
| Retained Gibbs samples | 3,072 | 3,072 |
| QAOA objective evaluations | 260 | 268 |
| QAOA finite shots | 12,288 | 12,288 |
| Free qubits per quantum case | 8 | 8 |
| Total logical quantum gate instances | 618 | 623 |
| Whole batch local elapsed time | 4.78 s | 3.30 s |

Compilation, optimization, simulation and method elapsed times are exported separately. The circuit has depth 16 in each of these depth-one cases; depth and qubit counts are reported per case, not added as computational work. Classical traces, quantum snapshots and simulator infrastructure contribute to these timings. They do not measure hardware execution, hardware speedup, asymptotic superiority or equalized work budgets.

## Evidence and regeneration

- `results/benchmark.json` and `results/benchmark.csv`: first batch, individual cues, target labels isolated from configs, resources, decisions, uncertainty, versions and source digest.
- `results/benchmark-repeat.json` and `results/benchmark-repeat.csv`: independent repeat under the same definition.
- `results/presets.json`: four separately curated illustrations with search budgets, seeds, exact energy diagnostics, actual counts, optimizer history and verified claims. These examples are excluded from the benchmark.
- `backend/tests/test_evaluation.py`: observation scoring, target isolation, sampled decisions, constraints, normalization, uncertainty and exported provenance.
- `backend/tests/test_recorded_results.py`: real solver replay checks each preset's claim and verifies benchmark/source provenance.

Re-run the generator after changes to scientific modules. Re-run `.venv/bin/python -m pytest backend/tests/test_evaluation.py backend/tests/test_recorded_results.py -q` before quoting a result. The focused suite includes **20 tests**; full project validation belongs in `docs/VALIDATION.md`.
