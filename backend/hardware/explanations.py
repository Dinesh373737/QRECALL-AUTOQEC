"""Per-shot evidence for the Real Shot Explorer and Failure Investigator.

Separates four kinds of information and labels each:
  measured   -- detection events and the recorded observable flip (Google hardware data)
  modeled    -- mechanism probabilities from a detector error model
  inferred   -- what a decoder chose to explain the detection events
  supplied   -- predictions Google published for its own decoders

A syndrome does not uniquely identify the physical cause of an error. Every inferred mechanism is
phrased as "the decoder inferred ..." and never as a physical diagnosis.
"""
from __future__ import annotations

import json
import math
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from threading import Lock

import numpy as np
import stim

from . import dataset as ds
from . import matching as mt
from .dem import DemGraph, detector_coordinates
from .ising import IsingProblem, decode_with_gap, explain_solution, solve

LIVE_ISING_MAX_MECHANISMS = 2600
CONFIDENT_GAP = 3.0  # nats; a decision this far ahead of every opposite-outcome explanation counts as confident
LIVE_ISING_TIME_LIMIT = 8.0
_lock = Lock()
_pool: ProcessPoolExecutor | None = None


def _live_pool() -> ProcessPoolExecutor:
    """Exact MILP solves run in a separate process so they never block other API requests."""
    global _pool
    with _lock:
        if _pool is None:
            _pool = ProcessPoolExecutor(max_workers=2)
        return _pool


def _warm_job() -> bool:
    """Import the solver stack inside a worker so the first live request is fast."""
    import scipy.optimize  # noqa: F401
    return True


def warm_pool():
    try:
        pool = _live_pool()
        for _ in range(2):
            pool.submit(_warm_job)
    except Exception:  # warming is an optimization only
        pass


def _solution_payload(problem: IsingProblem, sol, coords) -> dict:
    return {"status": sol.status, "prediction": None if sol.prediction is None else bool(sol.prediction),
            "objective": sol.objective, "solve_ms": sol.seconds * 1e3,
            "mechanisms": explain_solution(problem, sol, coords)}


def live_ising_job(experiment_id: str, kind: str, syndrome: list[int]) -> dict:
    """Worker-process entry point: exact noise-aware (with complement) and uniform solves for one shot."""
    graph = _graph(experiment_id, kind)
    geo = geometry(experiment_id)
    coords = {d["id"]: [d["x"], d["y"], d["t"]] for d in geo["detectors"]}
    syn = np.asarray(syndrome, dtype=np.uint8)
    na = IsingProblem(graph, "noise_aware")
    uni = IsingProblem(graph, "uniform")
    g = decode_with_gap(na, syn, LIVE_ISING_TIME_LIMIT)
    u = solve(uni, syn, LIVE_ISING_TIME_LIMIT)
    return {"noise_aware": _solution_payload(na, g["best"], coords),
            "complement": None if g["complement"] is None else _solution_payload(na, g["complement"], coords),
            "uniform": _solution_payload(uni, u, coords), "gap": g["gap"]}


@lru_cache(maxsize=64)
def geometry(experiment_id: str) -> dict:
    exp = ds.catalog().get(experiment_id)
    text = exp.circuit_text()
    circuit = stim.Circuit(text)
    coords = detector_coordinates(text)
    qcoords = {int(k): v for k, v in circuit.get_final_qubit_coordinates().items()}
    flat = circuit.flattened()
    measured_last = []
    for inst in flat:
        if inst.name == "M":
            measured_last = [t.value for t in inst.targets_copy()]
    data_qubits = set(measured_last)
    basis = exp.info["basis"]
    other = "Z" if basis == "X" else "X"
    first_round = {(c[0], c[1]) for c in coords.values() if c[2] == 0}
    is_rep = exp.info["code"] == "repetition_code"
    det_rows = []
    for d, (x, y, t) in sorted(coords.items()):
        det_basis = basis if ((x, y) in first_round or is_rep) else other
        det_rows.append({"id": d, "x": x, "y": y, "t": t, "basis": det_basis})
    qubits = []
    for q, c in sorted(qcoords.items()):
        role = "data" if q in data_qubits else "measure"
        qb = None
        if role == "measure":
            qb = basis if ((c[0], c[1]) in first_round or is_rep) else other
        qubits.append({"id": q, "x": c[0], "y": c[1], "role": role, "basis": qb})
    rounds = int(max(c[2] for c in coords.values())) if coords else 0
    return {"experiment": experiment_id, "detectors": det_rows, "qubits": qubits, "time_steps": rounds + 1,
            "note": ("Coordinates come from QUBIT_COORDS and DETECTOR annotations in Google's circuit_ideal.stim. "
                     "Detector basis is inferred from round-0 determinism (only memory-basis stabilizers are "
                     "deterministic in the first round).")}


