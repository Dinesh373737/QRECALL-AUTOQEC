"""Genuine Qiskit QAOA, exact gate snapshots, Aer shots and bounded optimization.

The energy includes the conditioning constant. Its unitary contribution is only
a global phase, while that constant still belongs in every reported objective.
No solver function accepts the source-memory identity.
"""
from __future__ import annotations

from time import perf_counter
from typing import Callable
import numpy as np
from scipy.optimize import minimize
from qiskit import QuantumCircuit, transpile
from qiskit.circuit.library import RXGate, RZGate, RZZGate
from qiskit.quantum_info import SparsePauliOp, Statevector
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, ReadoutError, depolarizing_error

from .conditioning import full_state, reject_target, _integer


class CancelledComputation(RuntimeError):
    """A cooperative job cancellation, never a fabricated result."""


def counts_to_integers(counts: dict[str, int], qubits: int) -> dict[str, int]:
    """One tested boundary for Qiskit's high-index-first count labels."""
    result: dict[str, int] = {}
    for label, count in counts.items():
        clean = label.replace(" ", "")
        if len(clean) != qubits or any(bit not in "01" for bit in clean):
            raise ValueError("Qiskit count label does not match the free-qubit count.")
        state = str(int(clean, 2)) if clean else "0"
        result[state] = result.get(state, 0) + int(count)
    return dict(sorted(result.items(), key=lambda item: int(item[0])))


def integer_to_logical_bits(state: int, qubits: int) -> list[int]:
    if not 0 <= state < 2**qubits:
        raise ValueError("State index is outside the free-qubit basis.")
    return [(state >> q) & 1 for q in range(qubits)]


def modal_state(counts: dict[str, int]) -> tuple[int, list[int]]:
    if not counts or sum(counts.values()) < 1:
        raise ValueError("The sampled decision needs at least one measurement.")
    highest = max(counts.values())
    candidates = sorted(int(k) for k, v in counts.items() if v == highest)
    return candidates[0], candidates if len(candidates) > 1 else []


