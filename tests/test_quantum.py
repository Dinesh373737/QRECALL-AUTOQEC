"""Independent signs, Pauli ordering, gate evolution and finite-shot decisions."""
import inspect
import numpy as np
import pytest
from qiskit.quantum_info import Statevector

from backend.core.conditioning import build_problem, state_integer
from backend.core.quantum import (build_circuit, hamiltonian, run_quantum, optimize_angles,
                                  counts_to_integers, integer_to_logical_bits, modal_state,
                                  CancelledComputation, measurement_events)
from backend.schemas import QuantumResult


def config(n=4, seed=42):
    rng = np.random.default_rng(500 + n)
    return {"rows": 1, "cols": n, "memories": rng.choice([-1, 1], (3, n)).tolist(),
            "cue": [None] * n, "mode": "erasure", "seed": seed,
            "biases": np.linspace(-0.3, 0.5, n).tolist(), "depth": 1,
            "gammas": [0.73], "betas": [0.31], "shots": 256,
            "noise": {"enabled": False}}


@pytest.mark.parametrize("n", range(2, 9))
def test_hamiltonian_diagonal_matches_all_classical_energies(n):
    problem = build_problem(config(n))
    matrix = hamiltonian(problem).to_matrix()
    np.testing.assert_allclose(np.diag(matrix).real, problem["energies"], atol=1e-12)
    np.testing.assert_allclose(matrix - np.diag(np.diag(matrix)), 0, atol=1e-12)


def test_conditioned_hamiltonian_preserves_original_energy_and_constant():
    c = config(8)
    c["cue"] = [1, None, -1, None, None, 1, -1, None]
    p = build_problem(c)
    np.testing.assert_allclose(np.diag(hamiltonian(p).to_matrix()).real, p["energies"], atol=1e-12)
    assert p["free_indices"] == [1, 3, 4, 7]
    assert p["normalization"] == 8


def test_cost_unitary_signs_and_constant_against_independent_diagonal():
    c = config(3)
    c["betas"] = [0.0]
    p = build_problem(c)
    circuit, state, trace, gates = build_circuit(p, c["gammas"], c["betas"])
    expected = np.exp(-1j * c["gammas"][0] * np.asarray(p["energies"])) / np.sqrt(8)
    np.testing.assert_allclose(state.data, expected, atol=1e-12)
    np.testing.assert_allclose(Statevector.from_instruction(circuit).data, expected, atol=1e-12)
    for event in trace:
        np.testing.assert_allclose(event["probabilities"], [1/8] * 8, atol=1e-12)
    assert any(abs(v) > 1e-4 for v in trace[-1]["phases"])
    for gate in gates:
        if gate["gate"] in ("rzz", "rz"):
            assert gate["angle"] == pytest.approx(-2 * c["gammas"][0] * gate["coefficient"])


def test_mixer_unitary_and_probability_interference():
    # E=-hZ and exp(-iβX) give P(0)=(1-sin(2γh)sin(2β))/2.
    c = {**config(1), "memories": [[1]], "biases": [0.6]}
    p = build_problem(c)
    circuit, state, trace, _ = build_circuit(p, c["gammas"], c["betas"])
    probability = (1 - np.sin(2 * 0.73 * 0.6) * np.sin(2 * 0.31)) / 2
    assert abs(state.data[0]) ** 2 == pytest.approx(probability, abs=1e-12)
    np.testing.assert_allclose(state.data, Statevector.from_instruction(circuit).data, atol=1e-12)
    assert trace[-1]["probabilities"] != pytest.approx([0.5, 0.5])
    for event in trace:
        assert sum(event["probabilities"]) == pytest.approx(1.0, abs=1e-12)


@pytest.mark.parametrize("qubits", range(1, 9))
def test_count_order_roundtrip_and_local_to_global(qubits):
    for index in range(2**qubits):
        bits = integer_to_logical_bits(index, qubits)
        assert state_integer([1-2*b for b in bits]) == index
        label = format(index, f"0{qubits}b")
        assert counts_to_integers({label: 5}, qubits) == {str(index): 5}


