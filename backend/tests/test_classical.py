"""Independent contracts for the shared energy, conditioning, and dynamics."""

import json

import numpy as np
import pytest

from backend.core.conditioning import build_problem, full_state, integer_spins, modal_decision, reduced_energy, state_integer
from backend.core.hopfield import run_hopfield
from backend.core.memory_model import bits_to_spins, energy, hebbian_weights, pair_energy, spins_to_bits
from backend.core.thermal import conditional_probability, exact_gibbs, run_gibbs


def config(**changes):
    base = {"rows": 1, "cols": 4, "memories": [[1, 1, -1, -1], [1, -1, 1, -1]],
            "cue": [1, None, None, -1], "mode": "erasure", "seed": 713,
            "temperature": 0.7, "cue_strength": 0.4, "samples": 100, "burn_in": 12}
    base.update(changes)
    return base


def test_hebbian_hand_calculation_and_invariants():
    learned = hebbian_weights([[1, -1, 1], [-1, -1, 1]])
    np.testing.assert_allclose(learned, [[0, 0, 0], [0, 0, -2 / 3], [0, -2 / 3, 0]], atol=1e-14)
    np.testing.assert_array_equal(learned, learned.T)
    np.testing.assert_array_equal(np.diag(learned), 0)
    # Loading one memory does not change the denominator from pixels to patterns.
    assert hebbian_weights([[1, 1, 1, 1]])[0, 1] == 0.25
    problem = build_problem(config())
    np.testing.assert_allclose(np.sum(problem["memory_contributions"], axis=0), problem["weights"])


def test_energy_matrix_matches_single_pairs_with_bias():
    weights = hebbian_weights(config()["memories"])
    bias = [0.12, -0.4, 0.3, 0.0]
    for index in range(16):
        spins = integer_spins(index, 4)
        assert energy(weights, spins, bias) == pytest.approx(pair_energy(weights, spins, bias), abs=1e-14)


@pytest.mark.parametrize("width", range(0, 9))
def test_little_endian_bit_order_round_trip(width):
    for index in range(1 << width):
        spins = integer_spins(index, width)
        assert state_integer(spins) == index
        bits = spins_to_bits(spins)
        assert bits_to_spins(bits) == spins
        assert sum(bit << a for a, bit in enumerate(bits)) == index


@pytest.mark.parametrize("free_count", range(0, 9))
def test_reduced_energy_reconstructs_full_clamped_state(free_count):
    rng = np.random.default_rng(91 + free_count)
    memories = rng.choice([-1, 1], size=(3, 16)).tolist()
    cue = list(memories[0])
    free = sorted(rng.choice(16, free_count, replace=False).tolist())
    for i in free:
        cue[i] = None
    problem = build_problem(config(rows=4, cols=4, memories=memories, cue=cue,
                                   biases=rng.normal(size=16).tolist()))
    assert problem["free_indices"] == free
    for index, local in enumerate(problem["free_states"]):
        full = full_state(problem, index)
        assert full == problem["states"][index]
        assert energy(problem["weights"], full, problem["biases"]) == pytest.approx(problem["energies"][index], abs=2e-12)
        assert reduced_energy(problem, local) == pytest.approx(problem["energies"][index], abs=2e-12)
        assert all(full[i] == cue[i] for i in problem["trusted_indices"])
    # The surviving couplings preserve 1/16, never 1/free_count.
    np.testing.assert_allclose(problem["weights"], hebbian_weights(memories))


def test_soft_noisy_cue_fields_and_no_clamping():
    problem = build_problem(config(mode="noisy", cue=[1, -1, None, 1],
                                   reliabilities=[1, 0, 3, 0.5], biases=[0.1, -0.2, 0.3, 0]))
    assert problem["trusted_indices"] == []
    assert problem["free_indices"] == [0, 1, 2, 3]
    np.testing.assert_allclose(problem["biases"], [0.5, -0.2, 0.3, 0.2])
    assert problem["constant"] == 0
    for index, full in enumerate(problem["states"]):
        assert energy(problem["weights"], full, problem["biases"]) == pytest.approx(problem["energies"][index])
    # Every spin remains free, including observed and zero-reliability cues.
    assert {state[0] for state in problem["states"]} == {-1, 1}


