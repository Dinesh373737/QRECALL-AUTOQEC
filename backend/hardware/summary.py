"""Server-side summaries of the recorded real-hardware benchmarks.

Verdicts are computed from paired statistics, never written by hand: a method is called better or
worse than a reference only when the exact McNemar test on identical shots gives p < 0.05;
otherwise the difference is reported as not resolved.
"""
from __future__ import annotations

import json
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from statistics import median

from ..qec.statistics import wilson
from . import dataset as ds

ALPHA = 0.05
PUBLISHED = {
    "source": "Google Quantum AI, Nature 614, 676-681 (2023), abstract",
    "note": ("Published values use Google's best decoder and their own fitting procedure; they are shown for "
             "orientation and are not directly comparable with our per-decoder fits."),
    "distance_5_epsilon": {"value": 0.02914, "uncertainty": 0.00016},
    "distance_3_epsilon_average": {"value": 0.03028, "uncertainty": 0.00023},
    "repetition_d25_floor": {"value": 1.7e-6, "note": "set by a single high-energy event; 1.6e-7 excluding it"},
}


def _load(name: str) -> dict | None:
    path = ds.REPO_ROOT / "results" / "google" / name
    return _load_cached(str(path), path.stat().st_mtime) if path.exists() else None


@lru_cache(maxsize=8)
def _load_cached(path: str, mtime: float) -> dict:
    return json.loads(Path(path).read_text())


def verdict(test: dict) -> str:
    if test["p_value"] >= ALPHA:
        return "not resolved"
    return "fewer failures" if test["difference"] < 0 else "more failures"


def ising_summary() -> dict | None:
    data = _load("ising.json")
    if not data:
        return None
    rows, counts = [], {"pymatching_pij": defaultdict(int), "pymatching_circuit": defaultdict(int), "uniform": defaultdict(int)}
    pooled = defaultdict(lambda: [0, 0])
    latency = defaultdict(list)
    gap_rows = []
    for e in data["experiments"]:
        info = e["experiment"]
        m = e["methods"]
        for key, entry in m.items():
            pooled[key][0] += entry["count"]
            pooled[key][1] += entry["trials"]
            if entry.get("runtime"):
                latency[key].append(entry["runtime"]["median_us"])
        v_pij = verdict(e["paired"]["pymatching_pij"]["ising_noise_aware"])
        v_cir = verdict(e["paired"]["pymatching_circuit"]["ising_noise_aware"])
        v_uni = verdict(e["ablation_noise_aware_vs_uniform"])
        counts["pymatching_pij"][v_pij] += 1
        counts["pymatching_circuit"][v_cir] += 1
        counts["uniform"][v_uni] += 1
        rows.append({"experiment": info["id"], "distance": info["distance"], "basis": info["basis"],
                     "rounds": info["rounds"], "center": info["center"], "shots": e["shots_evaluated"],
                     "methods": {k: {"count": v["count"], "rate": v["rate"], "ci95": v["ci95"],
                                     "solver_status": v.get("solver_status"),
                                     "median_us": (v.get("runtime") or {}).get("median_us")} for k, v in m.items()},
                     "vs_pymatching_pij": {**e["paired"]["pymatching_pij"]["ising_noise_aware"], "verdict": v_pij},
                     "vs_pymatching_circuit": {**e["paired"]["pymatching_circuit"]["ising_noise_aware"], "verdict": v_cir},
                     "uniform_vs_pymatching_pij": {**e["paired"]["pymatching_pij"]["ising_uniform"],
                                                   "verdict": verdict(e["paired"]["pymatching_pij"]["ising_uniform"])},
                     "noise_aware_vs_uniform": {**e["ablation_noise_aware_vs_uniform"], "verdict": v_uni}})
        g = e.get("gap_analysis") or {}
        if "auroc_held_out" in g:
            gap_rows.append({"experiment": info["id"], "rounds": info["rounds"], "distance": info["distance"],
                             "auroc_validation": g["auroc_validation"], "auroc_held_out": g["auroc_held_out"],
                             "threshold": g["threshold"], "held_out_flagged": g["held_out_flagged"],
                             "held_out_unflagged": g["held_out_unflagged"], "histogram": g.get("histogram"),
                             "quintiles": g.get("held_out_quintiles")})
    versus: dict[str, dict] = {}
    for e in data["experiments"]:
        for method, test in (e.get("paired_all") or {}).items():
            slot = versus.setdefault(method, {"fewer failures": 0, "more failures": 0, "not resolved": 0, "net": 0})
            slot[verdict(test)] += 1
            slot["net"] += test["only_a_wrong"] - test["only_b_wrong"]
    n = len(rows)
    sentences = []
    c = counts["pymatching_pij"]
    sentences.append(f"Against PyMatching using the same held-out pij models, the noise-aware Ising/QUBO decoder had "
                     f"significantly fewer failures in {c['fewer failures']} of {n} experiments, significantly more in "
                     f"{c['more failures']}, and an unresolved difference in {c['not resolved']} (exact McNemar, p < 0.05, "
                     f"identical shots).")
    u = counts["uniform"]
    sentences.append(f"Ablation: noise-aware weights beat uniform weights in {u['fewer failures']} of {n} experiments "
                     f"(worse in {u['more failures']}, unresolved in {u['not resolved']}).")
    for ref, name in (("google_tensor_network_contraction", "Google's tensor-network decoder"),
                      ("google_belief_matching", "Google's belief-matching decoder"),
                      ("pymatching_correlated", "PyMatching's correlated mode")):
        v = versus.get(ref)
        if v:
            total = v["fewer failures"] + v["more failures"] + v["not resolved"]
            sentences.append(f"Against {name} on the same shots it had significantly fewer failures in {v['fewer failures']}, "
                             f"significantly more in {v['more failures']} and an unresolved difference in "
                             f"{v['not resolved']} of {total} experiments (net {v['net']:+d} failures summed over all).")
    lat_na = median(latency["ising_noise_aware"]) if latency["ising_noise_aware"] else None
    sentences.append("Speed: PyMatching decodes in microseconds per shot; the exact MILP needs "
                     + (f"a median of {lat_na / 1000:.1f} ms" if lat_na else "milliseconds")
                     + " per shot on this machine, so it is an offline analysis tool here, not a real-time decoder.")
    status = {"ising_noise_aware": defaultdict(int), "ising_uniform": defaultdict(int)}
    for e in data["experiments"]:
        for key in status:
            for k, v in (e["methods"][key].get("solver_status") or {}).items():
                status[key][k] += v
    na_s, un_s = status["ising_noise_aware"], status["ising_uniform"]
    na_total = sum(na_s.values())
    sentences.append(f"Solver status: {na_s.get('optimal', 0):,} of {na_total:,} noise-aware solves were proven optimal; "
                     f"{na_s.get('time_limit', 0)} stopped at the 10 s limit with a feasible but unproven incumbent "
                     f"(used and flagged) and {na_s.get('failed', 0)} failed (counted as wrong). Uniform: "
                     f"{un_s.get('time_limit', 0)} time-limited, {un_s.get('failed', 0)} failed.")
    sentences.append("Scope: the exact Ising benchmark covers the first real shots of every surface-code experiment "
                     "with at most 5 rounds; longer experiments are evaluated with PyMatching and Google's decoders only.")
    return {"experiments": rows, "counts": {k: dict(v) for k, v in counts.items()}, "n": n,
            "pooled": {k: {"count": v[0], "trials": v[1], "rate": v[0] / v[1] if v[1] else None,
                           "ci95": list(wilson(v[0], v[1]))} for k, v in pooled.items()},
            "median_latency_us": {k: median(v) for k, v in latency.items() if v}, "gap": gap_rows,
            "versus": versus, "solver_status": {k: dict(v) for k, v in status.items()},
            "sentences": sentences, "provenance": data["provenance"], "alpha": ALPHA}


