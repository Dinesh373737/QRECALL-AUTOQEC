"""Independent checks for the derived mathematical lesson, never solver decisions."""
from copy import deepcopy
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.core.conditioning import build_problem
from backend.core.diagnostics import basis_energy_breakdown, experiment_diagnostics, snapshot_diagnostics
from backend.core.quantum import run_quantum
from backend.main import app
from backend.schemas import ExperimentDiagnostics, ExperimentResult


def config():
    return {"rows": 2, "cols": 2, "memories": [[1, 1, -1, -1], [1, -1, 1, -1]],
            "cue": [1, None, None, -1], "mode": "erasure", "seed": 42,
            "biases": [0.2, -0.1, 0.3, -0.2], "samples": 4, "burn_in": 1,
            "thinning": 1, "shots": 32, "depth": 1, "gammas": [0.7], "betas": [0.35]}


def snapshot(probabilities):
    return {"probabilities": probabilities,
            "amplitudes": [{"real": float(np.sqrt(p)), "imag": 0.0} for p in probabilities]}


@pytest.mark.parametrize("mode", ["erasure", "noisy", "clamped"])
def test_energy_breakdown_matches_conditioned_and_independent_full_energies(mode):
    c = config()
    if mode == "noisy":
        c.update(mode="noisy", cue=[1, -1, 1, None], cue_strength=0.8,
                 reliability=[1.0, 0.25, 0.7, 0.0])
    elif mode == "clamped":
        c["cue"] = c["memories"][0][:]
    problem = build_problem(c)
    breakdown = basis_energy_breakdown(problem)
    assert len(breakdown) == len(problem["energies"]) == 2 ** len(problem["free_indices"])
    weights = np.asarray(problem["weights"])
    biases = np.asarray(problem["biases"])
    for index, entry in enumerate(breakdown):
        full = np.asarray(problem["states"][index])
        independently_full = -sum(weights[i, j] * full[i] * full[j]
                                  for i in range(problem["n"]) for j in range(i + 1, problem["n"])) - biases @ full
        assert entry["state_integer"] == index
        assert sum(entry[key] for key in ("pair_energy", "field_energy", "constant_energy")) == pytest.approx(independently_full)
        assert entry["total_energy"] == pytest.approx(problem["energies"][index])


def test_known_nonuniform_state_has_correct_norm_moments_entropy_and_participation():
    event = {"probabilities": [0.75, 0.25],
             "amplitudes": [{"real": 0.0, "imag": np.sqrt(0.75)}, {"real": -0.5, "imag": 0.0}]}
    summary = snapshot_diagnostics(event, [-2.0, 4.0], 7)
    assert summary["index"] == 7
    assert summary["amplitude_norm"] == pytest.approx(1)
    assert summary["probability_sum"] == pytest.approx(1)
    assert summary["expected_energy"] == pytest.approx(-0.5)
    assert summary["energy_variance"] == pytest.approx(6.75)
    assert summary["basis_entropy_bits"] == pytest.approx(0.8112781244591328)
    assert summary["effective_basis_states"] == pytest.approx(1.6)


@pytest.mark.parametrize("qubits", [0, 1, 4, 8])
def test_uniform_distribution_has_bits_of_basis_entropy_and_full_participation(qubits):
    size = 2 ** qubits
    event = snapshot([1.0 / size] * size)
    summary = snapshot_diagnostics(event, list(range(size)), 0)
    assert summary["amplitude_norm"] == pytest.approx(1)
    assert summary["probability_sum"] == pytest.approx(1)
    assert summary["expected_energy"] == pytest.approx((size - 1) / 2)
    assert summary["energy_variance"] == pytest.approx((size * size - 1) / 12)
    assert summary["basis_entropy_bits"] == pytest.approx(qubits)
    assert summary["effective_basis_states"] == pytest.approx(size)


def test_basis_state_has_zero_entropy_and_variance_and_one_effective_state():
    summary = snapshot_diagnostics(snapshot([0.0, 0.0, 1.0, 0.0]), [-10.0, -1.0, 3.0, 8.0], 0)
    assert summary["expected_energy"] == 3.0
    assert summary["energy_variance"] == summary["basis_entropy_bits"] == 0.0
    assert summary["effective_basis_states"] == 1.0


def test_large_energy_offset_does_not_destroy_small_centered_variance():
    energies = [1e12 - 2, 1e12 + 2]
    summary = snapshot_diagnostics(snapshot([0.5, 0.5]), energies, 0)
    assert summary["expected_energy"] == 1e12
    assert summary["energy_variance"] == pytest.approx(4.0)


def test_extreme_finite_bias_second_moment_is_explicitly_unavailable():
    summary = snapshot_diagnostics(snapshot([0.5, 0.5]), [-1e200, 1e200], 0)
    assert summary["expected_energy"] == 0.0
    assert summary["energy_variance"] is None
    assert json.loads(json.dumps(summary, allow_nan=False))["energy_variance"] is None