def measurement_events(problem: dict, memory: list[str]) -> list[dict]:
    """Prefixes of Aer shot memory in its returned order, never invented order."""
    qubits = len(problem["free_indices"])
    if not qubits or not memory:
        return []
    batch = max(1, (len(memory) + 15) // 16)
    counts: dict[str, int] = {}
    events = []
    for shots, label in enumerate(memory, start=1):
        state = next(iter(counts_to_integers({label: 1}, qubits)))
        counts[state] = counts.get(state, 0) + 1
        if shots % batch == 0 or shots == len(memory):
            selected, ties = modal_state(counts)
            events.append({"event": "measurement", "shots": shots,
                           "counts": dict(sorted(counts.items(), key=lambda pair: int(pair[0]))),
                           "output": list(full_state(problem, selected)),
                           "state_integer": selected, "ties": ties})
    return events


def hamiltonian(problem: dict) -> SparsePauliOp:
    """Cost operator, with Qiskit's rightmost Pauli character on qubit zero."""
    free = problem["free_indices"]
    m = len(free)
    if m == 0:
        # Qiskit operators need positive width; empty problems are returned directly.
        raise ValueError("The zero-qubit problem has a scalar Hamiltonian.")
    weights = np.asarray(problem["weights"], dtype=np.float64)
    terms: list[tuple[str, float]] = [("I" * m, float(problem["constant"]))]
    for a, global_a in enumerate(free):
        if problem["fields"][a] != 0:
            label = ["I"] * m
            label[m - 1 - a] = "Z"
            terms.append(("".join(label), -float(problem["fields"][a])))
        for b in range(a + 1, m):
            coefficient = weights[global_a, free[b]]
            if coefficient != 0:
                label = ["I"] * m
                label[m - 1 - a] = label[m - 1 - b] = "Z"
                terms.append(("".join(label), -float(coefficient)))
    return SparsePauliOp.from_list(terms).simplify()


def _snapshot(state: Statevector, energies: np.ndarray, free: list[int], index: int,
              event: str, layer: int, gate: str | None = None, angle: float | None = None,
              qubits: list[int] | None = None, coefficient: float | None = None) -> dict:
    amplitudes = np.asarray(state.data, dtype=np.complex128)
    probs = np.abs(amplitudes) ** 2
    nonzero = np.flatnonzero(np.abs(amplitudes) > 1e-12)
    reference = np.angle(amplitudes[nonzero[0]]) if len(nonzero) else 0.0
    phases = [float(np.angle(v * np.exp(-1j * reference))) if abs(v) > 1e-12 else None
              for v in amplitudes]
    qs = qubits or []
    return {"index": index, "event": event, "layer": layer, "gate": gate,
            "angle": angle, "qubits": qs, "global_qubits": [free[q] for q in qs],
            "coefficient": coefficient, "probabilities": probs.tolist(),
            "amplitudes": [{"real": float(v.real), "imag": float(v.imag)} for v in amplitudes],
            "phases": phases, "expected_energy": float(np.dot(probs, energies))}


def build_circuit(problem: dict, gammas: list[float], betas: list[float],
                  snapshots: bool = True) -> tuple[QuantumCircuit, Statevector, list[dict], list[dict]]:
    free = list(problem["free_indices"])
    m = len(free)
    if not 1 <= m <= 8:
        raise ValueError("QAOA circuits require 1 to 8 free qubits.")
    if len(gammas) != len(betas) or not 1 <= len(gammas) <= 3:
        raise ValueError("QAOA requires one gamma and beta for each of 1 to 3 layers.")
    if not np.isfinite(gammas + betas).all():
        raise ValueError("Angles must be finite.")
    circuit = QuantumCircuit(m)
    circuit.h(range(m))
    gates = [{"gate": "h", "layer": 0, "qubits": [q], "global_qubits": [free[q]],
              "angle": None, "coefficient": None} for q in range(m)]
    state = Statevector.from_instruction(circuit)
    energies = np.asarray(problem["energies"], dtype=np.float64)
    trace = [_snapshot(state, energies, free, 0, "initialization", 0)] if snapshots else []
    weights = np.asarray(problem["weights"], dtype=np.float64)

    def apply(gate_object, event: str, layer: int, name: str, qs: list[int],
              angle: float, coefficient: float | None):
        nonlocal state
        circuit.append(gate_object, qs)
        state = state.evolve(gate_object, qargs=qs)
        gates.append({"gate": name, "layer": layer, "qubits": qs,
                      "global_qubits": [free[q] for q in qs], "angle": angle,
                      "coefficient": coefficient})
        if snapshots:
            trace.append(_snapshot(state, energies, free, len(trace), event, layer,
                                   name, angle, qs, coefficient))

    for layer, (gamma, beta) in enumerate(zip(gammas, betas), start=1):
        phase = -float(gamma) * float(problem["constant"])
        circuit.global_phase += phase
        state = Statevector(np.asarray(state.data) * np.exp(1j * phase))
        for a in range(m):
            for b in range(a + 1, m):
                coefficient = float(weights[free[a], free[b]])
                if coefficient != 0:
                    angle = -2 * float(gamma) * coefficient
                    apply(RZZGate(angle), "cost", layer, "rzz", [a, b], angle, coefficient)
        for a, coefficient in enumerate(problem["fields"]):
            coefficient = float(coefficient)
            if coefficient != 0:
                angle = -2 * float(gamma) * coefficient
                apply(RZGate(angle), "cost", layer, "rz", [a], angle, coefficient)
        if snapshots:
            trace.append(_snapshot(state, energies, free, len(trace), "cost_layer", layer))
        for q in range(m):
            angle = 2 * float(beta)
            apply(RXGate(angle), "mixer", layer, "rx", [q], angle, None)
        if snapshots:
            trace.append(_snapshot(state, energies, free, len(trace), "mixer_layer", layer))
    return circuit, state, trace, gates


def run_quantum(problem: dict, config: dict) -> dict:
    reject_target(config)
    started = perf_counter()
    m = len(problem["free_indices"])
    shots = _integer(config.get("shots", 1024), "shots", 1, 8192)
    seed = _integer(config.get("seed", 42), "seed", 0, 2**32 - 1)
    gammas = list(config.get("gammas", [0.7]))
    betas = list(config.get("betas", [0.35]))
    energies = np.asarray(problem["energies"], dtype=np.float64)
    noise = config.get("noise") or {}
    warnings: list[str] = []
    compiled_ms = simulation_ms = 0.0
    if m == 0:
        output = list(full_state(problem, 0))
        probabilities = empirical = np.asarray([1.0])
        counts: dict[str, int] = {}
        qiskit_counts: dict[str, int] = {}
        measurement_trace = []
        gates: list[dict] = []
        trace = [_snapshot(Statevector([1.0]), energies, [], 0, "initialization", 0)]
        state_integer, ties, depth, compiled_gates = 0, [], 0, {}
        execution_mode = "trivial fully clamped problem"
    else:
        circuit, state, trace, gates = build_circuit(problem, gammas, betas)
        probabilities = np.abs(np.asarray(state.data)) ** 2
        measured = circuit.copy()
        measured.measure_all()
        noise_model = None
        if noise.get("enabled", False):
            error = float(noise.get("gate_error", 0.01))
            readout = float(noise.get("readout_error", 0.02))
            noise_model = NoiseModel()
            noise_model.add_all_qubit_quantum_error(depolarizing_error(error, 1), ["h", "rz", "rx"])
            noise_model.add_all_qubit_quantum_error(depolarizing_error(error, 2), ["rzz"])
            noise_model.add_all_qubit_readout_error(ReadoutError([[1-readout, readout], [readout, 1-readout]]))
            execution_mode = "Aer noisy finite-shot simulation"
            warnings.append("Phase playback shows the ideal circuit; noisy measurements describe a mixed-state run.")
        else:
            execution_mode = "Qiskit ideal statevector + Aer finite-shot sampling"
        simulator = AerSimulator(method="density_matrix" if noise_model else "statevector",
                                 noise_model=noise_model, max_parallel_threads=1)
        before_compile = perf_counter()
        compiled = transpile(measured, simulator, optimization_level=0, seed_transpiler=seed)
        compiled_ms = (perf_counter() - before_compile) * 1000
        before_simulate = perf_counter()
        result = simulator.run(compiled, shots=shots, seed_simulator=seed, memory=True).result()
        simulation_ms = (perf_counter() - before_simulate) * 1000
        qiskit_counts = {str(k): int(v) for k, v in result.get_counts().items()}
        counts = counts_to_integers(qiskit_counts, m)
        memory = [str(label) for label in result.get_memory()]
        if len(memory) != shots:
            raise RuntimeError("Aer did not return one memory item per requested shot.")
        measurement_trace = measurement_events(problem, memory)
        if measurement_trace[-1]["counts"] != counts:
            raise RuntimeError("Aer shot-memory prefixes disagree with its final counts.")
        empirical = np.asarray([counts.get(str(i), 0) / shots for i in range(2**m)])
        state_integer, ties = modal_state(counts)
        output = list(full_state(problem, state_integer))
        depth = circuit.depth()
        compiled_gates = {str(k): int(v) for k, v in compiled.count_ops().items()}
    return {"method": "quantum", "status": "completed", "trace": trace,
            "measurement_trace": measurement_trace, "output": output,
            "final_state": output, "state_integer": state_integer, "counts": counts,
            "qiskit_counts": qiskit_counts, "probabilities": probabilities.tolist(),
            "empirical_probabilities": empirical.tolist(),
            "expected_energy": float(probabilities @ energies),
            "sampled_energy": float(empirical @ energies), "gates": gates,
            "gammas": gammas, "betas": betas, "ties": ties,
            "decision": {"rule": "modal sampled state", "state_integer": state_integer,
                         "tied_states": ties, "tie_rule": "lowest integer basis state"},
            "execution_mode": execution_mode, "phase_trace_mode": "ideal pure-state simulation",
            "probability_source": "ideal statevector; noisy empirical probabilities are separate",
            "warnings": warnings, "optimizer_history": [], "optimization": None,
            "resources": {"qubits": m, "shots": shots if m else 0, "requested_shots": shots, "gate_count": len(gates),
                          "circuit_depth": depth, "compiled_gate_counts": compiled_gates,
                          "compilation_ms": compiled_ms, "simulation_ms": simulation_ms,
                          "duration_ms": (perf_counter() - started) * 1000,
                          "optimizer_evaluations": 0}}


run_qaoa = run_quantum


def optimize_angles(problem: dict, config: dict, evaluation_budget: int = 24,
                    progress_callback: Callable | None = None,
                    cancel_check: Callable | None = None) -> dict:
    """One seeded, bounded ideal-expectation COBYLA run; never optimize a target."""
    reject_target(config)
    started = perf_counter()
    budget = int(evaluation_budget)
    if not 4 <= budget <= 128:
        raise ValueError("The optimizer budget must lie between 4 and 128 evaluations.")
    depth = int(config.get("depth", 1))
    if budget < 2 * depth + 2:
        raise ValueError("The optimizer needs a budget of at least 2 × depth + 2 evaluations.")
    energies = np.asarray(problem["energies"], dtype=np.float64)
    history: list[dict] = []
    rng = np.random.default_rng(int(config.get("seed", 42)))
    initial = np.concatenate([rng.uniform(-np.pi, np.pi, depth),
                              rng.uniform(-np.pi/2, np.pi/2, depth)])
    best = {"value": float("inf"), "angles": initial.copy()}

    def objective(angles):
        if cancel_check and cancel_check():
            raise CancelledComputation("Optimization cancelled by user.")
        if len(history) >= budget:
            return best["value"]
        if not problem["free_indices"]:
            value = float(energies[0])
        else:
            _, state, _, _ = build_circuit(problem, list(angles[:depth]), list(angles[depth:]), snapshots=False)
            value = float((np.abs(state.data) ** 2) @ energies)
        if value < best["value"]:
            best.update(value=value, angles=np.array(angles, copy=True))
        history.append({"evaluation": len(history) + 1, "objective": value,
                        "best_objective": best["value"], "gammas": angles[:depth].tolist(),
                        "betas": angles[depth:].tolist()})
        if progress_callback:
            progress_callback(len(history) / budget, "Optimizing ideal expected energy")
        return value

    if not problem["free_indices"]:
        objective(initial)
        message, success = "Fully clamped: no angles need optimization.", True
    else:
        result = minimize(objective, initial, method="COBYLA",
                          bounds=[(-np.pi, np.pi)] * depth + [(-np.pi/2, np.pi/2)] * depth,
                          options={"maxiter": budget, "rhobeg": 0.5, "tol": 1e-4})
        message, success = str(result.message), bool(result.success)
    if cancel_check and cancel_check():
        raise CancelledComputation("Optimization cancelled before sampling.")
    optimized_config = {**config, "gammas": best["angles"][:depth].tolist(),
                        "betas": best["angles"][depth:].tolist()}
    optimization_ms = (perf_counter() - started) * 1000
    output = run_quantum(problem, optimized_config)
    output["optimizer_history"] = history
    output["resources"]["optimizer_evaluations"] = len(history)
    output["resources"]["optimization_ms"] = optimization_ms
    output["resources"]["duration_ms"] = (perf_counter() - started) * 1000
    output["optimization"] = {"method": "COBYLA", "objective": "ideal expected conditioned energy",
                              "budget": budget, "evaluations": len(history), "success": success,
                              "stop_reason": message, "seed": int(config.get("seed", 42)),
                              "initial_gammas": initial[:depth].tolist(),
                              "initial_betas": initial[depth:].tolist(),
                              "best_objective": best["value"]}
    return output
