"""Module 1 scientific core: codes, likelihood energies, decoders, explanations, seeds and messages."""
import math

import numpy as np
import pytest

from backend.qec import benchmarks as bench
from backend.qec.codes import RepetitionCode, bits_to_string, string_to_bits
from backend.qec.decoders import decision_table, decode, exact_reference
from backend.qec.experiment import run_trial
from backend.qec.likelihood import candidate_analysis, logical_class_summary
from backend.qec.message import run_message
from backend.qec.noise import bernoulli, streams
from backend.qec.statistics import auroc, mcnemar_exact, paired_difference, reliability_bins, wilson

CODE = RepetitionCode(3)


@pytest.mark.parametrize("error,syndrome", [("000", "00"), ("100", "10"), ("010", "11"), ("001", "01")])
def test_single_x_syndrome_table(error, syndrome):
    assert bits_to_string(CODE.syndrome(string_to_bits(error, 3))) == syndrome


def test_parity_checks_and_stabilizer_convention():
    assert CODE.parity_check.tolist() == [[1, 1, 0], [0, 1, 1]]
    assert CODE.stabilizer_values(string_to_bits("010", 3)).tolist() == [-1, -1]
    assert CODE.stabilizer_values(string_to_bits("000", 3)).tolist() == [1, 1]
    assert [s["pauli"] for s in CODE.stabilizers] == ["Z0 Z1", "Z1 Z2"]
    assert CODE.lookup_table() == {"00": "000", "01": "001", "10": "100", "11": "010"}


@pytest.mark.parametrize("distance", [3, 5, 7, 9])
def test_repetition_codes_of_larger_distance(distance):
    code = RepetitionCode(distance)
    assert code.parity_check.shape == (distance - 1, distance)
    # every single error has a distinct non-zero syndrome
    singles = {bits_to_string(code.syndrome(np.eye(distance, dtype=np.uint8)[i])) for i in range(distance)}
    assert len(singles) == distance and "0" * (distance - 1) not in singles


@pytest.mark.parametrize("distance", [2, 4, 11])
def test_invalid_distance_rejected(distance):
    with pytest.raises(ValueError):
        RepetitionCode(distance)


@pytest.mark.parametrize("residual,outcome", [("000", "restored"), ("100", "recoverable_residual"), ("001", "recoverable_residual"),
                                              ("110", "logical_flip"), ("111", "logical_flip")])
def test_recovery_convention_is_not_an_even_odd_rule(residual, outcome):
    assert CODE.classify_residual(string_to_bits(residual, 3)) == outcome
    # a parity rule would call 100 a logical error and 110 harmless; the declared convention does not
    assert CODE.logical_flip(string_to_bits("100", 3)) == 0
    assert CODE.logical_flip(string_to_bits("110", 3)) == 1


def test_energy_hand_calculation():
    p, q = 0.1, 0.05
    a = candidate_analysis(CODE, [1, 0], [p] * 3, [q] * 2)
    rows = {r["candidate"]: r for r in a["candidates"]}
    assert rows["100"]["energy"] == pytest.approx(-math.log(p) - 2 * math.log(1 - p) - 2 * math.log(1 - q))
    assert rows["000"]["energy"] == pytest.approx(-3 * math.log(1 - p) - math.log(q) - math.log(1 - q))
    assert rows["100"]["readout_flips"] == "00" and rows["000"]["readout_flips"] == "10"
    assert a["best"] == "100" and a["second"] == "000"
    assert a["energy_gap"] == pytest.approx(rows["000"]["energy"] - rows["100"]["energy"])
    assert sum(r["posterior"] for r in a["candidates"]) == pytest.approx(1.0)
    assert [r["rank"] for r in a["candidates"]] == list(range(1, 9))


def test_energies_equal_negative_log_joint_of_independent_reference():
    rng = np.random.default_rng(4)
    for _ in range(30):
        p, q = rng.uniform(0.01, 0.4, 3), rng.uniform(0.0, 0.4, 2)
        y = rng.integers(0, 2, 2)
        a = candidate_analysis(CODE, y, p, q)
        ref = exact_reference(CODE, y, p, q)
        for r in a["candidates"]:
            joint = ref["joint_probability"][r["candidate"]]
            if joint > 0:
                assert r["energy"] == pytest.approx(-math.log(joint), abs=1e-9)
            else:
                assert r["energy"] is None and not r["possible"]


