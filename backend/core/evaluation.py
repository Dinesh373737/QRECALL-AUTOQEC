"""Target-independent references and evaluator-only memory-recovery metrics.

The algorithms receive a bank, a cue and an energy; source identity is accepted
only here. A measured algorithm is judged by its modal count, never by choosing
the lowest-energy sample after seeing the answer.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import csv
import hashlib
import io
import json
import math
from pathlib import Path
from time import perf_counter
from typing import Callable

import numpy as np

SCHEMA_VERSION = "1.0"
BENCHMARK_SEED = 7102026
CURATION_SEED = 5102026
ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"


def _hash(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def _basis_integer(state, free_indices) -> int:
    return sum(int(state[global_index] == -1) << local for local, global_index in enumerate(free_indices))


def modal_decision(counts: dict, size: int | None = None) -> dict:
    """Resolve a finite sample independently of target identity and energy."""
    normalized = {}
    for raw, count in counts.items():
        integer = int(raw)
        if integer < 0 or (size is not None and integer >= size):
            raise ValueError("sample state is outside the enumerated basis")
        if isinstance(count, bool) or not isinstance(count, (int, np.integer)) or count < 0:
            raise ValueError("counts must be nonnegative integers")
        normalized[integer] = normalized.get(integer, 0) + int(count)
    if not normalized or sum(normalized.values()) == 0:
        raise ValueError("a sampled decision requires at least one count")
    maximum = max(normalized.values())
    ties = sorted(integer for integer, count in normalized.items() if count == maximum)
    return {"state_integer": ties[0], "tied_states": ties if len(ties) > 1 else [],
            "tie_rule": "lowest local basis integer", "modal_count": maximum,
            "sample_count": sum(normalized.values())}


def nearest_memory(config: dict) -> dict:
    """Score only available observations; no erased pixel or target is used."""
    started = perf_counter()
    memories = np.asarray(config["memories"], dtype=int)
    cue = config["cue"]
    mask = config.get("observed_mask")
    observed = [index for index, value in enumerate(cue) if value is not None and (mask is None or mask[index])]
    reliability = np.asarray(config.get("reliabilities") or config.get("reliability") or [1.0] * len(cue), dtype=float)
    # A reliability-weighted Hamming score is meaningful for soft noisy cues.
    weights = reliability if config.get("mode") == "noisy" else np.ones(len(cue))
    scores = [float(sum(weights[index] for index in observed if int(memory[index]) != cue[index]))
              for memory in memories]
    best = min(scores)
    ties = [index for index, score in enumerate(scores) if math.isclose(score, best, abs_tol=1e-12)]
    selected = ties[0]
    return {"method": "nearest_memory", "final_state": memories[selected].tolist(),
            "memory_index": selected, "tied_memory_indices": ties, "ties": ties,
            "scores": scores, "observed_indices": observed,
            "score": "reliability-weighted Hamming on observations" if config.get("mode") == "noisy" else "Hamming on observed pixels",
            "decision_rule": "minimum observation score; lowest memory-bank index on ties",
            "resources": {"memory_comparisons": len(memories), "observed_pixel_comparisons": len(memories) * len(observed)},
            "runtime_seconds": perf_counter() - started}


def exact_references(problem: dict, temperature: float) -> dict:
    started = perf_counter()
    if not math.isfinite(temperature) or temperature <= 0:
        raise ValueError("temperature must be finite and positive")
    energies = np.asarray(problem["energies"], dtype=float)
    minimum = float(np.min(energies))
    ties = np.flatnonzero(np.isclose(energies, minimum, rtol=0, atol=1e-10)).tolist()
    logits = -(energies - minimum) / temperature
    probabilities = np.exp(logits)
    probabilities /= probabilities.sum()
    maximum = float(np.max(probabilities))
    modal_ties = np.flatnonzero(np.isclose(probabilities, maximum, rtol=1e-12, atol=0)).tolist()
    runtime = perf_counter() - started
    resources = {"enumerated_states": len(energies), "free_variables": len(problem["free_indices"])}
    return {
        "exact_minimum": {"method": "exact_minimum", "diagnostic": True, "final_state": problem["states"][ties[0]],
                          "state_integer": ties[0], "energy": minimum, "ties": ties if len(ties) > 1 else [], "ground_states": ties,
                          "decision_rule": "minimum conditioned energy; lowest local basis integer on ties",
                          "resources": resources, "runtime_seconds": runtime},
        "exact_gibbs": {"method": "exact_gibbs", "diagnostic": True, "final_state": problem["states"][modal_ties[0]],
                        "state_integer": modal_ties[0], "probabilities": probabilities.tolist(),
                        "expected_energy": float(probabilities @ energies), "temperature": temperature,
                        "ties": modal_ties if len(modal_ties) > 1 else [], "decision_rule": "analytic Gibbs mode; lowest local basis integer on ties",
                        "probability_source": "exact finite-state Gibbs distribution",
                        "resources": resources, "runtime_seconds": runtime},
    }


def reference_results(problem: dict, config: dict) -> dict:
    return {"nearest_memory": nearest_memory(config), **exact_references(problem, float(config.get("temperature", 0.65)))}


def _state_energy(state, problem: dict) -> float:
    spins = np.asarray(state, dtype=float)
    return float(-0.5 * spins @ np.asarray(problem["weights"]) @ spins - np.asarray(problem["biases"]) @ spins)


def _runtime(result: dict) -> float:
    resources = result.get("resources", {})
    value = result.get("runtime_seconds", resources.get("runtime_seconds", resources.get("elapsed_seconds", resources.get("duration_ms", 0.0) / 1000)))
    return float(value)


def evaluate_method(problem: dict, config: dict, result: dict, target_index: int | None = None, method: str = "") -> dict:
    """Use the declared recall rule, while retaining probabilities separately."""
    memories = config["memories"]
    if target_index is not None and (isinstance(target_index, bool) or not 0 <= target_index < len(memories)):
        raise ValueError("target_index must identify a memory in the bank")
    target = None if target_index is None else memories[target_index]
    sampled = method in ("gibbs", "quantum", "qaoa")
    counts = result.get("counts", {}) if sampled else {}
    fully_clamped = not problem["free_indices"]
    if sampled and not counts and not fully_clamped:
        raise ValueError("sampled recall requires actual nonempty counts")
    if sampled and counts:
        decision = modal_decision(counts, len(problem["states"]))
        state = problem["states"][decision["state_integer"]]
    else:
        state = result.get("final_state", result.get("output"))
        if state is None:
            raise ValueError(f"{method} has no final_state or output")
        decision = {"state_integer": _basis_integer(state, problem["free_indices"]),
                    "tied_states": result.get("ties", result.get("decision", {}).get("tied_states", [])),
                    "tie_rule": "fully clamped reconstruction; no samples required" if fully_clamped else result.get("decision_rule", "solver's deterministic state")}
    state = [int(spin) for spin in state]
    if len(state) != problem["n"] or any(spin not in (-1, 1) for spin in state):
        raise ValueError("final_state must be a full spin pattern")
    energy = _state_energy(state, problem)
    minimum = min(problem["energies"])
    trusted = problem.get("trusted_indices", [])
    violations = [index for index in trusted if state[index] != config["cue"][index]]
    matches = [index for index, memory in enumerate(memories) if list(memory) == state]
    free = problem["free_indices"]
    target_compatible = target is not None and all(target[index] == config["cue"][index] for index in trusted)
    target_integer = _basis_integer(target, free) if target_compatible else None
    probabilities = result.get("probabilities")
    if probabilities is not None:
        probabilities = np.asarray(probabilities, dtype=float)
        if probabilities.shape != (len(problem["states"]),) or not np.all(np.isfinite(probabilities)):
            raise ValueError("probabilities must cover every local basis state")
        if np.any(probabilities < 0) or not math.isclose(float(probabilities.sum()), 1.0, abs_tol=1e-8):
            raise ValueError("probabilities must be nonnegative and normalized")
    total = sum(int(count) for count in counts.values())
    empirical = None if target is None or total == 0 else (float(counts.get(str(target_integer), counts.get(target_integer, 0))) / total if target_compatible else 0.0)
    target_probability = None if target is None or probabilities is None else (float(probabilities[target_integer]) if target_compatible else 0.0)
    if target_probability is None and empirical is not None:
        target_probability = empirical
    sampled_energy = None
    if total:
        sampled_energy = float(sum(problem["energies"][int(integer)] * count for integer, count in counts.items()) / total)
    expected_energy = float(probabilities @ np.asarray(problem["energies"])) if probabilities is not None else result.get("expected_energy")
    return {
        "method": method or result.get("method", "unknown"), "diagnostic": bool(result.get("diagnostic", False)),
        "final_state": state, "state_integer": decision["state_integer"], "decision": decision,
        "ties": decision["tied_states"], "tied_memory_indices": result.get("tied_memory_indices", []),
        "recovery": None if target is None else state == list(target),
        "bit_error_rate": None if target is None else sum(a != b for a, b in zip(state, target)) / len(state),
        "free_bit_error_rate": None if target is None else (sum(state[index] != target[index] for index in free) / len(free) if free else 0.0),
        "unintended_memory": None if target is None else bool(matches and target_index not in matches),
        "spurious_state": not bool(matches), "matched_memory_indices": matches,
        "constraints_satisfied": not bool(violations), "violations": violations,
        "energy": energy, "energy_gap": None if violations else max(0.0, energy - minimum),
        "expected_energy": None if expected_energy is None else float(expected_energy),
        "expected_energy_gap": None if expected_energy is None else max(0.0, float(expected_energy) - minimum),
        "sampled_energy": sampled_energy,
        "target_probability": target_probability, "empirical_target_probability": empirical,
        "target_compatible_with_constraints": None if target is None else target_compatible,
        "probability_source": "deterministic fully clamped reconstruction" if fully_clamped and not counts else result.get("probability_source", "ideal statevector (noise affects sampled counts only)" if method in ("quantum", "qaoa") else "empirical retained samples" if sampled and total else "deterministic decision distribution" if probabilities is not None else "not a sampled distribution"),
        "sample_count": total, "resources": result.get("resources", {}), "runtime_seconds": _runtime(result),
    }


def evaluate_experiment(problem: dict, config: dict, results: dict | None = None, target_index: int | None = None) -> dict:
    references = reference_results(problem, config)
    all_results = {**(results or {}), **references}
    methods = {method: evaluate_method(problem, config, result, target_index, method) for method, result in all_results.items()}
    warnings = ["Small-system simulator experiment; no quantum advantage or hardware speedup is established.",
                "Gibbs retained draws from one chain can be correlated; they are not independent recovery trials.",
                "Lower conditioned energy and recovery of the source memory answer different questions."]
    if len(references["nearest_memory"]["tied_memory_indices"]) > 1:
        warnings.append("The available cue gives a nearest-memory tie; the bank-index tie rule does not use the target.")
    return {"schema_version": SCHEMA_VERSION, "target_index": target_index, "config_hash": _hash(config),
            "bit_error_scope": "all pixels; free-pixel error is also reported", "methods": methods,
            "references": references, "warnings": warnings,
            "decision_rule": "Hopfield converged state; Gibbs/QAOA modal retained/sample counts; lowest local basis integer on count ties"}


def wilson_interval(successes: int, trials: int, z: float = 1.959963984540054) -> list[float]:
    if trials <= 0 or not 0 <= successes <= trials:
        raise ValueError("Wilson interval needs positive trials and valid successes")
    p = successes / trials
    denominator = 1 + z * z / trials
    center = (p + z * z / (2 * trials)) / denominator
    radius = z * math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / denominator
    return [max(0.0, center - radius), min(1.0, center + radius)]


def generate_benchmark_cases(config: dict, cases: int = 12, benchmark_seed: int = BENCHMARK_SEED) -> list[dict]:
    if not isinstance(cases, int) or not 1 <= cases <= 60:
        raise ValueError("benchmark case count must be between 1 and 60")
    if benchmark_seed == CURATION_SEED:
        raise ValueError("benchmark seeds must differ from the preset-curation seed")
    base = deepcopy(config)
    for forbidden in ("target", "target_index", "source_index", "ground_truth", "preset_id", "benchmark_repetitions"):
        base.pop(forbidden, None)
    # Regenerate masks/initialization with each independent cue; retaining an
    # old erasure mask could hide new observations or untrust the wrong pixels.
    for cue_dependent in ("observed_mask", "trusted_mask", "initial_state"):
        base.pop(cue_dependent, None)
    memories = base["memories"]
    n = len(memories[0])
    if n > 8 and base.get("mode") == "noisy":
        raise ValueError("whole-system noisy benchmarks permit at most 8 free variables")
    erased_count = min(8, n, max(1, sum(value is None for value in base["cue"])))
    sequence = np.random.SeedSequence(benchmark_seed)
    generated = []
    for index, child in enumerate(sequence.spawn(cases)):
        cue_child, solver_child = child.spawn(2)
        rng = np.random.default_rng(cue_child)
        target_index = int(rng.integers(len(memories)))
        cue = list(memories[target_index])
        if base.get("mode", "erasure") == "erasure":
            damage = sorted(int(value) for value in rng.choice(n, erased_count, replace=False))
            for pixel in damage:
                cue[pixel] = None
        else:
            # Every pixel independently passes through the same 20% flip channel.
            damage = np.flatnonzero(rng.random(n) < 0.2).tolist()
            for pixel in damage:
                cue[pixel] *= -1
        case_config = {**deepcopy(base), "cue": cue, "seed": int(solver_child.generate_state(1)[0])}
        generated.append({"case_index": index, "cue_seed": int(cue_child.generate_state(1)[0]),
                          "target_index": target_index, "damage_indices": damage, "config": case_config})
    return generated


def _aggregate(case_results: list[dict]) -> dict:
    aggregate = {}
    for method in case_results[0]["comparison"]["methods"]:
        entries = [case["comparison"]["methods"][method] for case in case_results]
        recovered = sum(bool(entry["recovery"]) for entry in entries)
        resource_keys = sorted({key for entry in entries for key, value in entry["resources"].items()
                                if isinstance(value, (int, float)) and not isinstance(value, bool)})
        additive_keys = [key for key in resource_keys if key not in ("qubits", "circuit_depth", "free_variables")]
        aggregate[method] = {
            "cases": len(entries), "recovered": recovered, "recovery_rate": recovered / len(entries),
            "recovery_interval_95": wilson_interval(recovered, len(entries)), "interval_method": "Wilson score across independently generated cue cases",
            "mean_bit_error_rate": float(np.mean([entry["bit_error_rate"] for entry in entries])),
            "mean_free_bit_error_rate": float(np.mean([entry["free_bit_error_rate"] for entry in entries])),
            "unintended_memory_rate": sum(bool(entry["unintended_memory"]) for entry in entries) / len(entries),
            "spurious_state_rate": sum(bool(entry["spurious_state"]) for entry in entries) / len(entries),
            "constraint_violation_cases": sum(not entry["constraints_satisfied"] for entry in entries),
            "mean_energy_gap": float(np.mean([entry["energy_gap"] for entry in entries if entry["energy_gap"] is not None])) if any(entry["energy_gap"] is not None for entry in entries) else None,
            "mean_target_probability": float(np.mean([entry["target_probability"] for entry in entries if entry["target_probability"] is not None])) if any(entry["target_probability"] is not None for entry in entries) else None,
            "runtime_seconds": sum(entry["runtime_seconds"] for entry in entries),
            "resources_total": {key: sum(entry["resources"].get(key, 0) for entry in entries if isinstance(entry["resources"].get(key, 0), (int, float))) for key in additive_keys},
            "resources_per_case_range": {key: [min(entry["resources"].get(key, 0) for entry in entries), max(entry["resources"].get(key, 0) for entry in entries)] for key in resource_keys},
        }
    return aggregate


def run_benchmark(config: dict, cases: int = 12, benchmark_seed: int = BENCHMARK_SEED,
                  evaluation_budget: int = 24, progress_callback: Callable | None = None,
                  cancel_check: Callable | None = None) -> dict:
    from .conditioning import build_problem
    from .hopfield import run_hopfield
    from .thermal import run_gibbs
    from .quantum import optimize_angles

    started = perf_counter()
    generated = generate_benchmark_cases(config, cases, benchmark_seed)
    completed = []
    for case in generated:
        if cancel_check and cancel_check():
            raise InterruptedError("benchmark cancelled")
        solver_config = case["config"]
        problem = build_problem(solver_config)
        results = {"hopfield": run_hopfield(problem, solver_config), "gibbs": run_gibbs(problem, solver_config),
                   "quantum": optimize_angles(problem, solver_config, evaluation_budget=evaluation_budget, cancel_check=cancel_check)}
        comparison = evaluate_experiment(problem, solver_config, results, target_index=case["target_index"])
        completed.append({**case, "config_hash": _hash(solver_config), "free_indices": problem["free_indices"],
                          "comparison": comparison,
                          "quantum_angles": {"gammas": results["quantum"].get("gammas"), "betas": results["quantum"].get("betas")}})
        if progress_callback:
            progress_callback({"completed_cases": len(completed), "total_cases": cases, "fraction": len(completed) / cases})
    try:
        from importlib.metadata import version
        versions = {package: version(package) for package in ("numpy", "scipy", "qiskit", "qiskit-aer")}
    except Exception:
        versions = {"status": "package metadata unavailable"}
    return {"schema_version": SCHEMA_VERSION, "created_utc": datetime.now(timezone.utc).isoformat(),
            "benchmark_seed": benchmark_seed, "curation_seed": CURATION_SEED, "cases": completed,
            "case_count": cases, "aggregate": _aggregate(completed), "runtime_seconds": perf_counter() - started,
            "versions": versions, "execution_mode": "local classical simulation with ideal-expectation QAOA optimization",
            "definition": {"bank_hash": _hash(config["memories"]), "cue_generation": "independent random erased subsets" if config.get("mode", "erasure") == "erasure" else "independent 20% per-pixel flips",
                           "source_selection": "uniform from stored bank", "evaluation_budget": evaluation_budget,
                           "depth": config.get("depth", 1), "shots": config.get("shots", 512),
                           "decision": "modal sampled recall; lowest local integer on ties", "bit_error_scope": "all pixels",
                           "independent_unit": "one generated cue and independent solver seed per case", "tuned_on_benchmark": False},
            "limitations": ["A 12-case prototype benchmark is descriptive and has wide uncertainty.",
                            "No hardware was used; simulator timings do not establish quantum speedup.",
                            "Gibbs sample correlations are not counted as extra independent trials.",
                            "Presets are curated illustrations, separate from benchmark generation."]}


def benchmark_csv(benchmark: dict) -> str:
    output = io.StringIO()
    names = ["case_index", "target_index", "seed", "config_hash", "method", "recovery", "bit_error_rate", "free_bit_error_rate",
             "unintended_memory", "spurious_state", "constraints_satisfied", "energy", "energy_gap", "expected_energy",
             "target_probability", "empirical_target_probability", "sample_count", "runtime_seconds", "resources_json", "ties_json"]
    writer = csv.DictWriter(output, fieldnames=names)
    writer.writeheader()
    for case in benchmark["cases"]:
        for method, metrics in case["comparison"]["methods"].items():
            row = {key: metrics.get(key) for key in names}
            row.update(case_index=case["case_index"], target_index=case["target_index"], seed=case["config"]["seed"],
                       config_hash=case["config_hash"], method=method, resources_json=json.dumps(metrics["resources"], sort_keys=True),
                       ties_json=json.dumps(metrics["ties"]))
            writer.writerow(row)
    return output.getvalue()


def get_presets() -> list[dict]:
    path = RESULTS / "presets.json"
    if not path.exists():
        return []
    return json.loads(path.read_text())