def test_schema_optional_nulls_and_singular_reliability():
    problem = build_problem(config(mode="noisy", cue=[1, -1, None, 1],
                                   biases=None, reliability=[1, 0, 1, 0.5],
                                   observed_mask=None, trusted_mask=None))
    np.testing.assert_allclose(problem["biases"], [0.4, 0, 0, 0.2])


def test_masks_override_presence_without_clamping_untrusted_pixels():
    c = config(cue=[1, -1, 1, -1], observed_mask=[True, False, True, True],
               trusted_mask=[True, False, False, True])
    problem = build_problem(c)
    assert problem["observed_indices"] == [0, 2, 3]
    assert problem["trusted_indices"] == [0, 3]
    assert problem["free_indices"] == [1, 2]
    assert problem["cue"] == [1, None, 1, -1]
    assert {state[2] for state in problem["states"]} == {-1, 1}
    for a, global_index in enumerate(problem["free_indices"]):
        assert problem["fields"][a] == pytest.approx(sum(t["value"] for t in problem["field_contributions"][a]) + problem["biases"][global_index])


@pytest.mark.parametrize("order", ["sequential", "random"])
def test_hopfield_events_exact_delta_and_monotone_energy(order):
    rng = np.random.default_rng(918)
    for _ in range(20):
        c = config(rows=2, cols=4, memories=rng.choice([-1, 1], size=(3, 8)).tolist(),
                   mode="noisy", cue=rng.choice([-1, 1], size=8).tolist(), update_order=order,
                   initial_state=rng.choice([-1, 1], size=8).tolist(), cue_strength=0.1)
        problem = build_problem(c)
        result = run_hopfield(problem, c)
        assert result["converged"]
        assert all(after <= before + 1e-12 for before, after in zip(result["energy_path"], result["energy_path"][1:]))
        for event in result["trace"]:
            delta = -(event["spin_after"] - event["spin_before"]) * event["local_field"]
            assert event["delta_energy"] == pytest.approx(delta, abs=2e-12)
            assert event["local_field"] == pytest.approx(sum(term["value"] for term in event["contributions"]) + event["bias"])
            assert sum(a != b for a, b in zip(event["state_before"], event["state_after"])) <= 1
        output = result["output"]
        for neuron in problem["free_indices"]:
            field = np.asarray(problem["weights"])[neuron] @ output + problem["biases"][neuron]
            assert output[neuron] * field >= -1e-12


def test_zero_field_retains_spin_and_clamps_are_preserved():
    c = config(rows=1, cols=2, memories=[[1, 1], [1, -1]], cue=[1, None], initial_state=[1, -1])
    result = run_hopfield(build_problem(c), c)
    assert result["output"] == [1, -1]
    assert result["trace"][0]["zero_field_tie"]
    assert result["trace"][0]["delta_energy"] == 0
    c = config()
    problem = build_problem(c)
    for result in [run_hopfield(problem, c), run_gibbs(problem, c)]:
        for event in result["trace"]:
            assert all(event["state_before"][i] == event["state_after"][i] == c["cue"][i] for i in problem["trusted_indices"])


def test_gibbs_conditionals_equal_exact_energy_ratios():
    problem = build_problem(config(mode="noisy", cue=[1, None, -1, 1]))
    tau = 0.39
    for index, state in enumerate(problem["free_states"]):
        for neuron in range(4):
            plus = list(state)
            minus = list(state)
            plus[neuron], minus[neuron] = 1, -1
            e_plus = reduced_energy(problem, plus)
            e_minus = reduced_energy(problem, minus)
            independent = np.exp(-e_plus / tau) / (np.exp(-e_plus / tau) + np.exp(-e_minus / tau))
            field = np.asarray(problem["weights"])[neuron] @ state + problem["fields"][neuron]
            assert conditional_probability(field, tau) == pytest.approx(independent, abs=2e-14)


def test_temperature_limits_and_stable_low_temperature():
    problem = build_problem(config(mode="noisy", cue=[1, 1, -1, -1], cue_strength=0.6))
    uniform = exact_gibbs(problem, 1e12)["probabilities"]
    np.testing.assert_allclose(uniform, np.full(16, 1 / 16), atol=1e-12)
    cold = exact_gibbs(problem, 1e-300)["probabilities"]
    assert sum(cold) == pytest.approx(1.0)
    assert np.isfinite(cold).all()
    assert sum(cold[i] for i in problem["ground_states"]) == pytest.approx(1.0)
    assert conditional_probability(1e3, 1e-6) == 1
    assert conditional_probability(-1e3, 1e-6) == 0
    assert conditional_probability(0, 1e-300) == 0.5


