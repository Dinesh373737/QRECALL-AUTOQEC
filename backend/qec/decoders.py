"""Decoding strategies for the bit-flip repetition code.

* ``none``    -- applies no active correction (the ideal final round still majority-votes).
* ``lookup``  -- trusts the measured syndrome and applies the minimum-weight table entry.
* ``energy``  -- likelihood decoder: minimum-energy (most probable) explanation of the
                 observed syndrome under the declared data/readout noise model.
* ``exact``   -- exhaustive Bayes reference: enumerates every candidate with direct
                 probability products (an implementation independent of the vectorized
                 energies) and chooses the correction that maximizes the posterior
                 probability that the logical value survives the declared recovery
                 convention. Ties prefer the higher exact-restoration probability, then
                 lower weight, then the lexicographically first string.

The exact reference is a correctness oracle for this tiny model. It is not evidence that
the likelihood decoder is a new algorithm.
"""
from __future__ import annotations

import math
from time import perf_counter_ns

import numpy as np

from .codes import RepetitionCode, bits_to_string, string_to_bits
from .likelihood import candidate_analysis, validate_probabilities

DECODERS = {
    "none": {"label": "No correction", "short": "None",
             "description": "Applies no correction. The ideal final round still majority-votes the data."},
    "lookup": {"label": "Lookup table", "short": "Lookup",
               "description": "Trusts the measured syndrome and applies the minimum-weight correction from a fixed table."},
    "energy": {"label": "Likelihood (energy) decoder", "short": "Energy",
               "description": "Chooses the minimum negative log-likelihood explanation of the syndrome, including readout errors."},
    "exact": {"label": "Exact Bayes reference", "short": "Exact",
              "description": "Brute-force posterior over all candidates; maximizes the probability that the logical value survives."},
}


def exact_reference(code: RepetitionCode, observed, p, q) -> dict:
    """Pure-Python enumeration with explicit probability products (no shared energy code)."""
    p = validate_probabilities(p, code.n, "Data-error probabilities", 1e-6, 0.5).tolist()
    q = validate_probabilities(q, code.m, "Readout-error probabilities", 0.0, 0.5).tolist()
    y = [int(b) for b in observed]
    n, m = code.n, code.m
    patterns = [tuple(int(b) for b in row) for row in code.patterns]
    joint = []
    for e in patterns:
        s = [(e[j] + e[j + 1]) % 2 for j in range(m)]
        d = [y[j] ^ s[j] for j in range(m)]
        prob = math.prod(p[i] if e[i] else 1 - p[i] for i in range(n))
        prob *= math.prod(q[j] if d[j] else 1 - q[j] for j in range(m))
        joint.append(prob)
    total = sum(joint)
    if total <= 0:
        raise ValueError("No error candidate can explain the observed syndrome under the declared model.")
    post = [v / total for v in joint]
    scored = []
    for index, c in enumerate(patterns):
        keep = sum(post[k] for k, e in enumerate(patterns)
                   if sum(a ^ b for a, b in zip(e, c)) <= n // 2)
        scored.append((-round(keep, 12), -round(post[index], 12), sum(c), c, keep))
    scored.sort()
    choice = scored[0]
    return {"correction": "".join(map(str, choice[3])), "p_logical_preserved": choice[4],
            "posterior": {"".join(map(str, e)): post[k] for k, e in enumerate(patterns)},
            "joint_probability": {"".join(map(str, e)): joint[k] for k, e in enumerate(patterns)},
            "evidence": total}


def decode(code: RepetitionCode, decoder: str, observed, p, q) -> dict:
    """Return the correction string and the structured evidence behind it."""
    y = np.asarray(observed, dtype=np.uint8)
    started = perf_counter_ns()
    if decoder == "none":
        correction = "0" * code.n
        evidence = {"rule": "No active correction is applied."}
    elif decoder == "lookup":
        table = code.lookup_table()
        correction = table[bits_to_string(y)]
        evidence = {"rule": "Minimum-weight X correction for the measured syndrome, assuming it is error-free.",
                    "table": table}
    elif decoder == "energy":
        analysis = candidate_analysis(code, y, p, q)
        correction = analysis["best"]
        evidence = {"rule": "Minimum negative log-likelihood candidate (most probable explanation).",
                    "energy_gap": analysis["energy_gap"], "second": analysis["second"]}
    elif decoder == "exact":
        ref = exact_reference(code, y, p, q)
        correction = ref["correction"]
        evidence = {"rule": "Maximizes the exact posterior probability that the logical value survives.",
                    "p_logical_preserved": ref["p_logical_preserved"]}
    else:
        raise ValueError(f"Unknown decoder '{decoder}'.")
    elapsed = (perf_counter_ns() - started) / 1000
    return {"decoder": decoder, "correction": correction, "evidence": evidence, "decode_time_us": elapsed}


def decision_table(code: RepetitionCode, decoder: str, p, q) -> np.ndarray:
    """Correction for every syndrome, indexed by the integer whose binary string is s_1...s_m."""
    rows = []
    for k in range(2 ** code.m):
        y = [(k >> (code.m - 1 - j)) & 1 for j in range(code.m)]
        rows.append(string_to_bits(decode(code, decoder, y, p, q)["correction"], code.n))
    return np.array(rows, dtype=np.uint8)


def syndrome_index(code: RepetitionCode, syndromes: np.ndarray) -> np.ndarray:
    weights = 1 << np.arange(code.m - 1, -1, -1)
    return (np.asarray(syndromes, dtype=np.int64) * weights).sum(axis=-1)


def model_probabilities(code: RepetitionCode, p, q) -> tuple[np.ndarray, np.ndarray]:
    return (validate_probabilities(p, code.n, "Model data-error probabilities", 1e-6, 0.5),
            validate_probabilities(q, code.m, "Model readout-error probabilities", 0.0, 0.5))
