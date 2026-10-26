# API reference

Interactive schemas: `http://127.0.0.1:8000/api/docs` (OpenAPI at `/api/openapi.json`). All requests are
validated with strict Pydantic models (unknown fields rejected, probabilities bounded). Errors return
`{"error": {"code", "message", "field", "hint", "request_id"}}`.

## Module 1 — QEC Studio (simulation)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/qec/info` | Code description, decoders, conventions, syndrome and lookup tables |
| POST | `/api/qec/lab/trial` | One QEC Lab trial: noise sample, syndrome, candidate analysis, all decoders, explanation, sensitivity, circuit, statevector steps, verification |
| POST | `/api/qec/lab/analyze` | Candidate analysis for any syndrome and declared model (d = 3/5/7) |
| POST | `/api/qec/message` | Message Lab transmission (per-bit trace, texts, statistics, overhead) |
| POST | `/api/qec/circuit` | Circuit Inspector: operations, steps, metrics, transpiled circuit, Aer cross-check |
| POST | `/api/qec/optimizer/evaluate` | Job: compile, verify and simulate candidates under a custom noise model |
| POST | `/api/qec/optimizer/rank` | Hard constraints + normalized cost on a recorded or job evaluation |
| POST | `/api/qec/benchmarks/run` | Job: fresh seeded simulation benchmark |
| GET | `/api/qec/benchmarks/recorded` (`/csv`) | Recorded simulation benchmark with artifact hash |
| GET | `/api/qec/benchmarks/jobs/{id}/csv` | CSV of a benchmark job |
| GET/DELETE | `/api/qec/jobs/{id}` | Job status / cancellation |

## Module 2 — Google Hardware Analyzer (real data)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/google/status` | Dataset readiness, DOI, archive checksum, active layout (full or subset) |
| GET | `/api/google/experiments` | Catalog of the 131 experiments with headline results |
| GET | `/api/google/experiments/{id}` | Properties, DEM statistics, geometry, file hashes |
| GET | `/api/google/experiments/{id}/layout.svg` | Google's layout diagram |
| GET | `/api/google/experiments/{id}/shots?category=` | Shot lists: `disagreement`, `pymatching_failed`, `ising_only_correct`, `confident_ising_failure`, `all_failed`, `any_failed` |
| GET | `/api/google/experiments/{id}/shots/{shot}` | Per-shot evidence: detection events, answer key, every decoder's prediction and evidence, live exact Ising solution and complementary gap |
| POST | `/api/google/reproduce` | Job: re-decode real shots with PyMatching and compare with Google's predictions |
| GET | `/api/google/benchmarks/baseline` (`/csv`) | All-shot baseline (all experiments, all methods) |
| GET | `/api/google/benchmarks/ising` (`/csv`) | Exact Ising benchmark (`?per_shot=true` for per-shot arrays) |
| GET | `/api/google/benchmarks/summary` | Server-computed verdicts, pooled rates, model sensitivity, published-value reproduction |
| POST | `/api/google/advisor` | Configuration recommendation from tested configurations only |
| GET | `/api/google/advisor/configurations` | All evaluated (experiment, decoder) operating points |

## Shared

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Engine status, versions, modules |
| GET | `/api/provenance` | Versions, dataset status, SHA-256 of every recorded artifact, claim boundaries |

The original memory-lab endpoints (`/api/experiment`, `/api/evaluate`, `/api/jobs`, …) are unchanged.
