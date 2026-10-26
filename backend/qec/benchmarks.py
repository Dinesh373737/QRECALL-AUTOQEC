"""Module 1 simulation benchmarks (seeded, vectorized, reproducible).

Every number here is SIMULATED. Each section records its seed, shot count and noise parameters.
Decision tables are computed once per (code, declared model) and applied to sampled syndromes;
``exact_reference`` (pure Python) independently checks the vectorized tables in ``agreement``.
"""
from __future__ import annotations

import hashlib
import json
from time import perf_counter_ns

import numpy as np

from .codes import RepetitionCode, bits_to_string
from .decoders import DECODERS, decode, exact_reference, syndrome_index
from .likelihood import bernoulli_nll, candidate_analysis
from .noise import bernoulli, streams
from .statistics import auroc, expected_calibration_error, proportion, reliability_bins, runtime_summary

ACTIVE = ("lookup", "energy", "exact")


def _keep_matrix(code: RepetitionCode) -> np.ndarray:
    """keep[k, c] = 1 if correcting with pattern c preserves the logical value when pattern k occurred."""
    pats = code.patterns
    residual = pats[:, None, :] ^ pats[None, :, :]
    return (residual.sum(axis=2) <= code.n // 2).astype(np.float64)


def batch_energies(code: RepetitionCode, observed: np.ndarray, p: np.ndarray, q: np.ndarray) -> np.ndarray:
    """(N, 2^n) energies for N observed syndromes with per-row (N, n)/(N, m) or shared probabilities."""
    pats = code.patterns.astype(np.float64)                      # K x n
    pred = code.syndrome(code.patterns)                           # K x m
    p = np.clip(np.broadcast_to(np.asarray(p, dtype=np.float64), (observed.shape[0], code.n)), 1e-12, 1 - 1e-12)
    q = np.broadcast_to(np.asarray(q, dtype=np.float64), (observed.shape[0], code.m))
    with np.errstate(divide="ignore"):
        lp, l1p = np.log(p), np.log1p(-p)
        lq, l1q = np.where(q > 0, np.log(np.where(q > 0, q, 1)), -np.inf), np.log1p(-q)
    data = -(lp @ pats.T + l1p @ (1 - pats).T)                   # N x K
    readout = pred[None, :, :] ^ observed[:, None, :]             # N x K x m
    ro_on = np.where(readout == 1, -lq[:, None, :], 0.0)
    ro_off = np.where(readout == 0, -l1q[:, None, :], 0.0)
    return data + (ro_on + ro_off).sum(axis=2)


def _staged_argmin(keys: list[np.ndarray]) -> np.ndarray:
    """Row-wise lexicographic argmin over several (N, K) key arrays (earlier keys dominate)."""
    alive = np.ones(keys[0].shape, dtype=bool)
    for key in keys:
        masked = np.where(alive, key, np.inf)
        alive &= masked == masked.min(axis=1, keepdims=True)
    return np.argmax(alive, axis=1)  # first surviving column = smallest index


def batch_decisions(code: RepetitionCode, energies: np.ndarray) -> dict:
    """MAP and Bayes-logical corrections plus indicators for every row of an energy matrix."""
    n_rows, k = energies.shape
    weights = np.broadcast_to(code.patterns.sum(axis=1)[None, :].astype(float), (n_rows, k))
    finite = np.isfinite(energies)
    rounded = np.where(finite, np.round(energies, 12), np.inf)
    rows = np.arange(n_rows)
    # MAP: lexicographic (energy, weight, index), identical to likelihood.ranking_order.
    best = _staged_argmin([rounded, weights])
    without_best = rounded.copy()
    without_best[rows, best] = np.inf
    second_energy = without_best.min(axis=1)
    gap = np.where(np.isfinite(second_energy), second_energy - rounded[rows, best], np.inf)
    shifted = energies - np.min(np.where(finite, energies, np.inf), axis=1, keepdims=True)
    post = np.where(finite, np.exp(-shifted), 0.0)
    post /= post.sum(axis=1, keepdims=True)
    keep = _keep_matrix(code)
    p_keep = post @ keep                                          # N x K (for every candidate correction)
    # Bayes-logical: maximize p_keep, then exact-restoration posterior, then weight, then index.
    bayes = _staged_argmin([-np.round(p_keep, 12), -np.round(post, 12), weights])
    keep_map = p_keep[rows, best]
    with np.errstate(divide="ignore"):
        margin = np.log(keep_map) - np.log1p(-keep_map)
    return {"map": best, "bayes": bayes, "gap": gap, "p_keep_map": keep_map, "p_keep_bayes": p_keep[rows, bayes],
            "logical_margin_map": margin, "posterior_map": post[rows, best]}


def tables(code: RepetitionCode, p, q) -> dict[str, np.ndarray]:
    """Correction table (2^m x n) for every decoder under one declared model."""
    s = 2 ** code.m
    y = ((np.arange(s)[:, None] >> np.arange(code.m - 1, -1, -1)[None, :]) & 1).astype(np.uint8)
    dec = batch_decisions(code, batch_energies(code, y, p, q))
    lookup = code.lookup_table()
    return {"none": np.zeros((s, code.n), dtype=np.uint8),
            "lookup": np.array([[int(c) for c in lookup[bits_to_string(row)]] for row in y], dtype=np.uint8),
            "energy": code.patterns[dec["map"]], "exact": code.patterns[dec["bayes"]],
            "_gap": dec["gap"], "_p_keep": dec["p_keep_map"]}


def simulate(code: RepetitionCode, p_true, q_true, p_model, q_model, shots: int, seed: int,
             decoders=ACTIVE) -> dict:
    rng = streams(seed)
    flips = bernoulli(rng["data"], np.broadcast_to(p_true, code.n), shots)
    readout = bernoulli(rng["readout"], np.broadcast_to(q_true, code.m), shots)
    observed = code.syndrome(flips) ^ readout
    idx = syndrome_index(code, observed)
    tab = tables(code, p_model, q_model)
    out = {"unprotected": proportion(int(flips[:, 0].sum()), shots)}
    digests = hashlib.sha256(flips.tobytes() + readout.tobytes())
    for name in decoders:
        residual = flips ^ tab[name][idx]
        logical = code.logical_flip(residual)
        out[name] = {**proportion(int(logical.sum()), shots),
                     "not_restored": proportion(int(residual.any(axis=1).sum()), shots)}
        digests.update(logical.tobytes())
    out["digest"] = digests.hexdigest()[:16]
    return out


def _grid_sweep(name: str, points: list[dict], shots: int, seed: int) -> dict:
    rows = []
    for k, pt in enumerate(points):
        code = RepetitionCode(pt["distance"])
        res = simulate(code, pt["p"], pt["q"], pt.get("p_model", pt["p"]), pt.get("q_model", pt["q"]), shots,
                       seed + k)
        rows.append({**{key: (list(map(float, np.atleast_1d(v))) if isinstance(v, (list, np.ndarray)) else v)
                        for key, v in pt.items()}, "seed": seed + k, "shots": shots, "results": res})
    return {"name": name, "shots_per_point": shots, "base_seed": seed, "points": rows,
            "kind": "simulation"}


def logical_vs_p(shots: int, seed: int, q: float) -> dict:
    grid = [0.005, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3]
    pts = [{"distance": d, "p": p, "q": q} for d in (3, 5, 7) for p in grid]
    return _grid_sweep("logical_vs_p", pts, shots, seed)


def readout_sweep(shots: int, seed: int, p: float) -> dict:
    grid = [0.0, 0.005, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.15, 0.2, 0.3]
    return _grid_sweep("readout_sweep", [{"distance": 3, "p": p, "q": q} for q in grid], shots, seed)


def asymmetric_sweep(shots: int, seed: int, p: float, q: float) -> dict:
    grid = [0.01, 0.03, 0.05, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.4, 0.5]
    pts = [{"distance": 3, "p": [bad, p, p], "q": q, "bad_qubit_p": bad} for bad in grid]
    return _grid_sweep("asymmetric_sweep", pts, shots, seed)


def agreement(seed: int) -> dict:
    """Vectorized tables vs the pure-Python exact reference, and energies vs -ln(joint probability)."""
    rng = np.random.default_rng(seed)
    configs = [{"distance": d, "p": rng.uniform(0.01, 0.3, d).round(4).tolist(),
                "q": rng.uniform(0.0, 0.2, d - 1).round(4).tolist()} for d in (3, 3, 3, 5, 5) for _ in range(4)]
    configs.insert(0, {"distance": 3, "p": [0.1] * 3, "q": [0.1] * 2})  # contains exact energy ties
    rows, max_energy_err = [], 0.0
    for cfg in configs:
        code = RepetitionCode(cfg["distance"])
        tab = tables(code, cfg["p"], cfg["q"])
        diff_map_bayes = mismatch_oracle = 0
        for k in range(2 ** code.m):
            y = [(k >> (code.m - 1 - j)) & 1 for j in range(code.m)]
            ref = exact_reference(code, y, cfg["p"], cfg["q"])
            a = candidate_analysis(code, y, cfg["p"], cfg["q"])
            for row in a["candidates"]:
                joint = ref["joint_probability"][row["candidate"]]
                if joint > 0 and row["energy"] is not None:
                    max_energy_err = max(max_energy_err, abs(row["energy"] + np.log(joint)))
            mismatch_oracle += bits_to_string(tab["exact"][k]) != ref["correction"]
            mismatch_oracle += bits_to_string(tab["energy"][k]) != a["best"]
            diff_map_bayes += bits_to_string(tab["energy"][k]) != ref["correction"]
        rows.append({**cfg, "syndromes": 2 ** code.m, "vectorized_vs_reference_mismatches": int(mismatch_oracle),
                     "energy_vs_bayes_different_corrections": int(diff_map_bayes)})
    return {"configs": rows, "max_abs_energy_minus_neg_log_joint": max_energy_err,
            "all_tables_match_reference": all(r["vectorized_vs_reference_mismatches"] == 0 for r in rows),
            "note": ("The energy (MAP) decoder and the Bayes reference legitimately differ on some syndromes: MAP picks "
                     "the single most probable error; the reference maximizes the probability that the logical value "
                     "survives, which can favour a less likely correction when several explanations share a logical "
                     "outcome (degeneracy across readout explanations).")}


def margin_study(shots: int, seed: int, flag_fraction: float = 0.1, mismatch: dict | None = None) -> dict:
    """Do energy gaps / logical margins predict failures on HELD-OUT trials?

    Each trial draws its own (known) noise parameters, p_i ~ U(0.005, 0.2), q_j ~ U(0, 0.15), so the
    decoder sees varied conditions. A flagging threshold is chosen on the validation seed and frozen
    before the held-out seed is evaluated.
    """
    code = RepetitionCode(3)

    def run(s: int):
        rng = np.random.default_rng(s)
        p = rng.uniform(0.005, 0.2, (shots, 3))
        q = rng.uniform(0.0, 0.15, (shots, 2))
        flips = (rng.random((shots, 3)) < p).astype(np.uint8)
        readout = (rng.random((shots, 2)) < q).astype(np.uint8)
        observed = code.syndrome(flips) ^ readout
        pm = p if mismatch is None else np.full_like(p, mismatch["p"])
        qm = q if mismatch is None else np.full_like(q, mismatch["q"])
        dec = batch_decisions(code, batch_energies(code, observed, pm, qm))
        failed = code.logical_flip(flips ^ code.patterns[dec["map"]]).astype(bool)
        return dec, failed

    val, val_fail = run(seed)
    test, test_fail = run(seed + 1)
    gap_v, gap_t = val["gap"], test["gap"]
    thresh = float(np.quantile(gap_v, flag_fraction))
    out = {"validation_seed": seed, "held_out_seed": seed + 1, "shots_each": shots, "decoder": "energy (MAP)",
           "model": "per-trial calibrated" if mismatch is None else f"mismatched: assumes p={mismatch['p']}, q={mismatch['q']}",
           "threshold_rule": f"flag the lowest {int(flag_fraction * 100)}% energy gaps on the validation set",
           "threshold": thresh,
           "auroc_gap_validation": auroc(-gap_v, val_fail), "auroc_gap_held_out": auroc(-gap_t, test_fail),
           "auroc_logical_margin_held_out": auroc(-test["logical_margin_map"], test_fail),
           "validation_flagged": proportion(int(val_fail[gap_v <= thresh].sum()), int((gap_v <= thresh).sum())),
           "validation_unflagged": proportion(int(val_fail[gap_v > thresh].sum()), int((gap_v > thresh).sum())),
           "held_out_flagged": proportion(int(test_fail[gap_t <= thresh].sum()), int((gap_t <= thresh).sum())),
           "held_out_unflagged": proportion(int(test_fail[gap_t > thresh].sum()), int((gap_t > thresh).sum())),
           "held_out_failure": proportion(int(test_fail.sum()), shots)}
    edges = np.quantile(gap_t, np.linspace(0, 1, 6))
    out["held_out_by_gap_quintile"] = [
        {"gap_range": [float(lo), float(hi)],
         **proportion(int(test_fail[(gap_t >= lo) & (gap_t <= hi)].sum()), int(((gap_t >= lo) & (gap_t <= hi)).sum()))}
        for lo, hi in zip(edges[:-1], edges[1:])]
    hist_edges = np.linspace(0, float(np.quantile(gap_t, 0.99)), 25)
    clipped = np.clip(gap_t, 0, hist_edges[-1])
    out["held_out_histogram"] = {"edges": hist_edges.tolist(),
                                 "correct": np.histogram(clipped[~test_fail], hist_edges)[0].tolist(),
                                 "failed": np.histogram(clipped[test_fail], hist_edges)[0].tolist()}
    bins = reliability_bins(test["p_keep_map"], ~test_fail)
    out["calibration"] = {"bins": bins, "ece": expected_calibration_error(bins),
                          "predicted": "model posterior P(logical preserved | syndrome) for the MAP correction"}
    return out


def runtime(repeats: int = 400, seed: int = 3) -> dict:
    code = RepetitionCode(3)
    rng = np.random.default_rng(seed)
    out = {}
    for name in DECODERS:
        samples = []
        for _ in range(repeats):
            y = rng.integers(0, 2, 2)
            t = perf_counter_ns()
            decode(code, name, y, [0.05] * 3, [0.02] * 2)
            samples.append((perf_counter_ns() - t) / 1000)
        out[name] = runtime_summary(samples)
    t = perf_counter_ns()
    simulate(code, 0.05, 0.02, 0.05, 0.02, 200_000, seed)
    out["vectorized_batch"] = {"shots": 200_000, "seconds": (perf_counter_ns() - t) / 1e9,
                               "note": "table lookup after one decision-table build per declared model"}
    return out


def run_all(cfg: dict) -> dict:
    shots = int(cfg.get("shots", 20000))
    seed = int(cfg.get("seed", 20261026))
    p = float(cfg.get("p", 0.05))
    q = float(cfg.get("q", 0.02))
    started = perf_counter_ns()
    result = {"schema_version": "qec-sim-bench-1", "kind": "simulation",
              "config": {"shots": shots, "seed": seed, "p": p, "q": q},
              "logical_vs_p": logical_vs_p(shots, seed, 0.0),
              "logical_vs_p_readout": logical_vs_p(shots, seed + 1000, q),
              "readout_sweep": readout_sweep(shots, seed + 2000, p),
              "asymmetric_sweep": asymmetric_sweep(shots, seed + 3000, p, q),
              "agreement": agreement(seed + 4000),
              "margin_study": margin_study(shots, seed + 5000),
              "margin_study_mismatched": margin_study(shots, seed + 5000, mismatch={"p": 0.05, "q": 0.02}),
              "runtime": runtime()}
    repeat = simulate(RepetitionCode(3), p, q, p, q, shots, seed)
    again = simulate(RepetitionCode(3), p, q, p, q, shots, seed)
    result["reproducibility"] = {"seed": seed, "first_digest": repeat["digest"], "second_digest": again["digest"],
                                 "identical": repeat["digest"] == again["digest"]}
    result["duration_seconds"] = (perf_counter_ns() - started) / 1e9
    return result


def to_csv_rows(result: dict) -> list[dict]:
    rows = []
    for section in ("logical_vs_p", "logical_vs_p_readout", "readout_sweep", "asymmetric_sweep"):
        for pt in result[section]["points"]:
            for method, res in pt["results"].items():
                if method == "digest":
                    continue
                rows.append({"section": section, "distance": pt["distance"], "p": json.dumps(pt["p"]),
                             "q": pt["q"], "seed": pt["seed"], "shots": pt["shots"], "method": method,
                             "failures": res["count"], "rate": res["rate"], "ci_low": res["ci95"][0],
                             "ci_high": res["ci95"][1],
                             "not_restored": res.get("not_restored", {}).get("rate")})
    return rows
