"""Regenerate Module 1 recorded artifacts (all simulated, all seeded).

    python -m backend.generate_qec_results

Writes results/qec/simulation_benchmark.json (+ .csv) and results/qec/optimizer_{h7,line}.json.
"""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

from .qec import benchmarks as sim_bench
from .qec import optimizer as opt

OUT = Path(__file__).resolve().parent.parent / "results" / "qec"


def stamp(payload: dict) -> dict:
    payload["provenance"] = {"kind": "simulation", "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                             "versions": {p: version(p) for p in ("numpy", "scipy", "qiskit", "qiskit-aer")},
                             "generator": "python -m backend.generate_qec_results"}
    return payload


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bench = stamp(sim_bench.run_all({"shots": 50000, "seed": 20261026, "p": 0.05, "q": 0.02}))
    (OUT / "simulation_benchmark.json").write_text(json.dumps(bench, indent=1, default=float))
    rows = sim_bench.to_csv_rows(bench)
    with open(OUT / "simulation_benchmark.csv", "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"simulation benchmark: {bench['duration_seconds']:.1f}s")
    for target in ("h7", "line"):
        ev = stamp(opt.evaluate({"coupling": target, "shots": 4000, "seed": 1234},
                                progress=lambda f, phase: None))
        (OUT / f"optimizer_{target}.json").write_text(json.dumps(ev, indent=1, default=float))
        print(f"optimizer {target}: {ev['unique_candidates']} unique candidates in {ev['duration_seconds']:.1f}s")


if __name__ == "__main__":
    main()
