"""PyMatching (minimum-weight perfect matching) on Google's detector error models.

Configurations evaluated, all on identical shots:

* ``pymatching_circuit``     -- ``circuit_detector_error_model.dem`` for every shot. This is the
  configuration Google used for ``obs_flips_predicted_by_pymatching.01`` and is verified to
  reproduce those predictions shot-for-shot.
* ``pymatching_pij``         -- the experimentally reweighted ``pij`` models, applied on the
  complementary partition (even-shot model on odd shots and vice versa).
* ``pymatching_correlated``  -- PyMatching 2.4 two-pass correlated matching
  (``enable_correlations=True``) on the same held-out ``pij`` partitioning.

PyMatching uses stim's suggested graphlike decomposition of hyperedges; hyperedges with no
decomposition are ignored by PyMatching (reported, never hidden).
"""
from __future__ import annotations

from functools import lru_cache
from time import perf_counter

import numpy as np
import pymatching
import stim

CONFIGS = {
    "pymatching_circuit": {"label": "PyMatching · circuit DEM", "dem": "circuit", "correlations": False,
                           "partitioned": False,
                           "note": "Google's configuration: circuit_detector_error_model.dem for all shots."},
    "pymatching_pij": {"label": "PyMatching · held-out pij DEM", "dem": "pij", "correlations": False,
                       "partitioned": True,
                       "note": "pij_from_even_for_odd on odd shots, pij_from_odd_for_even on even shots."},
    "pymatching_correlated": {"label": "PyMatching correlated · pij DEM", "dem": "pij", "correlations": True,
                              "partitioned": True,
                              "note": "PyMatching 2.4 enable_correlations=True with the held-out pij partitioning."},
}


@lru_cache(maxsize=32)
def _matching(dem_text: str, correlations: bool) -> tuple[pymatching.Matching, float]:
    started = perf_counter()
    m = pymatching.Matching.from_detector_error_model(stim.DetectorErrorModel(dem_text),
                                                      enable_correlations=correlations)
    return m, perf_counter() - started


def matching_for(dem_text: str, correlations: bool = False) -> pymatching.Matching:
    return _matching(dem_text, correlations)[0]


def setup_seconds(dem_text: str, correlations: bool = False) -> float:
    return _matching(dem_text, correlations)[1]


def decode_batch(dem_text: str, detection_events: np.ndarray, correlations: bool = False) -> dict:
    """Decode boolean (shots, detectors) or bit-packed uint8 (shots, ceil(detectors/8)) records."""
    m, setup = _matching(dem_text, correlations)
    packed = detection_events.dtype == np.uint8
    started = perf_counter()
    if correlations:
        predictions = m.decode_batch(detection_events, bit_packed_shots=packed, enable_correlations=True)
    else:
        predictions = m.decode_batch(detection_events, bit_packed_shots=packed)
    elapsed = perf_counter() - started
    shots = detection_events.shape[0]
    return {"predictions": predictions[:, 0].astype(bool), "setup_seconds": setup, "decode_seconds": elapsed,
            "per_shot_us": elapsed / shots * 1e6 if shots else None}


def partitioned_predictions(experiment, config: str, detection_events: np.ndarray, shot_offset: int = 0) -> dict:
    """Decode shots with the model required by ``config``; shot parity uses the global shot index."""
    spec = CONFIGS[config]
    shots = detection_events.shape[0]
    preds = np.zeros(shots, dtype=bool)
    timing = {"setup_seconds": 0.0, "decode_seconds": 0.0}
    if not spec["partitioned"]:
        out = decode_batch(experiment.dem_text("circuit"), detection_events, spec["correlations"])
        preds[:] = out["predictions"]
        timing = {"setup_seconds": out["setup_seconds"], "decode_seconds": out["decode_seconds"]}
    else:
        index = np.arange(shot_offset, shot_offset + shots)
        for parity, dem_kind in ((1, "pij_even_for_odd"), (0, "pij_odd_for_even")):
            mask = index % 2 == parity
            if not mask.any():
                continue
            out = decode_batch(experiment.dem_text(dem_kind), detection_events[mask], spec["correlations"])
            preds[mask] = out["predictions"]
            timing["setup_seconds"] += out["setup_seconds"]
            timing["decode_seconds"] += out["decode_seconds"]
    timing["per_shot_us"] = timing["decode_seconds"] / shots * 1e6 if shots else None
    return {"predictions": preds, **timing}


def dem_kind_for_shot(config: str, shot: int) -> str:
    spec = CONFIGS[config]
    if not spec["partitioned"]:
        return "circuit"
    return "pij_even_for_odd" if shot % 2 == 1 else "pij_odd_for_even"


def explain_shot(dem_text: str, syndrome: np.ndarray, correlations: bool = False) -> dict:
    """Matched edges, their weights and observable effect for one shot."""
    m = matching_for(dem_text, correlations)
    syndrome = np.asarray(syndrome, dtype=np.uint8)
    started = perf_counter()
    prediction, weight = m.decode(syndrome, return_weight=True, enable_correlations=correlations) \
        if correlations else m.decode(syndrome, return_weight=True)
    elapsed = (perf_counter() - started) * 1e6
    edges = m.decode_to_edges_array(syndrome, enable_correlations=correlations) if correlations \
        else m.decode_to_edges_array(syndrome)
    out = []
    for u, v in np.asarray(edges, dtype=np.int64).tolist():
        if v == -1 or u == -1:
            node = u if v == -1 else v
            data = m.get_boundary_edge_data(node)
            out.append({"detectors": [int(node)], "boundary": True, "weight": float(data["weight"]),
                        "probability": float(data["error_probability"]),
                        "flips_observable": bool(data["fault_ids"])})
        else:
            data = m.get_edge_data(int(u), int(v))
            out.append({"detectors": [int(u), int(v)], "boundary": False, "weight": float(data["weight"]),
                        "probability": float(data["error_probability"]),
                        "flips_observable": bool(data["fault_ids"])})
    return {"prediction": bool(np.asarray(prediction).ravel()[0]), "total_weight": float(weight),
            "edges": out, "decode_us": elapsed,
            "weight_meaning": "Sum of ln((1-p)/p) over matched edges (PyMatching's edge weights).",
            "correlations": correlations}
