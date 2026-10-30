"""Real-hardware decoder evaluation on Google's experimental shots.

All methods are scored against ``obs_flips_actual`` on exactly the same shot indices. The
partition used by each method is recorded: methods configured with the ``pij`` models decode odd
shots with ``pij_from_even_for_odd`` and even shots with ``pij_from_odd_for_even``, so no shot is
decoded with a model calibrated on itself. No method sees the observable flips it predicts.
"""
from __future__ import annotations

import math
import os
from concurrent.futures import ProcessPoolExecutor
from time import perf_counter

import numpy as np
import stim

from ..qec.statistics import mcnemar_exact, paired_difference, proportion, runtime_summary, wilson, auroc
from . import dataset as ds
from . import matching as mt
from .dem import DemGraph
from .ising import IsingProblem, decode_with_gap, solve

GOOGLE_LABELS = {k: v["label"] for k, v in ds.GOOGLE_DECODERS.items()}
METHOD_LABELS = {**{k: v["label"] for k, v in mt.CONFIGS.items()},
                 **{f"google_{k}": v for k, v in GOOGLE_LABELS.items()},
                 "ising_noise_aware": "Noise-aware Ising/QUBO (exact MLE)",
                 "ising_uniform": "Uniform-weight Ising/QUBO (exact)"}


def score(predictions: np.ndarray, actual: np.ndarray, valid: np.ndarray | None = None) -> dict:
    wrong = predictions != actual
    if valid is not None:
        wrong = wrong | ~valid
    out = proportion(int(wrong.sum()), int(actual.size))
    even = np.arange(actual.size) % 2 == 0
    out["even_shots"] = proportion(int(wrong[even].sum()), int(even.sum()))
    out["odd_shots"] = proportion(int(wrong[~even].sum()), int((~even).sum()))
    return out


def rederive_check(exp: ds.Experiment, chunk: int = 50000) -> dict:
    """Recompute detection events and observable flips from raw measurements with ``stim m2d``."""
    if exp.layout != "full":
        return {"checked": False, "reason": "raw measurements are not part of the deployable subset"}
    p = exp.properties
    converter = stim.Circuit(exp.circuit_text()).compile_m2d_converter()
    actual = exp.observable_flips()
    det_ok = obs_ok = True
    for start in range(0, exp.shots, chunk):
        count = min(chunk, exp.shots - start)
        meas = ds.read_b8(exp.path("measurements.b8"), int(p["circuit_measurements"]), count, start, packed=True)
        sweep = ds.read_b8(exp.path("sweep.b8"), int(p["circuit_sweep_bits"]), count, start, packed=True)
        dets, obs = converter.convert(measurements=meas, sweep_bits=sweep, separate_observables=True,
                                      bit_pack_result=True)
        det_ok &= bool(np.array_equal(dets, exp.detection_events(count, start, packed=True)))
        obs_ok &= bool(np.array_equal((obs[:, 0] & 1).astype(bool), actual[start:start + count]))
    return {"checked": True, "detection_events_match": det_ok, "observables_match": obs_ok,
            "method": "stim compile_m2d_converter on circuit_ideal.stim, measurements.b8, sweep.b8"}


