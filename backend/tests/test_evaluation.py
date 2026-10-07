"""Fairness contracts: observations, modal recall, and isolated evaluation labels."""
import copy

import numpy as np
import pytest

from backend.core.evaluation import (
    BENCHMARK_SEED, CURATION_SEED, benchmark_csv, evaluate_experiment,
    evaluate_method, exact_references, generate_benchmark_cases,
    modal_decision, nearest_memory, wilson_interval,
)


def fixture():
    config = {"rows": 1, "cols": 2, "memories": [[1, 1], [1, -1]], "cue": [1, None],
              "mode": "erasure", "temperature": 0.5, "seed": 6}
    problem = {"n": 2, "weights": [[0, 0], [0, 0]], "biases": [0, 0.5],
               "free_indices": [1], "trusted_indices": [0], "states": [[1, 1], [1, -1]], "energies": [-0.5, 0.5]}
    return problem, config


def test_nearest_uses_observations_and_preserves_ambiguity():
    _, config = fixture()
    result = nearest_memory(config)
    assert result["observed_indices"] == [0]
    assert result["scores"] == [0, 0]
    assert result["tied_memory_indices"] == [0, 1]
    assert result["memory_index"] == 0


def test_nearest_noisy_reliability_is_documented_and_unclamped():
    _, config = fixture()
    config.update(mode="noisy", cue=[-1, -1], reliability=[0.1, 1])
    assert nearest_memory(config)["memory_index"] == 1
    assert "reliability-weighted" in nearest_memory(config)["score"]


def test_optional_mask_and_reliability_defaults_respect_available_information():
    _, config = fixture()
    config.update(mode="noisy", cue=[1, -1], reliability=None, observed_mask=[True, False])
    assert nearest_memory(config)["tied_memory_indices"] == [0, 1]
    assert nearest_memory(config)["observed_indices"] == [0]


def test_modal_count_tie_is_lowest_integer_not_insertion_order():
    assert modal_decision({"3": 8, "1": 8, "0": 1}, 4)["state_integer"] == 1
    assert modal_decision({"3": 8, "1": 8}, 4)["tied_states"] == [1, 3]
    with pytest.raises(ValueError):
        modal_decision({"0": 0}, 2)
    with pytest.raises(ValueError):
        modal_decision({"2": 1}, 2)


def test_sampled_recovery_uses_mode_even_if_minimum_energy_sample_exists():
    problem, config = fixture()
    result = {"final_state": [1, 1], "counts": {"0": 1, "1": 9}, "probabilities": [0.1, 0.9]}
    metrics = evaluate_method(problem, config, result, target_index=0, method="quantum")
    assert metrics["final_state"] == [1, -1]
    assert not metrics["recovery"]
    assert metrics["energy_gap"] == 1
    assert metrics["bit_error_rate"] == 0.5
    assert metrics["free_bit_error_rate"] == 1
    assert metrics["unintended_memory"]
    assert not metrics["spurious_state"]
    assert metrics["target_probability"] == 0.1
    assert metrics["empirical_target_probability"] == 0.1


def test_sampled_solver_cannot_substitute_a_state_for_missing_counts():
    problem, config = fixture()
    with pytest.raises(ValueError, match="actual nonempty counts"):
        evaluate_method(problem, config, {"output": [1, 1]}, 0, "quantum")


def test_target_changes_evaluation_never_changes_solver_input_or_decision():
    problem, config = fixture()
    before = copy.deepcopy(config)
    result = {"counts": {"0": 1, "1": 1}, "output": [1, -1]}
    first = evaluate_experiment(problem, config, {"quantum": result}, 0)
    second = evaluate_experiment(problem, config, {"quantum": result}, 1)
    assert config == before
    assert first["methods"]["quantum"]["final_state"] == second["methods"]["quantum"]["final_state"] == [1, 1]
    assert first["methods"]["quantum"]["recovery"]
    assert not second["methods"]["quantum"]["recovery"]
    assert first["references"]["nearest_memory"]["tied_memory_indices"] == [0, 1]


def test_exact_reference_stable_and_temperature_limits():
    problem, _ = fixture()
    low = exact_references(problem, 0.00001)
    high = exact_references(problem, 1e8)
    assert np.allclose(low["exact_gibbs"]["probabilities"], [1, 0])
    assert np.allclose(high["exact_gibbs"]["probabilities"], [0.5, 0.5])
    assert low["exact_minimum"]["state_integer"] == 0