def test_real_snapshots_parallel_trace_and_preserve_solver_inputs_and_outputs():
    problem = build_problem(config())
    quantum = run_quantum(problem, config())
    original_problem, original_quantum = deepcopy(problem), deepcopy(quantum)
    diagnostics = experiment_diagnostics(problem, quantum)
    ExperimentDiagnostics.model_validate(diagnostics)
    assert diagnostics["source"] == "ideal_statevector"
    assert len(diagnostics["quantum_trace"]) == len(quantum["trace"])
    assert diagnostics["quantum_final"] == diagnostics["quantum_trace"][-1]
    for index, (event, summary) in enumerate(zip(quantum["trace"], diagnostics["quantum_trace"])):
        assert summary["index"] == index
        assert summary["expected_energy"] == pytest.approx(event["expected_energy"], abs=1e-12)
        assert summary["amplitude_norm"] == pytest.approx(1, abs=1e-12)
        assert summary["probability_sum"] == pytest.approx(1, abs=1e-12)
        assert summary["energy_variance"] >= 0
        assert -1e-12 <= summary["basis_entropy_bits"] <= len(problem["free_indices"]) + 1e-12
        assert 1 - 1e-12 <= summary["effective_basis_states"] <= len(problem["states"]) + 1e-12
    assert problem == original_problem
    assert quantum == original_quantum
    assert not any("target" in key for key in diagnostics)


def test_noise_changes_empirical_sampling_but_never_ideal_diagnostics():
    c = config()
    problem = build_problem(c)
    ideal = run_quantum(problem, c)
    noisy = run_quantum(problem, {**c, "noise": {"enabled": True, "gate_error": 0.2, "readout_error": 0.2}})
    assert noisy["execution_mode"] != ideal["execution_mode"]
    assert experiment_diagnostics(problem, noisy) == experiment_diagnostics(problem, ideal)
    assert any("not entanglement" in note for note in experiment_diagnostics(problem, noisy)["notes"])


def test_maximum_width_and_depth_diagnostics_remain_under_200_kib():
    c = {"rows": 1, "cols": 8, "memories": [[1] * 8], "cue": [None] * 8,
         "mode": "erasure", "seed": 42, "biases": np.linspace(0.1, 0.8, 8).tolist(),
         "depth": 3, "gammas": [0.2, 0.7, -0.9], "betas": [0.3, -0.2, 0.11], "shots": 16}
    problem = build_problem(c)
    quantum = run_quantum(problem, c)
    diagnostics = experiment_diagnostics(problem, quantum)
    assert len(diagnostics["quantum_trace"]) == 139
    assert len(diagnostics["basis_energy"]) == 256
    assert len(json.dumps(diagnostics, allow_nan=False).encode()) < 200 * 1024
    ExperimentDiagnostics.model_validate(diagnostics)


def test_zero_qubits_are_a_deterministic_constant_without_measurements():
    c = config()
    c["cue"] = c["memories"][0][:]
    problem = build_problem(c)
    quantum = run_quantum(problem, c)
    diagnostics = experiment_diagnostics(problem, quantum)
    assert quantum["counts"] == {} and quantum["measurement_trace"] == []
    assert len(diagnostics["quantum_trace"]) == len(diagnostics["basis_energy"]) == 1
    summary = diagnostics["quantum_final"]
    assert summary["amplitude_norm"] == summary["probability_sum"] == summary["effective_basis_states"] == 1.0
    assert summary["basis_entropy_bits"] == summary["energy_variance"] == 0.0
    assert summary["expected_energy"] == problem["constant"]


@pytest.mark.parametrize("probabilities,energies", [([], []), ([1.0] * 257, [0.0] * 257),
                                                     ([1.0], []), ([-0.5, 1.5], [0.0, 1.0]),
                                                     ([0.0], [0.0]), ([float("nan")], [0.0])])
def test_invalid_unbounded_or_mismatched_snapshot_inputs_fail(probabilities, energies):
    event = {"probabilities": probabilities, "amplitudes": [{"real": 1.0, "imag": 0.0}] * len(probabilities)}
    with pytest.raises(ValueError):
        snapshot_diagnostics(event, energies, 0)


def test_api_exposes_typed_diagnostics_without_changing_optional_legacy_contract():
    response = TestClient(app).post("/api/experiment", json=config())
    assert response.status_code == 200, response.text
    result = response.json()
    validated = ExperimentResult.model_validate(result)
    assert validated.diagnostics.quantum_final.expected_energy == pytest.approx(result["quantum"]["expected_energy"])
    assert len(result["diagnostics"]["basis_energy"]) == len(result["model"]["states"])
    result.pop("diagnostics")
    assert ExperimentResult.model_validate(result).diagnostics is None
