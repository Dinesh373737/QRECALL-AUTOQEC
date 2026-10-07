"""Finite Gibbs sampling and an explicitly separate exact Gibbs reference."""

from __future__ import annotations

from typing import Any, Mapping
from time import perf_counter

import numpy as np
from scipy.special import expit, logsumexp

from .conditioning import _finite, _integer, _rng, full_state, modal_decision, reject_target, state_integer
from .hopfield import _contributions


def conditional_probability(local_field: float, temperature: float) -> float:
    temperature = _finite(temperature, "temperature", minimum=0)
    if temperature <= 0:
        raise ValueError("temperature must be strictly positive")
    field = _finite(local_field, "local_field")
    return float(expit(2.0 * field / temperature))


def exact_gibbs(problem: Mapping[str, Any], temperature: float) -> dict[str, Any]:
    temperature = _finite(temperature, "temperature", minimum=0)
    if temperature <= 0:
        raise ValueError("temperature must be strictly positive")
    energies = np.asarray(problem["energies"], dtype=np.float64)
    # Shift the ground energy first so tiny temperatures do not form +infinity.
    with np.errstate(over="ignore"):
        shifted_logs = -(energies - energies.min()) / temperature
    log_normalizer = float(logsumexp(shifted_logs))
    probabilities = np.exp(shifted_logs - log_normalizer)
    return {"temperature": temperature, "probabilities": probabilities.tolist(),
            "expected_energy": float(probabilities @ energies),
            "log_partition_shifted": log_normalizer,
            "partition_energy_shift": float(energies.min()),
            "state_count": len(energies), "reference": "exact_enumeration"}


def run_gibbs(problem: Mapping[str, Any], config: Mapping[str, Any] | None = None) -> dict[str, Any]:
    started = perf_counter()
    config = config or {}
    reject_target(config)
    free = problem["free_indices"]
    temperature = _finite(config.get("temperature", 0.65), "temperature", minimum=0)
    if temperature <= 0:
        raise ValueError("temperature must be strictly positive")
    burn_in = _integer(config.get("burn_in", 24), "burn_in", 0, 2000)
    samples = _integer(config.get("samples", 128), "samples", 1, 20000)
    thinning = _integer(config.get("thinning", 1), "thinning", 1, 1000)
    total_sweeps = burn_in + samples * thinning
    if total_sweeps * len(free) > 200000:
        raise ValueError("Gibbs configuration exceeds the local limit of 200,000 updates")
    order = config.get("update_order", "sequential")
    if order not in ("sequential", "random"):
        raise ValueError("update_order must be 'sequential' or 'random'")
    seed = _integer(config.get("seed", problem["seed"]), "seed", 0, 2**32 - 1)
    rng = _rng(seed, 2)
    weights = np.asarray(problem["weights"], dtype=np.float64)
    biases = np.asarray(problem["biases"], dtype=np.float64)
    state = np.asarray(problem["initial_state"], dtype=np.int8)
    counts = np.zeros(1 << len(free), dtype=np.int64)
    trace: list[dict[str, Any]] = []
    sampled_states = []
    energy_path = [float(-0.5 * state @ weights @ state - biases @ state)]
    for sweep in range(total_sweeps if free else 0):
        indices = rng.permutation(free).tolist() if order == "random" else free
        collected = sweep >= burn_in and (sweep - burn_in + 1) % thinning == 0
        for position, neuron in enumerate(indices):
            before = state.copy()
            field = float(weights[neuron] @ state + biases[neuron])
            probability = conditional_probability(field, temperature)
            draw = float(rng.random())
            e_before = float(-0.5 * state @ weights @ state - biases @ state)
            state[neuron] = 1 if draw < probability else -1
            e_after = float(-0.5 * state @ weights @ state - biases @ state)
            energy_path.append(e_after)
            trace.append({
                "index": len(trace), "kind": "update", "type": "gibbs_update", "method": "gibbs", "sweep": sweep,
                "phase": "burn_in" if sweep < burn_in else "sampling", "sample_collected": collected and position == len(indices) - 1,
                "neuron": int(neuron), "local_neuron": free.index(neuron),
                "state_before": before.tolist(), "state_after": state.tolist(),
                "integer_before": state_integer(before[free]), "integer_after": state_integer(state[free]),
                "local_field": field, "effective_field": float(problem["fields"][free.index(neuron)]),
                "bias": float(biases[neuron]), "contributions": _contributions(problem, before, neuron),
                "spin_before": int(before[neuron]), "spin_after": int(state[neuron]), "flipped": bool(before[neuron] != state[neuron]),
                "energy_before": e_before, "energy_after": e_after, "delta_energy": e_after - e_before,
                "p_plus": probability, "draw": draw, "temperature": temperature,
                "uphill": e_after > e_before + 1e-12,
            })
        if collected:
            index = state_integer(state[free])
            counts[index] += 1
            sampled_states.append(index)
    if not free:
        counts[0] = samples
        sampled_states = [0] * samples
    count_dict = {str(index): int(count) for index, count in enumerate(counts) if count}
    decision = modal_decision(count_dict)
    output = full_state(problem, decision["state_integer"])
    probabilities = (counts / samples).tolist()
    exact = exact_gibbs(problem, temperature)
    total_variation = float(0.5 * np.abs(np.asarray(probabilities) - np.asarray(exact["probabilities"])).sum())
    sampled_energy = float(np.asarray(probabilities) @ np.asarray(problem["energies"]))
    runtime = perf_counter() - started
    return {
        "method": "gibbs", "status": "completed", "output": output, "final_state": output,
        "last_chain_state": state.tolist(), "state_integer": decision["state_integer"],
        "energy": float(problem["energies"][decision["state_integer"]]), "trace": trace, "energy_path": energy_path,
        "expected_energy": sampled_energy, "sampled_energy": sampled_energy,
        "counts": count_dict, "probabilities": probabilities, "empirical_probabilities": probabilities, "sampled_states": sampled_states,
        "exact_probabilities": exact["probabilities"], "exact_reference": exact,
        "decision": decision, "ties": decision["tied_states"],
        "temperature": temperature, "burn_in": burn_in, "samples": samples, "thinning": thinning,
        "update_order": order, "schedule": None, "sample_unit": "one full sweep after thinning",
        "total_variation": total_variation,
        "warnings": ["A finite correlated Gibbs chain need not match its exact stationary distribution."],
        "resources": {"updates": len(trace), "gibbs_draws": len(trace), "sweeps": total_sweeps if free else 0, "samples": samples,
                      "runtime_seconds": runtime, "duration_ms": 1000 * runtime},
        "seed": seed, "config_hash": problem["config_hash"],
    }


run = run_gibbs
