"""Binomial uncertainty, paired decoder comparisons and calibration summaries.

Shared by the simulation benchmarks (Module 1) and the Google hardware benchmarks
(Module 2). Every interval is a 95% interval unless stated otherwise.
"""
from __future__ import annotations

import math

import numpy as np

Z95 = 1.959963984540054


def wilson(successes: int, trials: int, z: float = Z95) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion."""
    if trials <= 0:
        return (0.0, 1.0)
    k, n = float(successes), float(trials)
    phat = k / n
    denom = 1 + z * z / n
    centre = (phat + z * z / (2 * n)) / denom
    half = z * math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n)) / denom
    low = 0.0 if successes == 0 else max(0.0, centre - half)
    high = 1.0 if successes == trials else min(1.0, centre + half)
    return (low, high)


def clopper_pearson(successes: int, trials: int, alpha: float = 0.05) -> tuple[float, float]:
    if trials <= 0:
        return (0.0, 1.0)
    k, n = successes, trials
    from scipy import stats  # imported lazily: scipy.stats is slow to import

    low = 0.0 if k == 0 else float(stats.beta.ppf(alpha / 2, k, n - k + 1))
    high = 1.0 if k == n else float(stats.beta.ppf(1 - alpha / 2, k + 1, n - k))
    return (low, high)


def proportion(successes: int, trials: int) -> dict:
    low, high = wilson(successes, trials)
    return {"count": int(successes), "trials": int(trials),
            "rate": (successes / trials) if trials else None, "ci95": [low, high], "interval": "Wilson score"}


def mcnemar_exact(a_wrong: np.ndarray, b_wrong: np.ndarray) -> dict:
    """Exact two-sided McNemar test on paired failure indicators of two decoders."""
    a = np.asarray(a_wrong, dtype=bool)
    b = np.asarray(b_wrong, dtype=bool)
    if a.shape != b.shape:
        raise ValueError("Paired comparisons need predictions for the same shots.")
    only_a = int(np.sum(a & ~b))
    only_b = int(np.sum(~a & b))
    both = int(np.sum(a & b))
    discordant = only_a + only_b
    from scipy import stats

    p_value = 1.0 if discordant == 0 else float(stats.binomtest(only_a, discordant, 0.5).pvalue)
    return {"only_a_wrong": only_a, "only_b_wrong": only_b, "both_wrong": both,
            "neither_wrong": int(a.size - only_a - only_b - both), "discordant": discordant,
            "p_value": p_value, "test": "exact McNemar (binomial on discordant pairs)"}


def paired_difference(a_wrong: np.ndarray, b_wrong: np.ndarray, seed: int = 2026, resamples: int = 4000) -> dict:
    """Failure-rate difference (a - b) with a seeded multinomial bootstrap over paired outcome cells."""
    a = np.asarray(a_wrong, dtype=bool)
    b = np.asarray(b_wrong, dtype=bool)
    n = a.size
    cells = np.array([np.sum(a & ~b), np.sum(~a & b), np.sum(a & b), np.sum(~a & ~b)], dtype=np.int64)
    diff = (cells[0] - cells[1]) / n if n else 0.0
    if n == 0:
        return {"difference": None, "ci95": [None, None]}
    rng = np.random.default_rng(seed)
    draws = rng.multinomial(n, cells / n, size=resamples)
    boot = (draws[:, 0] - draws[:, 1]) / n
    low, high = np.quantile(boot, [0.025, 0.975])
    return {"difference": float(diff), "ci95": [float(low), float(high)],
            "method": f"paired multinomial bootstrap, {resamples} resamples, seed {seed}"}


def auroc(scores: np.ndarray, positives: np.ndarray) -> float | None:
    """Probability that a random positive has a higher score than a random negative (ties count 1/2)."""
    s = np.asarray(scores, dtype=np.float64)
    y = np.asarray(positives, dtype=bool)
    pos, neg = int(y.sum()), int((~y).sum())
    if pos == 0 or neg == 0:
        return None
    from scipy import stats

    ranks = stats.rankdata(s)
    return float((ranks[y].sum() - pos * (pos + 1) / 2) / (pos * neg))


def reliability_bins(predicted_success: np.ndarray, actual_success: np.ndarray, bins: int = 10) -> list[dict]:
    """Reliability-diagram bins: mean predicted probability against observed success frequency."""
    p = np.clip(np.asarray(predicted_success, dtype=np.float64), 0, 1)
    y = np.asarray(actual_success, dtype=bool)
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for i in range(bins):
        mask = (p >= edges[i]) & ((p < edges[i + 1]) if i < bins - 1 else (p <= edges[i + 1]))
        count = int(mask.sum())
        if not count:
            continue
        successes = int(y[mask].sum())
        low, high = wilson(successes, count)
        out.append({"bin": [float(edges[i]), float(edges[i + 1])], "count": count,
                    "mean_predicted": float(p[mask].mean()), "observed": successes / count, "ci95": [low, high]})
    return out


def expected_calibration_error(bins_: list[dict]) -> float | None:
    total = sum(b["count"] for b in bins_)
    if not total:
        return None
    return float(sum(b["count"] * abs(b["mean_predicted"] - b["observed"]) for b in bins_) / total)


def runtime_summary(samples_us) -> dict:
    arr = np.asarray(samples_us, dtype=np.float64)
    if arr.size == 0:
        return {"count": 0}
    return {"count": int(arr.size), "median_us": float(np.median(arr)), "mean_us": float(arr.mean()),
            "p95_us": float(np.quantile(arr, 0.95)), "max_us": float(arr.max()), "min_us": float(arr.min())}
