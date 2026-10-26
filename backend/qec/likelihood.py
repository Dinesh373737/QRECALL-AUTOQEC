"""Negative log-likelihood energies for syndrome-conditioned X-error candidates.

For a candidate data-error pattern ``e`` and observed syndrome ``y``::

    s(e) = H e mod 2                 predicted (ideal) syndrome
    d    = y XOR s(e)                readout flips needed to explain y
    E(e|y) = -sum_i [e_i ln p_i + (1-e_i) ln(1-p_i)]
             -sum_j [d_j ln q_j + (1-d_j) ln(1-q_j)]

``exp(-E)`` is the joint probability P(e, d) under independent Bernoulli data and
readout errors, so the minimum-energy candidate is the most probable explanation of
``y`` under the *declared* model. The energy gap is a model-based ambiguity indicator;
it becomes a calibrated probability only when the declared model matches the noise.
"""
from __future__ import annotations

import math

import numpy as np

from .codes import RepetitionCode, bits_to_string

TIE_DECIMALS = 12


def bernoulli_nll(bits: np.ndarray, probs: np.ndarray) -> np.ndarray:
    """Row-wise -ln P(bits) for independent Bernoulli(probs); impossible rows return +inf."""
    b = np.asarray(bits, dtype=np.uint8)
    p = np.asarray(probs, dtype=np.float64)
    with np.errstate(divide="ignore"):
        on = np.where(p > 0, -np.log(np.where(p > 0, p, 1.0)), np.inf)
        off = np.where(p < 1, -np.log1p(-np.where(p < 1, p, 0.0)), np.inf)
    terms = np.where(b == 1, on, off)
    return terms.sum(axis=-1)


def validate_probabilities(values, width: int, name: str, low: float = 0.0, high: float = 0.5) -> np.ndarray:
    arr = np.asarray(values, dtype=np.float64).reshape(-1)
    if arr.size == 1:
        arr = np.full(width, float(arr[0]))
    if arr.size != width:
        raise ValueError(f"{name} must contain {width} probabilities.")
    if not np.all(np.isfinite(arr)) or np.any(arr < low) or np.any(arr > high):
        raise ValueError(f"{name} must lie between {low} and {high}.")
    return arr


def energy_terms(code: RepetitionCode, observed: np.ndarray, p: np.ndarray, q: np.ndarray) -> dict[str, np.ndarray]:
    """Vectorized energy decomposition for all 2^n candidates."""
    y = np.asarray(observed, dtype=np.uint8)
    candidates = code.patterns
    predicted = code.syndrome(candidates)
    readout = predicted ^ y[None, :]
    data = bernoulli_nll(candidates, p)
    ro = bernoulli_nll(readout, q)
    return {"candidates": candidates, "predicted": predicted, "readout": readout,
            "data_energy": data, "readout_energy": ro, "energy": data + ro}


def ranking_order(code: RepetitionCode, energy: np.ndarray) -> np.ndarray:
    """Deterministic ranking: energy, then Hamming weight, then binary string (qubit 0 first)."""
    rounded = np.where(np.isfinite(energy), np.round(energy, TIE_DECIMALS), np.inf)
    weights = code.patterns.sum(axis=1)
    index = np.arange(len(energy))  # index order equals lexicographic order of the strings
    return np.lexsort((index, weights, rounded))


def posterior(energy: np.ndarray) -> np.ndarray:
    finite = np.isfinite(energy)
    if not finite.any():
        raise ValueError("No error candidate can explain the observed syndrome under the declared model.")
    shifted = np.where(finite, np.exp(-(energy - energy[finite].min())), 0.0)
    return shifted / shifted.sum()


def _finite(value: float) -> float | None:
    return float(value) if math.isfinite(value) else None