def test_deterministic_tie_breaking_prefers_lower_weight():
    a = candidate_analysis(CODE, [1, 0], [0.1] * 3, [0.1] * 2)
    first, second = a["candidates"][0], a["candidates"][1]
    assert first["energy"] == pytest.approx(second["energy"])
    assert (first["candidate"], second["candidate"]) == ("000", "100")
    assert a["energy_gap"] == pytest.approx(0.0, abs=1e-12)


def test_zero_readout_probability_makes_readout_explanations_impossible():
    a = candidate_analysis(CODE, [1, 1], [0.05] * 3, [0.0] * 2)
    possible = [r["candidate"] for r in a["candidates"] if r["possible"]]
    assert sorted(possible) == ["010", "101"]
    assert a["best"] == "010"


def test_invalid_probabilities_rejected():
    with pytest.raises(ValueError):
        candidate_analysis(CODE, [0, 0], [0.6] * 3, [0.0] * 2)
    with pytest.raises(ValueError):
        candidate_analysis(CODE, [0, 0, 1], [0.1] * 3, [0.0] * 2)


def test_exact_reference_uses_logical_classes_not_single_patterns():
    # With readout noise, leaving the data alone keeps the logical value more often than correcting X0.
    ref = exact_reference(CODE, [1, 0], [0.1] * 3, [0.05] * 2)
    energy = decode(CODE, "energy", [1, 0], [0.1] * 3, [0.05] * 2)["correction"]
    assert energy == "100" and ref["correction"] == "000"
    a = candidate_analysis(CODE, [1, 0], [0.1] * 3, [0.05] * 2)
    keep_map = logical_class_summary(CODE, a["_energy"], a["_posterior"], string_to_bits("100", 3))["p_logical_preserved"]
    keep_ref = logical_class_summary(CODE, a["_energy"], a["_posterior"], string_to_bits("000", 3))["p_logical_preserved"]
    assert keep_ref > keep_map
    assert ref["p_logical_preserved"] == pytest.approx(keep_ref)


def test_known_single_x_recovery_for_every_decoder_without_noise():
    for err, syn in (("100", "10"), ("010", "11"), ("001", "01")):
        for decoder in ("lookup", "energy", "exact"):
            corr = decode(CODE, decoder, string_to_bits(syn, 2), [0.01] * 3, [0.0] * 2)["correction"]
            assert corr == err, (decoder, err)


def test_vectorized_tables_match_reference_and_candidate_analysis():
    result = bench.agreement(seed=11)
    assert result["all_tables_match_reference"]
    assert result["max_abs_energy_minus_neg_log_joint"] < 1e-9
    tab = decision_table(CODE, "energy", [0.2, 0.05, 0.05], [0.1, 0.02])
    for k in range(4):
        y = [(k >> 1) & 1, k & 1]
        assert bits_to_string(tab[k]) == candidate_analysis(CODE, y, [0.2, 0.05, 0.05], [0.1, 0.02])["best"]


def test_seeded_streams_are_reproducible_and_independent():
    a, b = streams(99), streams(99)
    fa, fb = bernoulli(a["data"], [0.3] * 3, 500), bernoulli(b["data"], [0.3] * 3, 500)
    assert np.array_equal(fa, fb)
    # changing the readout probability does not change which data qubits flip for the same seed
    s1, s2 = streams(5), streams(5)
    bernoulli(s1["readout"], [0.0, 0.0], 100)
    bernoulli(s2["readout"], [0.4, 0.4], 100)
    assert np.array_equal(bernoulli(s1["data"], [0.2] * 3, 100), bernoulli(s2["data"], [0.2] * 3, 100))


def test_simulation_is_reproducible_and_noise_free_case_is_perfect():
    r1 = bench.simulate(CODE, 0.05, 0.02, 0.05, 0.02, 5000, 123)
    r2 = bench.simulate(CODE, 0.05, 0.02, 0.05, 0.02, 5000, 123)
    assert r1["digest"] == r2["digest"] and r1["energy"]["count"] == r2["energy"]["count"]
    clean = bench.simulate(CODE, 0.0, 0.0, 0.01, 0.0, 2000, 1)
    assert all(clean[d]["count"] == 0 for d in ("lookup", "energy", "exact"))


