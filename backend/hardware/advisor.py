"""Configuration advisor over EXPERIMENTALLY EVALUATED surface-code configurations.

A configuration is one tested experiment (distance, memory basis, patch location, rounds) paired
with one decoder whose predictions were scored on that experiment's real shots. The advisor only
filters and ranks these measured operating points: it never interpolates or extrapolates to untested
distances, rounds or noise levels, and re-decoding Google's fixed historical measurements does not
change the hardware's qubit count, gate count or circuit depth.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache

from . import dataset as ds

NO_MATCH = "No tested configuration meets these constraints."


@lru_cache(maxsize=2)
def _load(mtime_key: float) -> dict:
    base = json.loads((ds.REPO_ROOT / "results" / "google" / "baseline.json").read_text())
    ising_path = ds.REPO_ROOT / "results" / "google" / "ising.json"
    ising = json.loads(ising_path.read_text()) if ising_path.exists() else {"experiments": []}
    return {"baseline": base, "ising": ising}


def load_results() -> dict:
    path = ds.REPO_ROOT / "results" / "google" / "baseline.json"
    if not path.exists():
        raise FileNotFoundError("Run `python -m backend.hardware.pipeline baseline` to create the benchmark results.")
    ising = ds.REPO_ROOT / "results" / "google" / "ising.json"
    key = path.stat().st_mtime + (ising.stat().st_mtime if ising.exists() else 0)
    return _load(key)


def configurations() -> list[dict]:
    """Every evaluated (experiment, decoder) operating point.

    Where the exact Ising benchmark exists (surface code, <= 5 rounds), ALL decoders are taken from that
    benchmark, i.e. scored on the identical shot subset, so their rates and intervals are directly comparable.
    Elsewhere, decoders are scored on all shots. Per-round fits always use all shots.
    """
    data = load_results()
    fits = {(f["distance"], f["basis"], f["center"], f["method"]): f["fit"]
            for f in data["baseline"]["per_round_fits"]}
    ising = {e["experiment"]["id"]: e for e in data["ising"].get("experiments", [])}
    rows = []
    for res in data["baseline"]["experiments"]:
        info = res["experiment"]
        if info["code"] != "surface_code":
            continue
        center = f"{info['center'][0]}_{info['center'][1]}"
        paired = ising.get(info["id"])
        methods = paired["methods"] if paired else res["methods"]
        for method, entry in methods.items():
            base_entry = res["methods"].get(method, {})
            latency = (entry.get("runtime") or {}).get("median_us") or base_entry.get("per_shot_us")
            if method.startswith("ising"):
                latency_source = "median single-shot MILP solve time (this machine)"
            else:
                latency_source = "measured in this pipeline (batch decode, this machine)" if latency else None
            rows.append({"experiment": info["id"], "distance": info["distance"], "basis": info["basis"],
                         "rounds": info["rounds"], "center": center, "physical_qubits": info["physical_qubits"],
                         "method": method, "label": entry["label"], "source": entry.get("source"),
                         "shots": entry["trials"], "failures": entry["count"], "rate": entry["rate"],
                         "ci95": entry["ci95"], "latency_us": latency, "latency_source": latency_source,
                         "per_round": fits.get((info["distance"], info["basis"], center, method)),
                         "evaluation": (f"first {entry['trials']:,} shots, identical for every decoder" if paired
                                        else "all shots")})
    return rows


def recommend(req: dict) -> dict:
    excluded = set(req.get("exclude_methods") or [])
    rows = [r for r in configurations() if r["method"] not in excluded]
    rounds = req.get("rounds")
    basis = req.get("basis", "any")
    target_kind = req.get("target_kind", "per_shot")
    target = req.get("target")
    max_qubits = req.get("max_qubits")
    max_latency = req.get("max_latency_us")
    conservative = req.get("conservative", True)
    pr = req.get("priorities") or {}
    w = {"reliability": float(pr.get("reliability", 1.0)), "space": float(pr.get("space", 0.5)),
         "speed": float(pr.get("speed", 0.25))}
    tested_rounds = sorted({r["rounds"] for r in rows})
    if target_kind == "per_round":
        # One fitted operating point per (distance, basis, patch, decoder); represent it by its longest run.
        best_rows: dict[tuple, dict] = {}
        for r in rows:
            if r["per_round"] is None:
                continue
            key = (r["distance"], r["basis"], r["center"], r["method"])
            if key not in best_rows or r["rounds"] > best_rows[key]["rounds"]:
                best_rows[key] = r
        rows = [{**r, "evaluation": f"fit over tested rounds {r['per_round']['rounds_used'][0]}-"
                                     f"{r['per_round']['rounds_used'][-1]} (all shots)"} for r in best_rows.values()]
        rounds = None
    if rounds is not None and rounds not in tested_rounds:
        return {"status": "no_match", "message": NO_MATCH,
                "detail": f"{rounds} rounds was never tested; tested values are {tested_rounds}. "
                          "The advisor does not extrapolate.", "candidates": [], "tested_rounds": tested_rounds}
    evaluated, feasible = [], []
    for r in rows:
        reasons = []
        if rounds is not None and r["rounds"] != rounds:
            continue
        if basis != "any" and r["basis"] != basis:
            continue
        if target_kind == "per_round":
            fit = r["per_round"]
            metric = None if fit is None else (fit["ci95"][1] if conservative else fit["epsilon"])
            if metric is None:
                reasons.append("no per-round fit for this decoder/patch")
        else:
            metric = r["ci95"][1] if conservative else r["rate"]
        if target is not None and metric is not None and metric > target:
            reasons.append(f"logical failure {metric:.4f} > target {target}")
        if max_qubits is not None and r["physical_qubits"] > max_qubits:
            reasons.append(f"{r['physical_qubits']} physical qubits > budget {max_qubits}")
        if max_latency is not None:
            if r["latency_us"] is None:
                reasons.append("no latency figure for this decoder")
            elif r["latency_us"] > max_latency:
                reasons.append(f"latency {r['latency_us']:.1f} µs > {max_latency} µs")
        row ={**r, "metric": metric, "feasible": not reasons, "violations": reasons}
        evaluated.append(row)
        if not reasons:
            feasible.append(row)
    if not feasible:
        return {"status": "no_match", "message": NO_MATCH, "candidates": sorted(evaluated, key=_order)[:40],
                "evaluated": len(evaluated), "tested_rounds": tested_rounds}
    best_rel = min(f["metric"] for f in feasible) or 1e-9
    min_q = min(f["physical_qubits"] for f in feasible)
    lat = [f["latency_us"] for f in feasible if f["latency_us"]]
    min_lat = min(lat) if lat else None
    # Latencies span several orders of magnitude, so speed is scored on a log scale: 1 + log10(latency / fastest).
    worst_ratio = (max(lat) / min_lat) if lat else 1.0
    for f in feasible:
        measured = bool(f["latency_us"] and min_lat)
        ratio = f["latency_us"] / min_lat if measured else worst_ratio
        terms = {"reliability": w["reliability"] * f["metric"] / best_rel,
                 "space": w["space"] * f["physical_qubits"] / min_q,
                 "speed": w["speed"] * (1 + math.log10(max(ratio, 1.0)))}
        f["score_terms"] = terms
        f["latency_scored_pessimistically"] = not measured
        f["score"] = sum(terms.values())
    feasible.sort(key=lambda f: (f["score"], f["metric"], f["experiment"], f["method"]))
    best = feasible[0]
    why = [f"Meets every constraint with logical failure {'(95% upper bound) ' if conservative else ''}"
           f"{best['metric']:.4f} {'per round' if target_kind == 'per_round' else 'per shot'} "
           f"on {best['shots']} real shots ({best['evaluation']}).",
           f"Uses {best['physical_qubits']} physical qubits (distance {best['distance']}, {best['rounds']} rounds, "
           f"{best['basis']}-basis memory, patch centered at {best['center'].replace('_', ', ')}).",
           f"Decoder: {best['label']}"
           + (f"; latency {best['latency_us']:.1f} µs per shot ({best['latency_source']})." if best["latency_us"] else ".")]
    tradeoffs = []
    for alt in feasible[1:6]:
        tradeoffs.append({"experiment": alt["experiment"], "method": alt["method"], "label": alt["label"],
                          "metric": alt["metric"], "physical_qubits": alt["physical_qubits"],
                          "latency_us": alt["latency_us"], "score": alt["score"],
                          "difference": _diff(best, alt)})
    return {"status": "recommended", "recommendation": best, "why": why, "tradeoffs": tradeoffs,
            "feasible": len(feasible), "evaluated": len(evaluated), "weights": w, "conservative": conservative,
            "excluded_methods": sorted(excluded),
            "target_kind": target_kind, "tested_rounds": tested_rounds,
            "candidates": feasible[:40],
            "boundaries": ["Only experimentally evaluated configurations are considered; nothing is extrapolated.",
                           "Speed is scored on a log scale (1 + log10 of latency relative to the fastest); decoders without measured latency get the slowest measured value.",
                           "Choosing a decoder re-analyzes recorded measurements; it does not change the chip's "
                           "physical qubits, gates or depth.",
                           "Latencies are software timings on this machine, not real-time hardware decoding."]}


def _order(r: dict):
    return (not r["feasible"], r["metric"] if r["metric"] is not None else 1.0)


def _diff(a: dict, b: dict) -> str:
    parts = [f"logical failure {b['metric']:.4f} vs {a['metric']:.4f}"]
    if b["physical_qubits"] != a["physical_qubits"]:
        parts.append(f"{b['physical_qubits']} vs {a['physical_qubits']} qubits")
    if b["latency_us"] and a["latency_us"]:
        parts.append(f"{b['latency_us']:.1f} vs {a['latency_us']:.1f} µs")
    return "; ".join(parts)