def baseline_summary() -> dict | None:
    data = _load("baseline.json")
    if not data:
        return None
    reproduced = sum(1 for e in data["experiments"] if e.get("reproduction", {}).get("reproduced"))
    disagreements = [e["reproduction"]["disagreements"] for e in data["experiments"] if "reproduction" in e]
    integrity = sum(1 for e in data["experiments"] if e.get("integrity", {}).get("detection_events_match")
                    and e.get("integrity", {}).get("observables_match"))
    fits = defaultdict(list)
    for f in data["per_round_fits"]:
        if f["fit"]:
            fits[(f["distance"], f["basis"], f["method"])].append(f["fit"]["epsilon"])
    by_distance = [{"distance": d, "basis": b, "method": m, "epsilon_mean": sum(v) / len(v), "patches": len(v)}
                   for (d, b, m), v in sorted(fits.items())]
    reproduction = {}
    for d in (3, 5):
        vals = [r["epsilon_mean"] for r in by_distance
                if r["distance"] == d and r["method"] == "google_tensor_network_contraction"]
        if len(vals) == 2:
            reproduction[f"distance_{d}"] = sum(vals) / 2
    sensitivity = {}
    for key in ("pymatching_pij", "pymatching_correlated"):
        counts = defaultdict(int)
        diffs = []
        for e in data["experiments"]:
            t = e["paired_vs_pymatching_circuit"].get(key)
            if t:
                counts[verdict(t)] += 1
                diffs.append(t["difference"])
        sensitivity[key] = {"counts": dict(counts), "experiments": len(diffs),
                            "median_difference": median(diffs) if diffs else None}
    probe = _load("reproduction_probe.json")
    return {"experiments": len(data["experiments"]), "reproduced_exactly": reproduced,
            "max_disagreements": max(disagreements) if disagreements else None,
            "integrity_ok": integrity, "epsilon_by_distance": by_distance,
            "probe": probe["probes"] if probe else None, "published": PUBLISHED,
            "model_sensitivity": {
                **sensitivity,
                "reference": "pymatching_circuit (prior circuit-level noise model, circuit_detector_error_model.dem)",
                "meaning": ("Same decoder and identical shots; only the noise model changes (prior circuit model vs the "
                            "experimentally reweighted pij model of the complementary shot parity). Negative differences "
                            "mean fewer failures than the prior model."),
            },
            "published_reproduction": {
                **reproduction,
                "method": ("Our weighted fit of 1-2P_L(r) = A(1-2eps)^r over rounds 3-25 applied to Google's tensor-network "
                           "predictions, averaged over patches and over the X and Z bases."),
            },
            "provenance": data["provenance"]}
