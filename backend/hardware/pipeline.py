"""Reproducible Module 2 pipeline.

    python -m backend.hardware.pipeline fetch      # download + verify + safely extract the Zenodo archive
    python -m backend.hardware.pipeline verify     # archive checksum, m2d re-derivation, PyMatching reproduction
    python -m backend.hardware.pipeline subset     # build data/google_subset (real shots only)
    python -m backend.hardware.pipeline baseline   # full-shot PyMatching + Google decoders, per-round fits
    python -m backend.hardware.pipeline ising      # exact Ising/QUBO benchmark on the short-experiment subset
    python -m backend.hardware.pipeline ising-pairs  # paired tests of the Ising decoder vs every other method
    python -m backend.hardware.pipeline probe      # explain shot-level PyMatching disagreements with Google's run
    python -m backend.hardware.pipeline all

Outputs are written to ``results/google`` with provenance (archive hash, versions, seeds, partitions).
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

from . import dataset as ds
from .benchmarks import baseline_experiment, fit_logical_error_per_round, ising_experiment
from .subset import build_subset, verify_subset

RESULTS = ds.REPO_ROOT / "results" / "google"
RAW = ds.REPO_ROOT / "data" / "google_qec3v5" / "raw"
PACKAGES = ("numpy", "scipy", "stim", "pymatching", "qiskit")


def versions() -> dict:
    return {p: version(p) for p in PACKAGES}


def provenance(extra: dict | None = None) -> dict:
    archive = RESULTS / "archive_verification.json"
    return {"dataset_doi": ds.DOI, "record": ds.ZENODO_RECORD, "title": ds.TITLE, "license": ds.LICENSE,
            "archive": json.loads(archive.read_text()) if archive.exists() else None,
            "versions": versions(), "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "data_kind": "experimental measurements from Google's Sycamore processor (not simulated)",
            **(extra or {})}


def _write(name: str, payload: dict, compact: bool = False):
    RESULTS.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), default=float) if compact else json.dumps(payload, indent=1, default=float)
    (RESULTS / name).write_text(text)
    print(f"wrote results/google/{name}")


def fetch(args):
    RAW.mkdir(parents=True, exist_ok=True)
    archive = Path(args.archive) if args.archive else RAW / ds.ARCHIVE_NAME
    if not archive.exists():
        print(f"downloading {ds.ARCHIVE_URL} ({ds.ARCHIVE_BYTES / 1e6:.0f} MB)")
        tmp = archive.with_suffix(".part")
        with urllib.request.urlopen(ds.ARCHIVE_URL) as response, open(tmp, "wb") as fh:
            shutil.copyfileobj(response, fh, length=1 << 20)
        tmp.replace(archive)
    check = ds.verify_archive(archive)
    _write("archive_verification.json", {**check, "path": archive.name,
                                         "checked_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    if not check["verified"]:
        sys.exit("Archive checksum does not match Zenodo's published MD5; refusing to extract.")
    target = ds.full_root()
    if (target / "README.txt").exists():
        print("archive already extracted")
        return
    target.mkdir(parents=True, exist_ok=True)
    root = target.resolve()
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            if not (target / info.filename).resolve().is_relative_to(root):
                sys.exit(f"Unsafe path in archive: {info.filename}")
        z.extractall(target)
    print(f"extracted to {target}")


def verify(args):
    cat = ds.catalog("full")
    archive = RAW / ds.ARCHIVE_NAME
    report = {"archive": ds.verify_archive(archive) if archive.exists() else None, "experiments": []}
    for exp in cat.experiments():
        if args.only and args.only not in exp.id:
            continue
        from .benchmarks import rederive_check
        row = {"id": exp.id, **rederive_check(exp)}
        report["experiments"].append(row)
        print(exp.id, row["detection_events_match"], row["observables_match"])
    _write("integrity.json", {**report, "provenance": provenance()})


def subset(args):
    archive = RESULTS / "archive_verification.json"
    check = json.loads(archive.read_text()) if archive.exists() else None
    manifest = build_subset(ds.full_root(), ds.subset_root(), check)
    status = verify_subset(ds.subset_root())
    total = sum(f.stat().st_size for f in ds.subset_root().rglob("*") if f.is_file())
    print(f"subset: {len(manifest['experiments'])} experiments, {total / 1e6:.1f} MB, verified={status['verified']}")


def baseline(args):
    cat = ds.catalog("full")
    rows, results = [], []
    for exp in cat.experiments():
        if args.only and args.only not in exp.id:
            continue
        res = baseline_experiment(exp, check_rederivation=not args.no_rederive)
        results.append(res)
        info = res["experiment"]
        for method, entry in res["methods"].items():
            rows.append({"experiment": info["id"], "code": info["code"], "basis": info["basis"],
                         "distance": info["distance"], "rounds": info["rounds"],
                         "center": f"{info['center'][0]}_{info['center'][1]}", "physical_qubits": info["physical_qubits"],
                         "method": method, "source": entry.get("source"), "shots": entry["trials"],
                         "failures": entry["count"], "rate": entry["rate"], "ci_low": entry["ci95"][0],
                         "ci_high": entry["ci95"][1], "per_shot_us": entry.get("per_shot_us")})
        rep = res.get("reproduction", {})
        print(f"{info['id']}: pymatching {res['methods']['pymatching_circuit']['count']}/{res['shots_evaluated']} "
              f"reproduced={rep.get('reproduced')} integrity={res.get('integrity', {}).get('detection_events_match')} "
              f"({res['seconds']:.1f}s)")
    fits = per_round_fits(results)
    _write("baseline.json", {"provenance": provenance({"scope": "all shots of every experiment"}),
                             "experiments": results, "per_round_fits": fits})
    with open(RESULTS / "baseline.csv", "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print("wrote results/google/baseline.csv")


def per_round_fits(results: list[dict]) -> list[dict]:
    groups: dict[tuple, list] = {}
    for res in results:
        info = res["experiment"]
        if info["code"] != "surface_code":
            continue
        for method, entry in res["methods"].items():
            key = (info["distance"], info["basis"], f"{info['center'][0]}_{info['center'][1]}", method)
            groups.setdefault(key, []).append({"rounds": info["rounds"], "rate": entry["rate"],
                                               "trials": entry["trials"], "count": entry["count"]})
    fits = []
    for (distance, basis, center, method), points in sorted(groups.items()):
        points.sort(key=lambda p: p["rounds"])
        fit = fit_logical_error_per_round(points)
        fits.append({"distance": distance, "basis": basis, "center": center, "method": method,
                     "points": points, "fit": fit})
    return fits


def ising(args):
    cat = ds.catalog("full" if (ds.full_root() / "README.txt").exists() else "subset")
    out = []
    done = set()
    if args.resume and (RESULTS / "ising.json").exists():
        out = json.loads((RESULTS / "ising.json").read_text())["experiments"]
        done = {e["experiment"]["id"] for e in out}
        print(f"resuming: {len(done)} experiments already recorded")
    for exp in cat.experiments():
        if exp.id in done:
            continue
        info = exp.info
        if info["code"] != "surface_code" or info["rounds"] > args.max_rounds:
            continue
        if args.only and args.only not in exp.id:
            continue
        shots = args.shots_d3 if info["distance"] == 3 else args.shots_d5
        print(f"{exp.id}: decoding {shots} shots with exact Ising/QUBO (time limit {args.time_limit}s)")
        res = ising_experiment(exp, shots, args.time_limit, args.workers, with_gap=True,
                               progress=lambda k, n: print(f"  {k}/{n}", flush=True))
        m = res["methods"]
        print(f"  noise-aware {m['ising_noise_aware']['count']} uniform {m['ising_uniform']['count']} "
              f"pymatching(pij) {m['pymatching_pij']['count']} pymatching(circuit) {m['pymatching_circuit']['count']} "
              f"of {res['shots_evaluated']} ({res['seconds']:.0f}s)")
        out.append(res)
        _write("ising.json", {"provenance": provenance({
            "scope": ("first N real shots of surface-code experiments with rounds <= "
                      f"{args.max_rounds}; N={args.shots_d3} (d=3), N={args.shots_d5} (d=5)"),
            "solver": "HiGHS branch-and-bound MILP via scipy.optimize.milp",
            "time_limit_seconds": args.time_limit}), "experiments": out}, compact=True)


def ising_pairs(args):
    """Add paired comparisons of the noise-aware Ising decoder against EVERY method on the identical shots."""
    import numpy as np
    from ..qec.statistics import mcnemar_exact, paired_difference
    from . import matching as mt
    path = RESULTS / "ising.json"
    data = json.loads(path.read_text())
    cat = ds.catalog("full" if (ds.full_root() / "README.txt").exists() else "subset")
    for res in data["experiments"]:
        exp = cat.get(res["experiment"]["id"])
        n = res["shots_evaluated"]
        actual = exp.observable_flips()[:n]
        dets = exp.detection_events(n, packed=True)
        preds = {c: mt.partitioned_predictions(exp, c, dets)["predictions"] for c in mt.CONFIGS}
        preds.update({f"google_{k}": v[:n] for k, v in exp.google_predictions().items()})
        ps = res["per_shot"]
        valid = np.isin(np.array(ps["na_status"]), ["optimal", "time_limit"])
        na_wrong = (np.array(ps["ising_noise_aware"], dtype=bool) != actual) | ~valid
        for key, entry in res["methods"].items():  # display labels follow the current code
            if key.startswith("google_"):
                entry["label"] = "Google · " + {"pymatching": "PyMatching", "correlated_matching": "correlated matching",
                                                "belief_matching": "belief matching",
                                                "tensor_network_contraction": "tensor network"}[key[7:]]
        res["paired_all"] = {}
        for key, values in preds.items():
            wrong = values != actual
            res["paired_all"][key] = {**mcnemar_exact(na_wrong, wrong), **paired_difference(na_wrong, wrong),
                                      "comparison": f"ising_noise_aware minus {key} (identical shots)"}
        print(res["experiment"]["id"], {k: v["only_a_wrong"] - v["only_b_wrong"] for k, v in res["paired_all"].items()})
    data["provenance"]["paired_all"] = "exact McNemar + paired bootstrap of the noise-aware Ising decoder vs every method"
    path.write_text(json.dumps(data, separators=(",", ":"), default=float))
    print("wrote results/google/ising.json (compact, with paired_all)")


def probe(args):
    from .benchmarks import matching_degeneracy_probe
    cat = ds.catalog("full")
    targets = [args.only] if args.only else ["surface_code_bZ_d3_r19_center_3_5", "surface_code_bX_d3_r25_center_3_5",
                                             "surface_code_bZ_d5_r13_center_5_5"]
    out = []
    for exp_id in targets:
        res = matching_degeneracy_probe(cat.get(exp_id), max_disagreements=args.probe_shots)
        print(f"{exp_id}: disagreements {res['disagreements']}, ours==optimum {res['ours_equals_exact_optimum']}/"
              f"{res['probed']}, google==optimum {res['google_equals_exact_optimum']}/{res['probed']}, "
              f"gap median {res['gap_disagreeing_median']:.3f} vs {res['gap_agreeing_median']:.3f}")
        out.append(res)
    _write("reproduction_probe.json", {"provenance": provenance(), "probes": out})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["fetch", "verify", "subset", "baseline", "ising", "ising-pairs", "probe", "all"])
    parser.add_argument("--archive")
    parser.add_argument("--only", help="substring filter on experiment ids")
    parser.add_argument("--no-rederive", action="store_true")
    parser.add_argument("--max-rounds", type=int, default=5)
    parser.add_argument("--shots-d3", type=int, default=5000)
    parser.add_argument("--shots-d5", type=int, default=2000)
    parser.add_argument("--time-limit", type=float, default=10.0)
    parser.add_argument("--workers", type=int)
    parser.add_argument("--probe-shots", type=int, default=25)
    parser.add_argument("--resume", action="store_true", help="keep experiments already in results/google/ising.json")
    args = parser.parse_args(argv)
    steps = {"fetch": [fetch], "verify": [verify], "subset": [subset], "baseline": [baseline], "ising": [ising],
             "ising-pairs": [ising_pairs], "probe": [probe],
             "all": [fetch, subset, baseline, probe, ising, ising_pairs]}[args.command]
    for step in steps:
        step(args)


if __name__ == "__main__":
    main()