def test_seeded_trace_replay_and_actual_gibbs_draws():
    c = config(samples=128, burn_in=8, thinning=2, update_order="random")
    problem = build_problem(c)
    one = run_gibbs(problem, c)
    two = run_gibbs(build_problem(c), c)
    # Timings are measured per run; every scientific value and event is identical.
    assert one["resources"]["runtime_seconds"] > 0
    for result in (one, two):
        result["resources"].pop("runtime_seconds")
        result["resources"].pop("duration_ms")
    assert one == two
    assert sum(one["counts"].values()) == c["samples"]
    assert len(one["trace"]) == (c["burn_in"] + c["samples"] * c["thinning"]) * 2
    assert sum(event["sample_collected"] for event in one["trace"]) == c["samples"]
    for event in one["trace"]:
        assert event["spin_after"] == (1 if event["draw"] < event["p_plus"] else -1)
        assert event["p_plus"] == conditional_probability(event["local_field"], c["temperature"])
    assert one["output"] == full_state(problem, one["decision"]["state_integer"])
    assert one["probabilities"] != one["exact_probabilities"]
    # JSON serialization cannot hide numpy scalar/array objects.
    json.dumps({"problem": problem, "result": one}, allow_nan=False)


def test_gibbs_empirical_distribution_is_derived_from_samples():
    c = config(rows=1, cols=2, memories=[[1, 1]], cue=[None, None], samples=12000, burn_in=100, temperature=1.1)
    problem = build_problem(c)
    result = run_gibbs(problem, c)
    assert result["total_variation"] < 0.025
    frequencies = np.bincount(result["sampled_states"], minlength=4) / c["samples"]
    np.testing.assert_array_equal(frequencies, result["probabilities"])


def test_modal_decision_uses_counts_and_lowest_integer_tie():
    assert modal_decision({"7": 8, "2": 8, "0": 1}) == {
        "state_integer": 2, "count": 8, "tied_states": [2, 7], "tie_rule": "lowest_basis_integer"}
    assert modal_decision({"5": 9, "1": 3})["state_integer"] == 5


def test_empty_free_returns_observed_state_without_updates():
    c = config(cue=[1, 1, -1, -1])
    problem = build_problem(c)
    assert problem["free_states"] == [[]]
    assert problem["states"] == [c["cue"]]
    for result in [run_hopfield(problem, c), run_gibbs(problem, c)]:
        assert result["output"] == c["cue"]
        assert result["trace"] == []
        assert result["resources"]["updates"] == 0
        assert result["probabilities"] == [1.0]


@pytest.mark.parametrize("changes", [
    {"rows": 0}, {"rows": True}, {"cols": 5}, {"memories": []},
    {"memories": [[0, 1, 1, -1]]}, {"memories": [[True, 1, 1, -1]]}, {"cue": [1, 0, None, -1]},
    {"cue": [True, None, None, -1]}, {"mode": "mystery"},
    {"seed": -1}, {"cue_strength": -0.1}, {"cue_strength": float("inf")},
    {"reliabilities": [-1, 1, 1, 1]}, {"biases": [0, 0, float("nan"), 0]},
    {"initial_state": [-1, 1, 1, -1]}, {"target_index": 0},
    {"mode": "noisy", "trusted_mask": [True, False, False, False]},
    {"trusted_mask": [True, True, False, False]},
])
def test_malformed_problem_rejected(changes):
    with pytest.raises((ValueError, TypeError)):
        build_problem(config(**changes))


def test_free_variable_bound_and_solver_parameter_errors():
    with pytest.raises(ValueError, match="at most 8"):
        build_problem(config(rows=3, cols=3, memories=[[1] * 9], cue=[None] * 9))
    problem = build_problem(config())
    for changes in [{"temperature": 0}, {"temperature": -1}, {"samples": 0}, {"burn_in": -1},
                    {"thinning": 0}, {"update_order": "parallel"}, {"target": [1, 1, -1, -1]}]:
        with pytest.raises(ValueError):
            run_gibbs(problem, changes)
    for changes in [{"max_sweeps": 0}, {"update_order": "parallel"}, {"target_id": 0}]:
        with pytest.raises(ValueError):
            run_hopfield(problem, changes)