def logical_class_summary(code: RepetitionCode, energy: np.ndarray, post: np.ndarray, correction: np.ndarray) -> dict:
    """Group candidates by the logical outcome they would produce if the correction were applied."""
    residuals = code.patterns ^ np.asarray(correction, dtype=np.uint8)[None, :]
    flips = code.logical_flip(residuals)
    exact = ~residuals.any(axis=1)
    p_keep = float(post[flips == 0].sum())
    p_flip = float(post[flips == 1].sum())

    def best(mask):
        idx = np.flatnonzero(mask & np.isfinite(energy))
        if not idx.size:
            return None
        k = idx[np.argmin(energy[idx])]
        return {"candidate": bits_to_string(code.patterns[k]), "energy": float(energy[k])}

    best_keep, best_flip = best(flips == 0), best(flips == 1)
    gap = None
    if best_keep and best_flip:
        gap = best_flip["energy"] - best_keep["energy"]
    margin = None
    if p_keep > 0 and p_flip > 0:
        margin = math.log(p_keep) - math.log(p_flip)
    return {"correction": bits_to_string(correction),
            "p_logical_preserved": p_keep, "p_logical_flip": p_flip,
            "p_exact_restoration": float(post[exact].sum()),
            "logical_margin_nats": margin,
            "best_preserving_candidate": best_keep, "best_flipping_candidate": best_flip,
            "logical_energy_gap": gap,
            "meaning": ("Model posterior probability that the logical value survives an ideal final round if this "
                        "correction is applied. It is calibrated only when the declared noise model is correct.")}


def candidate_analysis(code: RepetitionCode, observed, p, q, actual_error=None) -> dict:
    """Exact enumeration of every candidate with energy decomposition, rank and logical consequences."""
    p = validate_probabilities(p, code.n, "Data-error probabilities", 1e-6, 0.5)
    q = validate_probabilities(q, code.m, "Readout-error probabilities", 0.0, 0.5)
    y = np.asarray(observed, dtype=np.uint8)
    if y.shape != (code.m,) or np.any(y > 1):
        raise ValueError(f"The observed syndrome must contain {code.m} bits.")
    terms = energy_terms(code, y, p, q)
    energy = terms["energy"]
    order = ranking_order(code, energy)
    post = posterior(energy)
    best = order[0]
    best_pattern = code.patterns[best]
    rank = np.empty(len(order), dtype=int)
    rank[order] = np.arange(1, len(order) + 1)
    finite_order = [k for k in order if np.isfinite(energy[k])]
    second = finite_order[1] if len(finite_order) > 1 else None
    actual = None if actual_error is None else np.asarray(actual_error, dtype=np.uint8)

    rows = []
    for k in order:
        e = code.patterns[k]
        residual_vs_best = e ^ best_pattern
        row = {"rank": int(rank[k]), "candidate": bits_to_string(e), "weight": int(e.sum()),
               "predicted_syndrome": bits_to_string(terms["predicted"][k]),
               "readout_flips": bits_to_string(terms["readout"][k]),
               "data_energy": _finite(terms["data_energy"][k]),
               "readout_energy": _finite(terms["readout_energy"][k]),
               "energy": _finite(energy[k]), "possible": bool(np.isfinite(energy[k])),
               "posterior": float(post[k]),
               "delta_from_best": _finite(energy[k] - energy[best]) if np.isfinite(energy[k]) else None,
               # Degeneracy: would correcting for the best candidate still preserve the logical value
               # if this candidate were the true error?
               "logically_equivalent_to_best": not bool(code.logical_flip(residual_vs_best))}
        if actual is not None:
            residual = actual ^ e
            row["if_applied_outcome"] = code.classify_residual(residual)
            row["preserves_logical"] = not bool(code.logical_flip(residual))
            row["is_actual_error"] = bool(np.array_equal(actual, e))
        rows.append(row)

    gap = None if second is None else float(energy[second] - energy[best])
    return {"observed_syndrome": bits_to_string(y), "p": p.tolist(), "q": q.tolist(),
            "candidates": rows, "best": bits_to_string(best_pattern),
            "second": None if second is None else bits_to_string(code.patterns[second]),
            "energy_gap": gap,
            "energy_gap_meaning": ("E(second) - E(best) in nats: how much less likely the runner-up explanation is "
                                   "under the declared model (ratio exp(-gap)). It is an ambiguity indicator, not a "
                                   "calibrated probability that recovery succeeds."),
            "best_vs_second_logically_equivalent": None if second is None else
                not bool(code.logical_flip(best_pattern ^ code.patterns[second])),
            "posterior_best": float(post[best]),
            "logical_classes": logical_class_summary(code, energy, post, best_pattern),
            "tie_breaking": "energy (rounded to 1e-12), then Hamming weight, then binary string with qubit 0 first",
            "_energy": energy, "_posterior": post, "_order": order}


def strip_private(analysis: dict) -> dict:
    return {k: v for k, v in analysis.items() if not k.startswith("_")}