@lru_cache(maxsize=96)
def _graph(experiment_id: str, kind: str) -> DemGraph:
    return DemGraph.from_text(ds.catalog().get(experiment_id).dem_text(kind))


def recorded_ising() -> dict:
    path = ds.REPO_ROOT / "results" / "google" / "ising.json"
    if not path.exists():
        return {}
    return _recorded_ising(path.stat().st_mtime)


@lru_cache(maxsize=2)
def _recorded_ising(mtime: float) -> dict:
    data = json.loads((ds.REPO_ROOT / "results" / "google" / "ising.json").read_text())
    return {e["experiment"]["id"]: e for e in data.get("experiments", [])}


def _edge_rows(explained: dict, coords: dict) -> list[dict]:
    rows = []
    for e in explained["edges"]:
        rows.append({**e, "coordinates": [coords[d] for d in e["detectors"]]})
    return rows


def shot_evidence(experiment_id: str, shot: int, live_ising: bool = True) -> dict:
    exp = ds.catalog().get(experiment_id)
    syndrome = exp.shot(shot).astype(np.uint8)
    actual = bool(exp.observable_flips()[shot])
    geo = geometry(experiment_id)
    coords = {d["id"]: [d["x"], d["y"], d["t"]] for d in geo["detectors"]}
    fired = [int(i) for i in np.flatnonzero(syndrome)]
    supplied = {k: bool(v[shot]) for k, v in exp.google_predictions().items()}
    decoders: dict[str, dict] = {}
    for config in mt.CONFIGS:
        kind = mt.dem_kind_for_shot(config, shot)
        explained = mt.explain_shot(exp.dem_text(kind), syndrome, mt.CONFIGS[config]["correlations"])
        decoders[config] = {"label": mt.CONFIGS[config]["label"], "source": "computed live (PyMatching)",
                            "dem": ds.DEM_FILES[kind], "prediction": explained["prediction"],
                            "correct": explained["prediction"] == actual, "total_weight": explained["total_weight"],
                            "edges": _edge_rows(explained, coords), "decode_us": explained["decode_us"],
                            "weight_meaning": explained["weight_meaning"]}
    for name, pred in supplied.items():
        decoders[f"google_{name}"] = {"label": ds.GOOGLE_DECODERS[name]["label"],
                                      "source": "Google decoder prediction (Zenodo archive)",
                                      "dem": ds.GOOGLE_DECODERS[name]["dem"], "prediction": pred,
                                      "correct": pred == actual}
    pij_kind = mt.dem_kind_for_shot("pymatching_pij", shot)
    graph = _graph(experiment_id, pij_kind)
    ising = {"tractable": len(graph.mechanisms) <= LIVE_ISING_MAX_MECHANISMS, "mechanisms": len(graph.mechanisms),
             "dem": ds.DEM_FILES[pij_kind]}
    rec = recorded_ising().get(experiment_id)
    if rec and shot < rec["shots_evaluated"]:
        ps = rec["per_shot"]
        ising["recorded"] = {"noise_aware_prediction": bool(ps["ising_noise_aware"][shot]),
                             "uniform_prediction": bool(ps["ising_uniform"][shot]),
                             "noise_aware_status": ps["na_status"][shot], "gap": ps["na_gap"][shot],
                             "source": "results/google/ising.json (benchmark run)"}
    if live_ising and ising["tractable"]:
        try:
            res = _live_pool().submit(live_ising_job, experiment_id, pij_kind, syndrome.tolist()).result(timeout=60)
        except Exception as exc:  # reported honestly; never replaced by a fabricated answer
            res = None
            ising["reason"] = f"Live exact decoding failed: {exc}"
        if res is not None:
            for key, label, payload in (("ising_noise_aware", "Noise-aware Ising/QUBO (exact MLE)", res["noise_aware"]),
                                        ("ising_uniform", "Uniform-weight Ising/QUBO", res["uniform"])):
                decoders[key] = {"label": label, "source": "computed live (HiGHS MILP)", "dem": ds.DEM_FILES[pij_kind],
                                 **payload, "correct": None if payload["prediction"] is None else payload["prediction"] == actual}
            ising["gap"] = res["gap"]
            comp = res["complement"]
            ising["complement"] = None if comp is None else {k: comp[k] for k in ("status", "objective", "prediction", "mechanisms")}
            if res["gap"] is not None:
                ising["relative_likelihood"] = math.exp(-res["gap"])
    elif live_ising:
        ising["reason"] = (f"Live exact decoding is limited to models with at most {LIVE_ISING_MAX_MECHANISMS} "
                           f"mechanisms; this one has {len(graph.mechanisms)}.")
    return {"experiment": exp.summary(), "shot": shot, "partition": "odd" if shot % 2 else "even",
            "measured": {"detection_events": fired, "detector_count": exp.detectors,
                         "actual_observable_flip": actual,
                         "events_per_round": _per_round(fired, coords, geo["time_steps"]),
                         "source": "Google hardware (detection_events.b8, obs_flips_actual)"},
            "decoders": decoders, "ising": ising,
            "narrative": narrative(decoders, ising, actual),
            "language_note": ("A syndrome does not uniquely reveal the physical cause of an error. Mechanisms below are "
                              "what each decoder inferred under its model, not diagnosed physical defects.")}