def baseline_experiment(exp: ds.Experiment, methods=("pymatching_circuit", "pymatching_pij", "pymatching_correlated"),
                        check_rederivation: bool = True, max_shots: int | None = None) -> dict:
    started = perf_counter()
    dets = exp.detection_events(max_shots, packed=True)
    shots = dets.shape[0]
    actual = exp.observable_flips()[:shots]
    google = {k: v[:shots] for k, v in exp.google_predictions().items()}
    result = {"experiment": exp.summary(), "shots_evaluated": shots,
              "shot_range": [0, shots], "methods": {}, "paired_vs_pymatching_circuit": {}}
    result["raw_observable_flip_rate"] = float(actual.mean())
    result["mean_detection_event_fraction"] = ds.packed_popcount(dets) / (shots * exp.detectors)
    preds = {}
    for config in methods:
        out = mt.partitioned_predictions(exp, config, dets)
        preds[config] = out["predictions"]
        result["methods"][config] = {**score(out["predictions"], actual), "label": METHOD_LABELS[config],
                                     "source": "computed in this pipeline", "partition": mt.CONFIGS[config]["note"],
                                     "setup_seconds": out["setup_seconds"], "decode_seconds": out["decode_seconds"],
                                     "per_shot_us": out["per_shot_us"]}
    for decoder, values in google.items():
        key = f"google_{decoder}"
        preds[key] = values
        result["methods"][key] = {**score(values, actual), "label": METHOD_LABELS[key],
                                  "source": "Google decoder predictions (Zenodo archive)",
                                  "partition": ds.GOOGLE_DECODERS[decoder]["dem"], "per_shot_us": None}
    if "pymatching_circuit" in preds and "pymatching" in google:
        disagree = int(np.sum(preds["pymatching_circuit"] != google["pymatching"]))
        result["reproduction"] = {"ours": "pymatching_circuit", "google": "google_pymatching",
                                  "shots": shots, "disagreements": disagree,
                                  "agreement": 1 - disagree / shots if shots else None,
                                  "reproduced": disagree == 0}
    base = preds.get("pymatching_circuit")
    if base is not None:
        base_wrong = base != actual
        for key, values in preds.items():
            if key == "pymatching_circuit":
                continue
            wrong = values != actual
            result["paired_vs_pymatching_circuit"][key] = {**mcnemar_exact(wrong, base_wrong),
                                                           **paired_difference(wrong, base_wrong)}
    result["agreement_matrix"] = {a: {b: float(np.mean(preds[a] == preds[b])) for b in preds} for a in preds}
    if check_rederivation and max_shots is None:
        result["integrity"] = rederive_check(exp)
    result["seconds"] = perf_counter() - started
    return result


def matching_degeneracy_probe(exp: ds.Experiment, max_disagreements: int = 25, agreeing: int = 40,
                              time_limit: float = 60.0, seed: int = 0) -> dict:
    """Explain shots where our PyMatching run disagrees with Google's published PyMatching predictions.

    For each probed shot, an exact MILP on PyMatching's own (float) edge weights computes the minimum
    matching weight and the minimum weight with the opposite observable. The difference is the
    complementary matching gap; a small gap means the shot is near-degenerate. We also record which
    prediction equals the exact optimum.
    """
    from scipy.optimize import Bounds, LinearConstraint, milp
    from scipy.sparse import csr_matrix, hstack, identity, vstack

    dem = exp.dem_text("circuit")
    m = mt.matching_for(dem)
    dets = exp.detection_events()
    ours = m.decode_batch(dets)[:, 0].astype(bool)
    google = exp.google_predictions()["pymatching"]
    dis = np.flatnonzero(ours != google)
    rng = np.random.default_rng(seed)
    pool = np.flatnonzero(ours == google)
    agree = rng.choice(pool, min(agreeing, pool.size), replace=False)
    edges = m.edges()
    nd = m.num_detectors
    rows, cols, weights, obs = [], [], [], []
    for k, (u, v, data) in enumerate(edges):
        for node in (u, v):
            if node is not None and node < nd:
                rows.append(node)
                cols.append(k)
        weights.append(data["weight"])
        obs.append(1.0 if data["fault_ids"] else 0.0)
    n_e = len(edges)
    a = csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(nd, n_e))
    deg = np.asarray(a.sum(axis=1)).ravel()
    w, o = np.array(weights), np.array(obs)

    def solve_shot(s, force=None):
        c_mat = hstack([a, -2 * identity(nd)]).tocsr()
        cost = np.concatenate([w, np.zeros(nd)])
        ub = np.concatenate([np.ones(n_e), np.floor(deg / 2)])
        lo = s.astype(float)
        if force is not None:
            c_mat = vstack([hstack([c_mat, csr_matrix((nd, 1))]),
                            csr_matrix(np.concatenate([o, np.zeros(nd), [-2.0]])[None, :])]).tocsr()
            cost = np.concatenate([cost, [0.0]])
            ub = np.concatenate([ub, [np.floor(o.sum() / 2)]])
            lo = np.concatenate([lo, [float(force)]])
        res = milp(cost, constraints=LinearConstraint(c_mat, lo, lo), integrality=np.ones(cost.size),
                   bounds=Bounds(0, ub), options={"time_limit": time_limit})
        x = np.round(res.x[:n_e])
        return float(res.fun), int(o @ x % 2)

    def probe(i):
        s = dets[i].astype(int)
        best, pred = solve_shot(s)
        comp, _ = solve_shot(s, 1 - pred)
        return {"shot": int(i), "gap": comp - best, "optimal_prediction": pred,
                "ours": int(ours[i]), "google": int(google[i])}

    probed = [probe(i) for i in dis[:max_disagreements]]
    control = [probe(i) for i in agree]
    gd = np.array([p["gap"] for p in probed]) if probed else np.array([])
    ga = np.array([p["gap"] for p in control])
    return {"experiment": exp.id, "disagreements": int(dis.size), "probed": len(probed),
            "ours_equals_exact_optimum": sum(p["optimal_prediction"] == p["ours"] for p in probed),
            "google_equals_exact_optimum": sum(p["optimal_prediction"] == p["google"] for p in probed),
            "gap_disagreeing_median": float(np.median(gd)) if gd.size else None,
            "gap_agreeing_median": float(np.median(ga)) if ga.size else None,
            "control_ours_equals_exact_optimum": sum(p["optimal_prediction"] == p["ours"] for p in control),
            "control_probed": len(control), "shots": probed,
            "method": ("Exact MILP on PyMatching's float edge weights (min-weight T-join); complementary gap = "
                       "min weight with the opposite observable minus the minimum weight.")}


