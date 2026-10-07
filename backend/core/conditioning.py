"""Construct the one conditioned problem shared by all recall methods."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping, Sequence

import numpy as np

from .memory_model import as_spins, hebbian_weights


MAX_FREE = 8
_TARGET_KEYS = {"target", "target_index", "target_id", "target_memory", "source_memory", "source_index"}


def _integer(value: Any, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, np.integer)) or not low <= value <= high:
        raise ValueError(f"{name} must be an integer from {low} to {high}")
    return int(value)


def _finite(value: Any, name: str, *, minimum: float | None = None) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number")
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be a finite number") from error
    if not np.isfinite(result) or (minimum is not None and result < minimum):
        raise ValueError(f"{name} must be finite" + (f" and at least {minimum}" if minimum is not None else ""))
    return result


def reject_target(config: Mapping[str, Any]) -> None:
    """Target/source identity is evaluation-only and cannot reach a solver."""
    if _TARGET_KEYS.intersection(config):
        raise ValueError("target identity belongs to evaluation and must not be passed to the scientific solver")


def _rng(seed: int, stream: int) -> np.random.Generator:
    """Disjoint initialization/order/draw streams under one reproducible seed."""
    return np.random.default_rng(np.random.SeedSequence(seed).spawn(3)[stream])


def state_integer(spins: Sequence[int]) -> int:
    """Little-endian local basis integer: bit at local a has weight 2**a."""
    state = as_spins(spins)
    return sum(((1 - int(spin)) // 2) << a for a, spin in enumerate(state))


def integer_spins(index: int, width: int) -> list[int]:
    width = _integer(width, "width", 0, MAX_FREE)
    index = _integer(index, "state integer", 0, (1 << width) - 1)
    return [1 - 2 * ((index >> a) & 1) for a in range(width)]


def full_state(problem: Mapping[str, Any], index: int) -> list[int]:
    local = integer_spins(index, len(problem["free_indices"]))
    state = list(problem["initial_state"])
    for a, global_index in enumerate(problem["free_indices"]):
        state[global_index] = local[a]
    return state


def reduced_energy(problem: Mapping[str, Any], free_spins: Sequence[int]) -> float:
    free = problem["free_indices"]
    state = as_spins(free_spins, len(free))
    weights = np.asarray(problem["weights"], dtype=np.float64)[np.ix_(free, free)]
    fields = np.asarray(problem["fields"], dtype=np.float64)
    return float(problem["constant"] - 0.5 * state @ weights @ state - fields @ state)


def build_problem(config: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and enumerate a trusted-erasure or soft-noisy memory problem.

    All returned values are JSON-ready. A missing erasure is free; a noisy
    observation biases a free variable but never clamps it. Unknown initial
    spins are sampled with the configuration seed, never with a target label.
    """
    reject_target(config)
    rows = _integer(config.get("rows", 2), "rows", 1, 64)
    cols = _integer(config.get("cols", 4), "cols", 1, 64)
    n = rows * cols
    if n > 64:
        raise ValueError("the local demonstrator supports at most 64 total pixels")
    seed = _integer(config.get("seed", 42), "seed", 0, 2**32 - 1)
    memories = config.get("memories")
    weights = hebbian_weights(memories)
    if weights.shape != (n, n):
        raise ValueError(f"each memory must contain exactly rows × cols = {n} spins")
    if len(memories) > 64:
        raise ValueError("the local demonstrator supports at most 64 stored memories")
    cue = list(config.get("cue", [None] * n))
    if len(cue) != n or any(value is not None and (isinstance(value, bool) or value not in (-1, 1)) for value in cue):
        raise ValueError(f"cue must contain {n} values from -1, +1, and null")
    mode = config.get("mode", "erasure")
    if mode not in ("erasure", "noisy"):
        raise ValueError("mode must be 'erasure' or 'noisy'")
    observed = [value is not None for value in cue]
    if config.get("observed_mask") is not None:
        mask = list(config["observed_mask"])
        if len(mask) != n or any(not isinstance(value, bool) for value in mask):
            raise ValueError("observed_mask must have one boolean per pixel")
        if any(mask[i] and cue[i] is None for i in range(n)):
            raise ValueError("an observed pixel must have a cue spin")
        observed = mask
        cue = [cue[i] if observed[i] else None for i in range(n)]
    trusted = list(observed) if mode == "erasure" else [False] * n
    if config.get("trusted_mask") is not None:
        mask = list(config["trusted_mask"])
        if len(mask) != n or any(not isinstance(value, bool) for value in mask):
            raise ValueError("trusted_mask must have one boolean per pixel")
        if any(mask[i] and not observed[i] for i in range(n)):
            raise ValueError("trusted pixels must also be observed")
        if mode == "noisy" and any(mask):
            raise ValueError("soft noisy cues are never clamped; trusted_mask must be empty")
        trusted = mask
    trusted_indices = [i for i, value in enumerate(trusted) if value]
    free = [i for i, value in enumerate(trusted) if not value]
    if len(free) > MAX_FREE:
        raise ValueError(f"at most {MAX_FREE} variables may be free; this cue has {len(free)}")
    bias_values = config.get("biases")
    base_biases = np.asarray(np.zeros(n) if bias_values is None else bias_values, dtype=np.float64)
    if base_biases.shape != (n,) or not np.isfinite(base_biases).all():
        raise ValueError("biases must have one finite value per pixel")
    reliability_values = config.get("reliabilities")
    if reliability_values is None:
        reliability_values = config.get("reliability")
    reliabilities = np.asarray(np.ones(n) if reliability_values is None else reliability_values, dtype=np.float64)
    if reliabilities.shape != (n,) or not np.isfinite(reliabilities).all() or np.any(reliabilities < 0):
        raise ValueError("reliabilities must have one finite nonnegative weight per pixel")
    strength = _finite(config.get("cue_strength", 0.35), "cue_strength", minimum=0)
    cue_fields = np.zeros(n, dtype=np.float64)
    if mode == "noisy":
        for i in range(n):
            if observed[i]:
                cue_fields[i] = strength * reliabilities[i] * cue[i]
    biases = base_biases + cue_fields
    trusted_state = np.asarray([cue[i] for i in trusted_indices], dtype=np.int8)
    fields = biases[free] + weights[np.ix_(free, trusted_indices)] @ trusted_state
    constant = float(-0.5 * trusted_state @ weights[np.ix_(trusted_indices, trusted_indices)] @ trusted_state - biases[trusted_indices] @ trusted_state)
    if not np.isfinite(biases).all() or not np.isfinite(fields).all() or not np.isfinite(constant):
        raise ValueError("conditioned fields overflowed; choose smaller finite biases and cue weights")
    rng = _rng(seed, 0)
    initial_state = [int(cue[i]) if observed[i] else int(rng.choice([-1, 1])) for i in range(n)]
    if config.get("initial_state") is not None:
        initial_state = as_spins(config["initial_state"], n, name="initial_state").tolist()
        if any(initial_state[i] != cue[i] for i in trusted_indices):
            raise ValueError("initial_state cannot contradict trusted pixels")
    local_states = [integer_spins(index, len(free)) for index in range(1 << len(free))]
    full_states = []
    energies = []
    local_weights = weights[np.ix_(free, free)]
    for local in local_states:
        state = list(initial_state)
        for a, global_index in enumerate(free):
            state[global_index] = local[a]
        full_states.append(state)
        local_array = np.asarray(local, dtype=np.int8)
        energies.append(float(constant - 0.5 * local_array @ local_weights @ local_array - fields @ local_array))
    if not np.isfinite(energies).all():
        raise ValueError("conditioned energies overflowed; choose smaller finite biases and cue weights")
    config_hash = hashlib.sha256(json.dumps(dict(config), sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()[:16]
    minimum = min(energies)
    minima = [i for i, value in enumerate(energies) if np.isclose(value, minimum, atol=1e-12, rtol=0)]
    memory_contributions = []
    for memory in memories:
        contribution = np.outer(memory, memory).astype(np.float64) / n
        np.fill_diagonal(contribution, 0.0)
        memory_contributions.append(contribution.tolist())
    field_contributions = [[{"neuron": j, "weight": float(weights[i, j]), "spin": int(cue[j]),
                              "value": float(weights[i, j] * cue[j])} for j in trusted_indices]
                           for i in free]
    return {
        "schema_version": "1.0", "config_hash": config_hash, "seed": seed,
        "rng_streams": {"initialization": 0, "hopfield_update_order": 1, "gibbs_update_order_and_draws": 2},
        "n": n, "rows": rows, "cols": cols, "mode": mode,
        "memories": np.asarray(memories, dtype=np.int8).tolist(), "cue": cue,
        "observed_indices": [i for i, value in enumerate(observed) if value],
        "free_indices": free, "trusted_indices": trusted_indices,
        "free_to_global": free, "mapping": [{"local": a, "global": i} for a, i in enumerate(free)],
        "weights": weights.tolist(), "normalization": n, "memory_contributions": memory_contributions,
        "base_biases": base_biases.tolist(), "cue_fields": cue_fields.tolist(),
        "biases": biases.tolist(), "reliabilities": reliabilities.tolist(),
        "fields": fields.tolist(), "field_contributions": field_contributions, "constant": constant,
        "initial_state": initial_state, "initial_integer": state_integer([initial_state[i] for i in free]),
        "states": full_states, "free_states": local_states, "energies": energies,
        "minimum_energy": minimum, "ground_states": minima,
        "encoding": {"spin": "1 - 2*bit", "filled_spin": 1, "basis_order": "little-endian local; F[a] has weight 2^a"},
    }


def modal_decision(counts: Mapping[str | int, int]) -> dict[str, Any]:
    """Select modal sampled state, resolving ties by lowest basis integer."""
    if not counts:
        raise ValueError("modal selection requires at least one sampled state")
    normalized = {int(index): _integer(count, "count", 0, 2**63 - 1) for index, count in counts.items()}
    if any(index < 0 for index in normalized) or not any(normalized.values()):
        raise ValueError("counts require nonnegative state integers and at least one positive count")
    highest = max(normalized.values())
    modes = sorted(index for index, count in normalized.items() if count == highest)
    return {"state_integer": modes[0], "count": highest, "tied_states": modes if len(modes) > 1 else [], "tie_rule": "lowest_basis_integer"}
