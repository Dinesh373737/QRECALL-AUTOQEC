"""Asynchronous, deterministic Hopfield recall with exact local update events."""

from __future__ import annotations

from typing import Any, Mapping
from time import perf_counter

import numpy as np

from .conditioning import _integer, _rng, reject_target, state_integer


def _contributions(problem: Mapping[str, Any], before: np.ndarray, neuron: int) -> list[dict[str, Any]]:
    trusted = set(problem["trusted_indices"])
    return [{"neuron": j, "weight": float(weight), "spin": int(before[j]),
             "value": float(weight * before[j]), "trusted": j in trusted}
            for j, weight in enumerate(problem["weights"][neuron]) if j != neuron and abs(weight) > 1e-14]


def run_hopfield(problem: Mapping[str, Any], config: Mapping[str, Any] | None = None) -> dict[str, Any]:
    started = perf_counter()
    config = config or {}
    reject_target(config)
    free = problem["free_indices"]
    max_sweeps = _integer(config.get("max_sweeps", 40), "max_sweeps", 1, 1000)
    order = config.get("update_order", "sequential")
    if order not in ("sequential", "random"):
        raise ValueError("update_order must be 'sequential' or 'random'")
    rng = _rng(_integer(config.get("seed", problem["seed"]), "seed", 0, 2**32 - 1), 1)
    weights = np.asarray(problem["weights"], dtype=np.float64)
    biases = np.asarray(problem["biases"], dtype=np.float64)
    state = np.asarray(problem["initial_state"], dtype=np.int8)
    trace = []
    energy_path = [float(-0.5 * state @ weights @ state - biases @ state)]
    flips = 0
    sweeps = 0
    converged = not free
    for sweep in range(max_sweeps if free else 0):
        sweeps += 1
        changed = False
        indices = rng.permutation(free).tolist() if order == "random" else free
        for neuron in indices:
            before = state.copy()
            field = float(weights[neuron] @ state + biases[neuron])
            new_spin = 1 if field > 0 else -1 if field < 0 else int(state[neuron])
            e_before = float(-0.5 * state @ weights @ state - biases @ state)
            state[neuron] = new_spin
            e_after = float(-0.5 * state @ weights @ state - biases @ state)
            flipped = bool(before[neuron] != state[neuron])
            changed |= flipped
            flips += int(flipped)
            energy_path.append(e_after)
            trace.append({
                "index": len(trace), "kind": "update", "type": "hopfield_update", "method": "hopfield", "sweep": sweep,
                "neuron": int(neuron), "local_neuron": free.index(neuron),
                "state_before": before.tolist(), "state_after": state.tolist(),
                "integer_before": state_integer(before[free]), "integer_after": state_integer(state[free]),
                "local_field": field, "effective_field": float(problem["fields"][free.index(neuron)]),
                "bias": float(biases[neuron]), "contributions": _contributions(problem, before, neuron),
                "spin_before": int(before[neuron]), "spin_after": new_spin, "flipped": flipped,
                "energy_before": e_before, "energy_after": e_after, "delta_energy": e_after - e_before,
                "zero_field_tie": field == 0.0,
            })
        if not changed:
            converged = True
            break
    index = state_integer(state[free])
    probabilities = [0.0] * (1 << len(free))
    probabilities[index] = 1.0
    runtime = perf_counter() - started
    return {
        "method": "hopfield", "status": "completed", "output": state.tolist(), "final_state": state.tolist(),
        "state_integer": index, "energy": energy_path[-1], "converged": converged,
        "trace": trace, "energy_path": energy_path, "counts": {str(index): 1}, "probabilities": probabilities,
        "decision": {"state_integer": index, "tied_states": [], "tie_rule": "converged_state"}, "ties": [],
        "update_order": order, "initialization": "cue values; seeded random spins at missing pixels",
        "warnings": [] if converged else ["Sweep limit reached before stability was confirmed."],
        "resources": {"updates": len(trace), "bit_updates": len(trace), "flips": flips, "sweeps": sweeps,
                      "runtime_seconds": runtime, "duration_ms": 1000 * runtime},
        "seed": int(config.get("seed", problem["seed"])), "config_hash": problem["config_hash"],
    }


run = run_hopfield