def _per_round(fired: list[int], coords: dict, steps: int) -> list[int]:
    counts = [0] * steps
    for d in fired:
        counts[int(coords[d][2])] += 1
    return counts


def narrative(decoders: dict, ising: dict, actual: bool) -> list[str]:
    lines = [f"Recorded answer key: the logical observable {'WAS' if actual else 'was NOT'} flipped in this shot."]
    preds = {k: v["prediction"] for k, v in decoders.items() if v.get("prediction") is not None}
    flips = sorted(k for k, v in preds.items() if v)
    keeps = sorted(k for k, v in preds.items() if not v)
    if flips and keeps:
        lines.append(f"Decoders disagree: {len(flips)} predicted a flip and {len(keeps)} predicted no flip.")
    else:
        lines.append("All available decoders agree on the prediction.")
    wrong = [decoders[k]["label"] for k, v in preds.items() if v != actual]
    lines.append("Incorrect predictions: " + (", ".join(wrong) if wrong else "none") + ".")
    na = decoders.get("ising_noise_aware")
    if na and na.get("mechanisms") is not None and na.get("objective") is not None:
        lines.append(f"The noise-aware Ising decoder inferred {len(na['mechanisms'])} fault mechanism(s) with total "
                     f"weight {na['objective']:.2f} nats as the most likely explanation under the pij model.")
        if ising.get("gap") is not None:
            lines.append(f"The best explanation with the opposite logical outcome costs {ising['gap']:.2f} nats more "
                         f"(single-explanation likelihood ratio {math.exp(-ising['gap']):.3g}).")
            if not na["correct"] and ising["gap"] > CONFIDENT_GAP:
                lines.append("This is a confident failure: the decoder's preferred explanation was clearly favored "
                             "under its model, yet the recorded outcome disagrees — evidence of model mismatch or an "
                             "unlikely error configuration.")
    pm = decoders.get("pymatching_pij")
    if pm:
        lines.append(f"PyMatching (pij model) matched {len(pm['edges'])} edge(s) with total weight "
                     f"{pm['total_weight']:.2f}.")
    return lines