def fit_logical_error_per_round(points: list[dict], min_rounds: int = 3) -> dict | None:
    """Weighted least-squares fit of 1 - 2 P_L(r) = A (1 - 2 eps)^r over tested rounds r >= min_rounds."""
    rows = [p for p in points if p["rounds"] >= min_rounds and 0 < p["rate"] < 0.5]
    if len(rows) < 3:
        return None
    r = np.array([p["rounds"] for p in rows], dtype=float)
    pl = np.array([p["rate"] for p in rows], dtype=float)
    n = np.array([p["trials"] for p in rows], dtype=float)
    y = np.log(1 - 2 * pl)
    var = 4 * pl * (1 - pl) / n / (1 - 2 * pl) ** 2
    w = 1 / var
    x = np.vstack([np.ones_like(r), r]).T
    cov = np.linalg.inv(x.T @ (w[:, None] * x))
    coef = cov @ (x.T @ (w * y))
    slope, se = coef[1], math.sqrt(cov[1, 1])
    eps = (1 - math.exp(slope)) / 2
    # Monotone transform of the slope interval.
    lo, hi = (1 - math.exp(slope + 1.96 * se)) / 2, (1 - math.exp(slope - 1.96 * se)) / 2
    resid = y - x @ coef
    return {"epsilon": eps, "ci95": [lo, hi], "amplitude": math.exp(coef[0]), "rounds_used": r.astype(int).tolist(),
            "chi2_per_dof": float(np.sum(w * resid**2) / max(1, len(rows) - 2)),
            "model": "1 - 2 P_L(r) = A (1 - 2 eps)^r, weighted least squares on log(1 - 2 P_L)",
            "min_rounds": min_rounds}


# ---------------------------------------------------------------- Ising subset benchmark (multiprocess)

_WORKER: dict = {}


def _init_worker(dem_texts: dict, time_limit: float):
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    _WORKER.clear()
    _WORKER["time_limit"] = time_limit
    _WORKER["problems"] = {}
    for kind, text in dem_texts.items():
        graph = DemGraph.from_text(text)
        _WORKER["problems"][(kind, "noise_aware")] = IsingProblem(graph, "noise_aware")
        _WORKER["problems"][(kind, "uniform")] = IsingProblem(graph, "uniform")