def test_noise_aware_decoders_help_under_readout_noise():
    r = bench.simulate(CODE, 0.05, 0.1, 0.05, 0.1, 100000, 7)
    assert r["exact"]["rate"] <= r["energy"]["rate"] < r["lookup"]["rate"]


def test_margin_study_uses_separate_validation_and_held_out_seeds():
    m = bench.margin_study(4000, 77)
    assert m["validation_seed"] != m["held_out_seed"]
    assert 0.5 < m["auroc_gap_held_out"] <= 1.0
    assert m["held_out_flagged"]["rate"] > m["held_out_unflagged"]["rate"]


def test_lab_trial_x1_injection_end_to_end():
    r = run_trial({"state": "plus", "injected": [{"qubit": 1, "pauli": "X"}], "p": 0.0, "q": 0.0, "seed": 1, "decoder": "energy"})
    assert r["syndrome"]["observed"] == "11"
    assert r["analysis"]["best"] == "010"
    v = r["verification"]
    assert v["outcome"] == "restored" and v["logical_operator"] == "I"
    assert v["circuit_check"]["logical_fidelity"] == pytest.approx(1.0)
    assert len(r["explanation"]["answers"]) == 7


def test_lab_trial_reports_uncorrectable_phase_error_honestly():
    r = run_trial({"state": "plus", "injected": [{"qubit": 0, "pauli": "Z"}], "p": 0.0, "q": 0.0, "seed": 1})
    assert r["syndrome"]["observed"] == "00"
    assert r["verification"]["logical_operator"] == "Z̄"
    assert not r["verification"]["logical_preserved"]
    assert r["verification"]["circuit_check"]["logical_fidelity"] == pytest.approx(0.0, abs=1e-9)


def test_lab_trial_two_errors_is_a_logical_failure():
    r = run_trial({"state": "zero", "injected": [{"qubit": 0, "pauli": "X"}, {"qubit": 1, "pauli": "X"}], "p": 0, "q": 0})
    assert r["verification"]["outcome"] == "logical_flip"
    assert r["verification"]["logical_operator"] == "X̄"


def test_message_round_trip_and_unforced_failures():
    clean = run_message({"message": "Qubits 😀", "p": 0.0, "q": 0.0, "seed": 3})
    assert clean["text"]["protected"] == "Qubits 😀" and clean["text"]["protected_exact"]
    assert clean["stats"]["bits"] == 8 * len("Qubits 😀".encode())
    noisy = run_message({"message": "HELLO WORLD", "p": 0.35, "q": 0.1, "seed": 3})
    assert noisy["stats"]["logical_failures"] > 0  # protection is never forced to succeed
    again = run_message({"message": "HELLO WORLD", "p": 0.35, "q": 0.1, "seed": 3})
    assert again["trace"] == noisy["trace"]
    # paired comparison: unprotected bit flips exactly when qubit d0 of its block flips
    flips0 = np.array([int(f[0]) for f in noisy["trace"]["flips"]])
    assert np.array_equal(np.array(noisy["trace"]["unprotected"]) ^ np.array(noisy["bits"]), flips0)


def test_message_limits():
    with pytest.raises(ValueError):
        run_message({"message": "x" * 65})
    with pytest.raises(ValueError):
        run_message({"message": ""})


def test_statistics_helpers():
    low, high = wilson(0, 100)
    assert low == 0 and 0.03 < high < 0.04
    low, high = wilson(50, 100)
    assert low == pytest.approx(0.4038, abs=1e-3) and high == pytest.approx(0.5962, abs=1e-3)
    a = np.array([1, 1, 0, 0, 1, 0], dtype=bool)
    b = np.array([1, 0, 0, 0, 0, 0], dtype=bool)
    t = mcnemar_exact(a, b)
    assert (t["only_a_wrong"], t["only_b_wrong"], t["both_wrong"]) == (2, 0, 1)
    assert paired_difference(a, b)["difference"] == pytest.approx(2 / 6)
    assert auroc(np.array([0.1, 0.2, 0.9, 0.8]), np.array([0, 0, 1, 1], dtype=bool)) == 1.0
    assert auroc(np.array([1.0, 2.0]), np.array([1, 1], dtype=bool)) is None
    bins = reliability_bins(np.array([0.95] * 100), np.array([True] * 95 + [False] * 5))
    assert bins[0]["count"] == 100 and bins[0]["observed"] == pytest.approx(0.95)