def test_empty_free_set_and_incompatible_target_probability():
    problem, config = fixture()
    problem.update(free_indices=[], trusted_indices=[0, 1], states=[[1, -1]], energies=[0.5])
    config["cue"] = [1, -1]
    result = {"output": [1, -1], "counts": {"0": 4}, "probabilities": [1]}
    metrics = evaluate_method(problem, config, result, 0, "quantum")
    assert metrics["free_bit_error_rate"] == 0
    assert metrics["target_probability"] == 0
    assert metrics["empirical_target_probability"] == 0
    assert not metrics["target_compatible_with_constraints"]
    assert metrics["constraints_satisfied"]


@pytest.mark.parametrize("method", ["quantum", "qaoa", "gibbs"])
def test_fully_clamped_reconstruction_needs_no_fabricated_samples(method):
    problem, config = fixture()
    problem.update(free_indices=[], trusted_indices=[0, 1], states=[[1, -1]], energies=[0.5])
    config["cue"] = [1, -1]
    result = {"output": [1, -1], "counts": {}, "probabilities": [1], "resources": {"shots": 0, "qubits": 0}}
    metrics = evaluate_method(problem, config, result, 1, method)
    assert metrics["final_state"] == config["cue"]
    assert metrics["state_integer"] == 0
    assert metrics["recovery"]
    assert metrics["sample_count"] == 0
    assert metrics["sampled_energy"] is None
    assert metrics["empirical_target_probability"] is None
    assert metrics["target_probability"] == 1
    assert metrics["probability_source"] == "deterministic fully clamped reconstruction"
    assert metrics["decision"]["tie_rule"] == "fully clamped reconstruction; no samples required"
    assert metrics["constraints_satisfied"]
    assert metrics["resources"]["shots"] == 0


def test_unsampled_fully_clamped_reconstruction_can_disagree_with_evaluation_target():
    problem, config = fixture()
    problem.update(free_indices=[], trusted_indices=[0, 1], states=[[1, -1]], energies=[0.5])
    config["cue"] = [1, -1]
    metrics = evaluate_method(problem, config, {"output": [1, -1], "counts": {}, "probabilities": [1]}, 0, "quantum")
    assert not metrics["recovery"]
    assert metrics["target_probability"] == 0
    assert metrics["empirical_target_probability"] is None
    assert not metrics["target_compatible_with_constraints"]


def test_constraints_and_spurious_state_metrics_are_explicit():
    problem, config = fixture()
    metrics = evaluate_method(problem, config, {"output": [-1, 1]}, 0, "hopfield")
    assert metrics["violations"] == [0]
    assert not metrics["constraints_satisfied"]
    assert metrics["spurious_state"]
    assert metrics["energy_gap"] is None  # Outside the conditioned feasible set.


def test_deterministic_hopfield_counts_are_not_misreported_as_measurements():
    problem, config = fixture()
    metrics = evaluate_method(problem, config, {"output": [1, 1], "counts": {"0": 1}, "probabilities": [1, 0]}, 0, "hopfield")
    assert metrics["sample_count"] == 0
    assert metrics["empirical_target_probability"] is None
    assert metrics["target_probability"] == 1


def test_benchmark_generation_reproducible_labels_outside_config():
    _, config = fixture()
    config["target_index"] = 99
    first = generate_benchmark_cases(config)
    second = generate_benchmark_cases(config)
    assert first == second
    assert len(first) == 12
    assert len({case["config"]["seed"] for case in first}) == 12
    assert all("target_index" not in case["config"] for case in first)
    assert BENCHMARK_SEED != CURATION_SEED
    with pytest.raises(ValueError):
        generate_benchmark_cases(config, benchmark_seed=CURATION_SEED)


def test_wilson_interval_uses_independent_cases_not_shots():
    low, high = wilson_interval(12, 12)
    assert 0.75 < low < 0.76
    assert high == pytest.approx(1)
    low, high = wilson_interval(0, 12)
    assert low == pytest.approx(0)
    assert 0.24 < high < 0.25


def test_csv_keeps_case_provenance_and_separate_resources():
    problem, config = fixture()
    comparison = evaluate_experiment(problem, config, {}, 0)
    result = {"cases": [{"case_index": 0, "target_index": 0, "config": config,
                          "config_hash": "test", "comparison": comparison}]}
    csv = benchmark_csv(result)
    assert "config_hash" in csv
    assert "nearest_memory" in csv and "exact_gibbs" in csv
    assert "resources_json" in csv
