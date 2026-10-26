"""Structured, computed explanations of a decoding decision.

Every sentence is assembled from numbers returned by the likelihood analysis; nothing is
free-form. Simulation ground truth (the actual injected error) is reported in a separate
field and is never used by the decoder.
"""
from __future__ import annotations

import math

import numpy as np

from .codes import RepetitionCode
from .likelihood import candidate_analysis


def _fmt(x: float | None, digits: int = 3) -> str:
    return "∞" if x is None else f"{x:.{digits}f}"


def _cost_sentence(row: dict) -> str:
    flips_d = row["weight"]
    flips_r = row["readout_flips"].count("1")
    return (f"{row['candidate']} needs {flips_d} data flip{'s' if flips_d != 1 else ''} "
            f"(energy {_fmt(row['data_energy'])}) and {flips_r} readout flip{'s' if flips_r != 1 else ''} "
            f"(energy {_fmt(row['readout_energy'])}), total {_fmt(row['energy'])}")


def sensitivity(code: RepetitionCode, observed, p, q, points: int = 61) -> dict:
    """How the selected candidate changes when the declared readout or data error rates are rescaled."""
    p = np.asarray(p, dtype=float)
    q = np.asarray(q, dtype=float)
    base = candidate_analysis(code, observed, p, q)["best"]
    out = {}
    for name, values, other in (("readout", q, p), ("data", p, q)):
        scales = np.geomspace(0.05, 20, points)
        regions = []
        for s in scales:
            scaled = np.clip(values * s if values.any() else np.full_like(values, 1e-3) * s, 1e-6, 0.5)
            pp, qq = (p, scaled) if name == "readout" else (scaled, q)
            choice = candidate_analysis(code, observed, pp, qq)["best"]
            mean = float(np.mean(scaled))
            if regions and regions[-1]["choice"] == choice:
                regions[-1]["to_mean"] = mean
            else:
                regions.append({"choice": choice, "from_mean": mean, "to_mean": mean})
        out[name] = {"regions": regions, "current_mean": float(np.mean(values)), "current_choice": base,
                     "decision_changes": len(regions) - 1}
    return out


def explain(code: RepetitionCode, analysis: dict, decoder: str, correction: str, model_p, model_q,
            truth: dict | None = None, classes: dict | None = None) -> dict:
    rows = analysis["candidates"]
    best, second = rows[0], (rows[1] if len(rows) > 1 and rows[1]["possible"] else None)
    gap = analysis["energy_gap"]
    ratio = None if gap is None else math.exp(min(gap, 700))
    cls = classes or analysis["logical_classes"]
    plausible = [r for r in rows if r["posterior"] >= 0.01]
    answers = [
        {"question": "What syndrome was observed?",
         "answer": f"The decoder received syndrome {analysis['observed_syndrome']} "
                   f"(S1 = {'-1' if analysis['observed_syndrome'][0] == '1' else '+1'}, "
                   f"S2 = {'-1' if analysis['observed_syndrome'][1] == '1' else '+1'})."},
        {"question": "Which errors could explain it?",
         "answer": f"{len(plausible)} candidate{'s carry' if len(plausible) != 1 else ' carries'} at least 1% model posterior: "
                   + ", ".join(f"{r['candidate']} ({r['posterior'] * 100:.1f}%)" for r in plausible) + "."},
        {"question": "Why did the decoder prefer this candidate?",
         "answer": f"{_cost_sentence(best)}." + (f" The runner-up {_cost_sentence(second)}." if second else "")},
        {"question": "What assumptions influenced the ranking?",
         "answer": "Independent bit flips with data probabilities p = ["
                   + ", ".join(f"{v:.3g}" for v in model_p) + "] and readout probabilities q = ["
                   + ", ".join(f"{v:.3g}" for v in model_q)
                   + "]. Correlated or mis-specified noise would change the ranking."},
        {"question": "Which alternative came second?",
         "answer": "No other candidate is possible under the declared model." if second is None else
         f"{second['candidate']}, which is "
         + ("logically equivalent to the winner (choosing either preserves the logical value if the other is true)"
            if second["logically_equivalent_to_best"] else
            "NOT logically equivalent: if it were the true error, correcting for the winner would flip the logical bit")
         + "."},
        {"question": "How close were the alternatives?",
         "answer": "There is no runner-up." if gap is None else
         f"ΔE = {gap:.3f} nats: under the model the winner is {ratio:.3g}× more probable than the runner-up. "
         f"Logical margin ln(P_keep/P_flip) = {_fmt(cls['logical_margin_nats'])} nats. These are model-based ambiguity "
         f"indicators, not calibrated success probabilities."},
    ]
    if truth is not None:
        verdict = {"restored": "Recovery succeeded exactly: the codeword was restored.",
                   "recoverable_residual": "The logical value survived, but a single residual flip remains for the "
                                           "next round (the codeword is not yet restored).",
                   "logical_flip": "Recovery FAILED: the residual is a logical bit flip."}[truth["outcome"]]
        if truth.get("z_parity"):
            verdict += " An odd number of Z errors also applied an uncorrectable logical phase flip."
        answers.append({"question": "Was recovery actually successful?",
                        "answer": f"Simulation ground truth: actual error {truth['actual_error']}, correction "
                                  f"{correction}, residual {truth['residual']}. {verdict}"})
    return {"decoder": decoder, "correction": correction, "answers": answers,
            "model": {"p": list(map(float, model_p)), "q": list(map(float, model_q)),
                      "assumptions": ["independent Bernoulli X flips on each data qubit",
                                      "independent Bernoulli flips of each recorded syndrome bit",
                                      "no correlated, leakage or Z-error modeling (the code cannot correct Z)"]},
            "indicators": {"energy_gap": gap, "likelihood_ratio": ratio,
                           "logical_margin_nats": cls["logical_margin_nats"],
                           "p_logical_preserved_model": cls["p_logical_preserved"],
                           "calibration_note": "Indicators come from the declared model; the benchmarks test whether "
                                               "they track observed failures on held-out trials."}}