def test_modal_decision_uses_counts_then_lowest_integer():
    assert modal_state({"9": 5, "3": 5, "0": 4}) == (3, [3, 9])
    assert modal_state({"9": 6, "3": 5}) == (9, [])
    with pytest.raises(ValueError):
        modal_state({})


def test_real_aer_shots_seed_replay_and_schema():
    c = config(3)
    p = build_problem(c)
    a, b = run_quantum(p, c), run_quantum(p, c)
    assert a["counts"] == b["counts"]
    assert a["trace"] == b["trace"]
    assert a["measurement_trace"] == b["measurement_trace"]
    assert a["measurement_trace"][-1]["counts"] == a["counts"]
    assert a["measurement_trace"][-1]["output"] == a["output"]
    assert a["measurement_trace"][-1]["shots"] == c["shots"]
    previous = 0
    for prefix in a["measurement_trace"]:
        assert prefix["shots"] > previous
        assert sum(prefix["counts"].values()) == prefix["shots"]
        previous = prefix["shots"]
    assert sum(a["counts"].values()) == c["shots"]
    QuantumResult.model_validate(a)
    assert a["output"] == p["states"][a["state_integer"]]
    assert "Aer" in a["execution_mode"]


def test_optional_noise_keeps_ideal_phases_explicitly_labelled():
    c = config(2)
    p = build_problem(c)
    c["noise"] = {"enabled": True, "gate_error": 0.03, "readout_error": 0.04}
    result = run_quantum(p, c)
    assert sum(result["counts"].values()) == c["shots"]
    assert "noisy" in result["execution_mode"]
    assert "ideal" in result["phase_trace_mode"]
    assert result["warnings"]
    QuantumResult.model_validate(result)


def test_empty_free_is_exact_without_a_circuit():
    c = config(4)
    c["cue"] = c["memories"][0]
    p = build_problem(c)
    result = run_quantum(p, c)
    assert result["output"] == c["cue"]
    assert result["counts"] == {}
    assert result["measurement_trace"] == []
    assert result["resources"]["shots"] == 0
    assert result["gates"] == []
    assert result["resources"]["qubits"] == 0
    QuantumResult.model_validate(result)


def test_optimizer_budget_and_seeded_replay():
    c = config(2)
    p = build_problem(c)
    a, b = optimize_angles(p, c, 12), optimize_angles(p, c, 12)
    assert 1 <= len(a["optimizer_history"]) <= 12
    assert a["optimizer_history"] == b["optimizer_history"]
    assert a["counts"] == b["counts"]
    assert a["optimization"]["objective"] == "ideal expected conditioned energy"
    assert a["optimization"]["best_objective"] <= a["optimizer_history"][0]["objective"]
    QuantumResult.model_validate(a)


def test_source_identity_is_excluded_from_quantum_solver():
    assert "target_index" not in inspect.signature(run_quantum).parameters
    c = config(2)
    p = build_problem(c)
    with pytest.raises(ValueError, match="target identity"):
        run_quantum(p, {**c, "target_index": 0})


def test_optimization_cancellation_produces_no_partial_result():
    c = config(2)
    with pytest.raises(CancelledComputation):
        optimize_angles(build_problem(c), c, 12, cancel_check=lambda: True)


def test_measurement_trace_preserves_actual_memory_order():
    c = config(2)
    problem = build_problem(c)
    # ≤16 shots use one event per real memory entry: prefix ordering is observable.
    memory = ["11", "10", "11", "00", "10"]
    events = measurement_events(problem, memory)
    assert events[0]["counts"] == {"3": 1}
    assert events[1]["counts"] == {"2": 1, "3": 1}
    assert events[1]["state_integer"] == 2
    assert events[1]["ties"] == [2, 3]
    assert events[-1]["counts"] == {"0": 1, "2": 2, "3": 2}
    assert events[-1]["output"] == problem["states"][2]
