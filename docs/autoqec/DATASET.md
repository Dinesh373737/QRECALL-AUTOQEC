# Google dataset pipeline

AutoQEC's Module 2 uses only genuine experimental data published by Google Quantum AI.

| Field | Value |
|---|---|
| Title | Data for "Suppressing quantum errors by scaling a surface code logical qubit" |
| Creators | Google Quantum AI Team |
| Record / DOI | https://zenodo.org/records/6804040 · 10.5281/zenodo.6804040 |
| License | CC-BY-4.0 |
| Archive | `google_qec3v5_experiment_data.zip`, 315,490,804 bytes |
| MD5 (Zenodo) | `a7fd8b481c3087090093106382dc217d` (verified) |
| SHA-256 (ours) | `ef569742126b305e163cc7fccbf6275e03bdd54d090dffb1aef12a78af0a74c4` |
| Paper | Nature 614, 676–681 (2023), doi:10.1038/s41586-022-05434-1 |

## Commands

```sh
python -m backend.hardware.pipeline fetch      # download, verify MD5 against Zenodo, safely extract
python -m backend.hardware.pipeline verify     # re-derive detection events from raw measurements (all experiments)
python -m backend.hardware.pipeline subset     # rebuild data/google_subset (real shots only)
python -m backend.hardware.pipeline baseline   # all shots: PyMatching x3 + Google decoders, per-round fits
python -m backend.hardware.pipeline probe      # explain shot-level PyMatching disagreements
python -m backend.hardware.pipeline ising      # exact Ising/QUBO benchmark (add --resume to continue)
python -m backend.hardware.pipeline all
```

`fetch` refuses to extract if the checksum does not match and rejects archive entries that would escape
the target directory. The full archive lives in `data/google_qec3v5/` (git-ignored); set
`QRECALL_GOOGLE_DATA` to use another location. The API prefers the full archive when present and falls
back to the subset.

## Archive inventory (inspected, not assumed)

* 131 experiment directories named `{code}_b{basis}_d{distance}_r{rounds}_center_{row}_{col}`:
  surface code d = 3 at centers (3,5), (5,3), (5,7), (7,5) and d = 5 at (5,5), bases X and Z,
  rounds 1, 3, …, 25 (50,000 shots each); repetition code d = 25, 50 rounds, 500,000 shots.
* Per experiment: `properties.yml`, `layout.svg`, `circuit_ideal.stim`, `circuit_noisy.stim`,
  `measurements.b8`, `sweep.b8`, `detection_events.b8`, `obs_flips_actual.01`,
  `obs_flips_predicted_by_{pymatching,correlated_matching,belief_matching,tensor_network_contraction}.01`
  (the repetition code has only the first two predictions), and the DEMs
  `circuit_detector_error_model.dem`, `pij_from_even_for_odd.dem`, `pij_from_odd_for_even.dem`.
* `.b8`: one byte-aligned record per shot, bits packed little-endian (verified against
  `stim.read_shot_data_file`). `.01`: one ASCII line per shot.
* Bit counts per shot come from `properties.yml` (`circuit_detectors`, `circuit_measurements`,
  `circuit_sweep_bits`) and match the circuits (e.g. d = 3, 5 rounds: 40 detectors, 49 measurements).
* Detector coordinates `(row, col, round)` come from `DETECTOR` annotations; qubit coordinates from
  `QUBIT_COORDS`. A detector's stabilizer type is inferred from round-0 determinism (only memory-basis
  stabilizers are deterministic in the first round).
* Google's README states which DEM each published decoder used: PyMatching and correlated matching used
  the circuit DEM for all shots; belief matching and tensor-network contraction used the pij model of
  the complementary parity.

## Deployable subset (`data/google_subset`, 20.7 MB)

Built reproducibly by `subset` from the extracted archive. It contains real shots only:

* the first 5,000 (surface code, rounds ≤ 5) or 2,000 (all others) detection-event records of every
  experiment, byte-for-byte (still readable by Stim);
* every shot's recorded observable flip and every Google prediction, bit-packed (8 shots per byte);
* the three DEMs (gzip), `circuit_ideal.stim`, `layout.svg` and `properties.yml`;
* `manifest.json` with the archive checksum, extraction rules and the SHA-256 of every source and
  derived file (`backend.hardware.subset.verify_subset` re-checks them).

Aggregate benchmarks over all shots were computed from the full archive and are served from
`results/google/*.json` with their SHA-256 shown in the app.