def _solve_shot(task):
    shot, syndrome, gap = task
    kind = "pij_even_for_odd" if shot % 2 == 1 else "pij_odd_for_even"
    tl = _WORKER["time_limit"]
    noise = _WORKER["problems"][(kind, "noise_aware")]
    uniform = _WORKER["problems"][(kind, "uniform")]
    syn = np.asarray(syndrome, dtype=np.uint8)
    out = {"shot": shot, "dem": kind}
    if gap:
        g = decode_with_gap(noise, syn, tl)
        best = g["best"]
        out["na_gap"] = g["gap"]
        comp = g["complement"]
        out["na_comp_status"] = None if comp is None else comp.status
        out["na_comp_seconds"] = None if comp is None else comp.seconds
    else:
        best = solve(noise, syn, tl)
    out.update(na_status=best.status, na_pred=best.prediction, na_obj=best.objective, na_seconds=best.seconds,
               na_size=None if best.x is None else int(best.x.sum()))
    uni = solve(uniform, syn, tl)
    out.update(un_status=uni.status, un_pred=uni.prediction, un_obj=uni.objective, un_seconds=uni.seconds)
    return out


def ising_experiment(exp: ds.Experiment, shots: int, time_limit: float = 10.0, workers: int | None = None,
                     with_gap: bool = True, progress=None) -> dict:
    """Exact Ising/QUBO decoding of the first ``shots`` real shots, paired with every other method."""
    started = perf_counter()
    dets = exp.detection_events(shots)
    shots = dets.shape[0]
    actual = exp.observable_flips()[:shots]
    dem_texts = {k: exp.dem_text(k) for k in ("pij_even_for_odd", "pij_odd_for_even")}
    tasks = [(i, dets[i].astype(np.uint8), with_gap) for i in range(shots)]
    rows: list[dict] = []
    workers = workers or max(1, (os.cpu_count() or 2) - 2)
    with ProcessPoolExecutor(max_workers=workers, initializer=_init_worker,
                             initargs=(dem_texts, time_limit)) as pool:
        for k, row in enumerate(pool.map(_solve_shot, tasks, chunksize=8)):
            rows.append(row)
            if progress and (k + 1) % 200 == 0:
                progress(k + 1, shots)
    rows.sort(key=lambda r: r["shot"])
    preds = {}
    valid = {}
    for prefix, key in (("na", "ising_noise_aware"), ("un", "ising_uniform")):
        status = np.array([r[f"{prefix}_status"] for r in rows])
        pred = np.array([bool(r[f"{prefix}_pred"]) if r[f"{prefix}_pred"] is not None else False for r in rows])
        preds[key] = pred
        valid[key] = np.isin(status, ["optimal", "time_limit"])
    for config in mt.CONFIGS:
        preds[config] = mt.partitioned_predictions(exp, config, dets)["predictions"]
    for decoder, values in exp.google_predictions().items():
        preds[f"google_{decoder}"] = values[:shots]
    methods = {}
    for key, values in preds.items():
        entry = {**score(values, actual, valid.get(key)), "label": METHOD_LABELS[key]}
        if key in valid:
            prefix = "na" if key == "ising_noise_aware" else "un"
            statuses = [r[f"{prefix}_status"] for r in rows]
            entry["solver_status"] = {s: statuses.count(s) for s in sorted(set(statuses))}
            entry["runtime"] = runtime_summary([r[f"{prefix}_seconds"] * 1e6 for r in rows])
            entry["unsolved_counted_as_wrong"] = True
        methods[key] = entry
    paired = {}
    for ref in ("pymatching_pij", "pymatching_circuit"):
        ref_wrong = preds[ref] != actual
        paired[ref] = {}
        for key in ("ising_noise_aware", "ising_uniform"):
            wrong = (preds[key] != actual) | ~valid[key]
            paired[ref][key] = {**mcnemar_exact(wrong, ref_wrong), **paired_difference(wrong, ref_wrong)}
    na_wrong = (preds["ising_noise_aware"] != actual) | ~valid["ising_noise_aware"]
    un_wrong = (preds["ising_uniform"] != actual) | ~valid["ising_uniform"]
    ablation = {**mcnemar_exact(na_wrong, un_wrong), **paired_difference(na_wrong, un_wrong),
                "comparison": "noise-aware minus uniform failure rate on identical shots"}
    gap_analysis = None
    if with_gap:
        gap_analysis = analyse_gap(rows, actual, na_wrong)
    return {"experiment": exp.summary(), "shots_evaluated": shots, "shot_range": [0, shots],
            "time_limit_seconds": time_limit, "workers": workers, "methods": methods,
            "paired": paired, "ablation_noise_aware_vs_uniform": ablation, "gap_analysis": gap_analysis,
            "per_shot": {"ising_noise_aware": [int(v) for v in preds["ising_noise_aware"]],
                         "ising_uniform": [int(v) for v in preds["ising_uniform"]],
                         "na_status": [r["na_status"] for r in rows], "un_status": [r["un_status"] for r in rows],
                         "na_gap": [r.get("na_gap") for r in rows],
                         "na_objective": [r["na_obj"] for r in rows],
                         "na_mechanisms": [r["na_size"] for r in rows],
                         "na_seconds": [r["na_seconds"] for r in rows]},
            "seconds": perf_counter() - started}


