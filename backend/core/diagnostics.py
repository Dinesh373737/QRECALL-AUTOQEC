"""Small, target-free diagnostics derived from existing ideal solver snapshots.

These quantities describe the computational-basis probability distribution.
Shannon entropy and inverse participation are not entanglement measures, and
none of the ideal-state summaries describe the optional noisy sampled run.
"""
from __future__ import annotations

from typing import Any, Mapping

import numpy as np

MAX_BASIS_STATES = 256
MAX_QUANTUM_SNAPSHOTS = 139  # 1 + 3 * (28 pair + 8 field + 8 mixer + 2 boundary)


def snapshot_diagnostics(event: Mapping[str, Any], energies: list[float], index: int) -> dict[str, Any]:
    """Summarize an exported ideal snapshot without changing or normalizing it."""
    probabilities = np.asarray(event["probabilities"], dtype=np.float64)
    energy = np.asarray(energies, dtype=np.float64)
    amplitudes = np.asarray(
        [complex(value["real"], value["imag"]) for value in event["amplitudes"]],
        dtype=np.complex128,
    )
    if (probabilities.ndim != 1 or not 1 <= probabilities.size <= MAX_BASIS_STATES
            or probabilities.shape != energy.shape or amplitudes.shape != probabilities.shape
            or not np.isfinite(probabilities).all() or not np.isfinite(energy).all()
            or not np.isfinite(amplitudes).all() or np.any(probabilities < 0)):
        raise ValueError("Diagnostics require finite, bounded ideal snapshot arrays of matching shape.")
    probability_sum = float(probabilities.sum())
    participation = float(probabilities @ probabilities)
    if probability_sum <= 0 or participation <= 0:
        raise ValueError("An ideal snapshot must have positive probability mass.")
    expected = float(probabilities @ energy)
    positive = probabilities[probabilities > 0]
    # Centered moments avoid cancellation from E² − <E>² at large offsets.
    # Extreme user-supplied finite biases can still overflow a second moment;
    # keep the existing scientific result usable and explicitly mark this absent.
    with np.errstate(over="ignore", invalid="ignore"):
        variance = float(probabilities @ np.square(energy - expected))
    return {
        "index": int(index),
        "amplitude_norm": float(np.linalg.norm(amplitudes)),
        "probability_sum": probability_sum,
        "expected_energy": expected,
        "energy_variance": variance if np.isfinite(variance) else None,
        "basis_entropy_bits": max(0.0, float(-positive @ np.log2(positive))),
        "effective_basis_states": float(1.0 / participation),
    }


def basis_energy_breakdown(problem: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Decompose each already-enumerated conditioned energy, in basis order."""
    free = list(problem["free_indices"])
    local_states = np.asarray(problem["free_states"], dtype=np.float64)
    fields = np.asarray(problem["fields"], dtype=np.float64)
    weights = np.asarray(problem["weights"], dtype=np.float64)[np.ix_(free, free)]
    expected_shape = (1 << len(free), len(free))
    if len(free) > 8 or local_states.shape != expected_shape or fields.shape != (len(free),):
        raise ValueError("Energy diagnostics require at most eight free pixels and enumerated basis states.")
    constant = float(problem["constant"])
    result = []
    for index, spins in enumerate(local_states):
        pair = float(-0.5 * spins @ weights @ spins)
        field = float(-fields @ spins)
        result.append({"state_integer": index, "pair_energy": pair,
                       "field_energy": field, "constant_energy": constant,
                       "total_energy": float(constant + pair + field)})
    return result


def experiment_diagnostics(problem: Mapping[str, Any], quantum: Mapping[str, Any]) -> dict[str, Any]:
    """Return compact derived lesson data, separate from every solver decision."""
    trace = quantum["trace"]
    if not 1 <= len(trace) <= MAX_QUANTUM_SNAPSHOTS:
        raise ValueError("Ideal diagnostics require a bounded nonempty quantum snapshot trace.")
    summaries = [snapshot_diagnostics(event, problem["energies"], index)
                 for index, event in enumerate(trace)]
    notes = [
        "All quantum summaries use the exported ideal pure-state snapshots; noisy shot frequencies are separate.",
        "Basis Shannon entropy and effective basis states describe this measurement basis, not entanglement.",
        "Effective basis states is inverse participation, 1 / sum(P squared); it is not a recovery confidence.",
    ]
    if any(summary["energy_variance"] is None for summary in summaries):
        notes.append("Energy variance is unavailable when a second moment exceeds finite numerical range.")
    return {"source": "ideal_statevector", "quantum_trace": summaries,
            "quantum_final": dict(summaries[-1]),
            "basis_energy": basis_energy_breakdown(problem), "notes": notes}