def find_shots(experiment_id: str, category: str = "disagreement", limit: int = 200) -> dict:
    """Shot indices (within the available detection records) for the Failure Investigator."""
    exp = ds.catalog().get(experiment_id)
    n = exp.available_detection_shots
    actual = exp.observable_flips()[:n]
    preds = {f"google_{k}": v[:n] for k, v in exp.google_predictions().items()}
    dets = exp.detection_events(n, packed=True)
    for config in mt.CONFIGS:
        preds[config] = mt.partitioned_predictions(exp, config, dets)["predictions"]
    rec = recorded_ising().get(experiment_id)
    if rec:
        m = rec["shots_evaluated"]
        ps = rec["per_shot"]
        na = np.zeros(n, dtype=bool)
        valid = np.zeros(n, dtype=bool)
        na[:m] = np.array(ps["ising_noise_aware"], dtype=bool)
        valid[:m] = np.isin(np.array(ps["na_status"]), ["optimal", "time_limit"])
        preds["ising_noise_aware"] = na
        preds["_ising_valid"] = valid
    valid = preds.pop("_ising_valid", None)
    names = list(preds)
    matrix = np.vstack([preds[k] for k in names])
    if valid is not None and "ising_noise_aware" in names:
        # Where the Ising benchmark has no prediction, mirror another method so it cannot create a disagreement.
        i = names.index("ising_noise_aware")
        matrix[i, ~valid] = matrix[0, ~valid]
    wrong = matrix != actual[None, :]
    if valid is not None and "ising_noise_aware" in names:
        wrong[names.index("ising_noise_aware")] &= valid
    any_wrong, all_wrong = wrong.any(axis=0), wrong.all(axis=0)
    disagree = matrix.min(axis=0) != matrix.max(axis=0)
    masks = {"disagreement": disagree, "all_failed": all_wrong, "any_failed": any_wrong,
             "pymatching_failed": wrong[names.index("pymatching_circuit")],
             "ising_only_correct": None, "all": np.ones(n, dtype=bool)}
    masks["confident_ising_failure"] = None
    if "ising_noise_aware" in names:
        others = [i for i, k in enumerate(names) if k.startswith("pymatching")]
        masks["ising_only_correct"] = (~wrong[names.index("ising_noise_aware")]) & wrong[others].all(axis=0)
        if valid is not None:
            masks["ising_only_correct"] &= valid
        if rec:
            gaps = np.full(n, np.nan)
            m = rec["shots_evaluated"]
            gaps[:m] = np.array([np.nan if g is None else g for g in rec["per_shot"]["na_gap"]], dtype=float)
            with np.errstate(invalid="ignore"):
                masks["confident_ising_failure"] = wrong[names.index("ising_noise_aware")] & (gaps > CONFIDENT_GAP)
    mask = masks.get(category)
    if mask is None:
        mask = np.zeros(n, dtype=bool)
    idx = np.flatnonzero(mask)
    rows = [{"shot": int(s), "actual": bool(actual[s]), "wrong": [names[i] for i in np.flatnonzero(wrong[:, s])],
             "events": None} for s in idx[:limit]]
    counts = {k: int(v.sum()) if v is not None else None for k, v in masks.items()}
    counted = min(n, rec["shots_evaluated"]) if rec else n  # identical shots for every method in the bar chart
    considered = n
    note = "Restricted to shots whose detection events are available in the active data layout."
    if rec and category in ("ising_only_correct", "confident_ising_failure"):
        considered = min(n, rec["shots_evaluated"])
        note = (f"Ising predictions exist for the first {considered:,} shots (recorded exact benchmark); "
                "this category is limited to those shots.")
    elif rec:
        note += (f" Ising predictions cover the first {min(n, rec['shots_evaluated']):,} shots; beyond them the "
                 "Ising decoder is not counted.")
    return {"experiment": experiment_id, "category": category, "shots_considered": considered,
            "matches": int(mask.sum()), "counts": counts, "methods": names, "rows": rows,
            "failure_counts": {k: int(wrong[i, :counted].sum()) for i, k in enumerate(names)},
            "failure_counts_shots": counted, "note": note}