def analyse_gap(rows: list[dict], actual: np.ndarray, wrong: np.ndarray) -> dict:
    """Validation/held-out study of the complementary (logical) gap as a failure warning.

    Thresholds are chosen on EVEN shots (decoded with the odd-calibrated model) and evaluated on ODD
    shots (decoded with the even-calibrated model), so the test shots influence neither the model
    nor the threshold.
    """
    gaps = np.array([np.nan if r.get("na_gap") is None else r["na_gap"] for r in rows], dtype=float)
    idx = np.arange(len(rows))
    have = ~np.isnan(gaps)
    val = have & (idx % 2 == 0)
    test = have & (idx % 2 == 1)
    out = {"definition": ("Complementary gap: E(best solution whose observable prediction is flipped) - E(best "
                          "solution), in nats. exp(-gap) compares two single explanations, not class probabilities."),
           "validation": "even shots", "held_out": "odd shots", "shots_with_gap": int(have.sum())}
    if val.sum() < 50 or test.sum() < 50:
        out["status"] = "insufficient shots"
        return out
    out["auroc_validation"] = auroc(-gaps[val], wrong[val])
    out["auroc_held_out"] = auroc(-gaps[test], wrong[test])
    # Choose the gap threshold on validation shots that flags ~10% of shots (lowest gaps).
    target = 0.10
    thresh = float(np.quantile(gaps[val], target))
    out["threshold_rule"] = f"validation {int(target * 100)}th percentile of the gap"
    out["threshold"] = thresh
    for name, mask in (("validation", val), ("held_out", test)):
        flagged = mask & (gaps <= thresh)
        unflagged = mask & (gaps > thresh)
        out[name + "_flagged"] = proportion(int(wrong[flagged].sum()), int(flagged.sum()))
        out[name + "_unflagged"] = proportion(int(wrong[unflagged].sum()), int(unflagged.sum()))
    edges = np.quantile(gaps[test], [0, 0.2, 0.4, 0.6, 0.8, 1.0])
    bins = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = test & (gaps >= lo) & (gaps <= hi)
        bins.append({"gap_range": [float(lo), float(hi)], **proportion(int(wrong[mask].sum()), int(mask.sum()))})
    out["held_out_quintiles"] = bins
    out["histogram"] = _hist(gaps[have], wrong[have])
    return out


def _hist(values: np.ndarray, wrong: np.ndarray, bins: int = 24) -> dict:
    hi = float(np.quantile(values, 0.995)) if values.size else 1.0
    edges = np.linspace(0, max(hi, 1e-9), bins + 1)
    clipped = np.clip(values, 0, edges[-1])
    ok, _ = np.histogram(clipped[~wrong], edges)
    bad, _ = np.histogram(clipped[wrong], edges)
    return {"edges": edges.tolist(), "correct": ok.tolist(), "failed": bad.tolist()}


def summarize_rate(entry: dict) -> str:
    low, high = entry["ci95"]
    return f"{entry['rate']:.4f} [{low:.4f}, {high:.4f}]"


def wilson_upper(count: int, trials: int) -> float:
    return wilson(count, trials)[1]
