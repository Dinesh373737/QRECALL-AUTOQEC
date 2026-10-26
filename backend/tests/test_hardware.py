"""Module 2: Google dataset parsing, PyMatching baseline, Ising/QUBO correctness, statistics and advisor.

Tests that need the real data use whichever layout is installed (full archive or the deployable subset)
and are skipped, with a reason, only when neither is present.
"""
import inspect
import itertools
import math

import numpy as np
import pytest
import stim

from backend.hardware import advisor
from backend.hardware import dataset as ds
from backend.hardware import ising as isg
from backend.hardware import matching as mt
from backend.hardware.benchmarks import fit_logical_error_per_round, score
from backend.hardware.dem import DemGraph

EXP = "surface_code_bZ_d3_r05_center_3_5"


def _catalog():
    try:
        return ds.catalog()
    except FileNotFoundError:
        pytest.skip("Google data not installed (run python -m backend.hardware.pipeline fetch/subset)")


def test_experiment_id_and_properties_parsing():
    info = ds.parse_experiment_id("surface_code_bX_d5_r13_center_5_5")
    assert info == {"id": "surface_code_bX_d5_r13_center_5_5", "code": "surface_code", "basis": "X", "distance": 5,
                    "rounds": 13, "center": [5, 5]}
    props = ds.parse_properties("type: surface_code_memory_experiment\nshots: 50000\nbasis: Z\n")
    assert props == {"type": "surface_code_memory_experiment", "shots": 50000, "basis": "Z"}
    with pytest.raises(ValueError):
        ds.parse_experiment_id("not_an_experiment")


def test_bit_packing_round_trip():
    rng = np.random.default_rng(0)
    bits = rng.random(1001) < 0.3
    assert np.array_equal(ds.unpack_shots(ds.pack_shots(bits), bits.size), bits)


def test_b8_parser_matches_stim_and_dimensions():
    exp = _catalog().get(EXP)
    ours = exp.detection_events(500)
    theirs = stim.read_shot_data_file(path=str(exp.path("detection_events.b8")), format="b8", num_detectors=exp.detectors)[:500]
    assert np.array_equal(ours, theirs)
    assert ours.shape == (500, exp.detectors) == (500, 40)
    circuit = stim.Circuit(exp.circuit_text())
    assert circuit.num_detectors == exp.detectors and circuit.num_observables == 1
    packed = exp.detection_events(500, packed=True)
    assert packed.dtype == np.uint8 and packed.shape == (500, 5)
    assert np.array_equal(exp.detection_events(3, start=10), ours[10:13])


def test_shot_alignment_across_observables_and_google_predictions():
    exp = _catalog().get(EXP)
    actual = exp.observable_flips()
    preds = exp.google_predictions()
    assert actual.size == exp.shots == 50000
    assert set(preds) == {"pymatching", "correlated_matching", "belief_matching", "tensor_network_contraction"}
    assert all(v.size == exp.shots for v in preds.values())
    assert 0.2 < actual.mean() < 0.5  # raw observable flips are frequent; decoders must predict them


def test_pymatching_reproduces_google_predictions_on_real_shots():
    exp = _catalog().get(EXP)
    n = min(exp.available_detection_shots, 5000)
    dets = exp.detection_events(n, packed=True)
    ours = mt.partitioned_predictions(exp, "pymatching_circuit", dets)["predictions"]
    google = exp.google_predictions()["pymatching"][:n]
    assert np.array_equal(ours, google)


def test_partitioned_models_never_decode_their_own_calibration_parity():
    assert mt.dem_kind_for_shot("pymatching_pij", 0) == "pij_odd_for_even"
    assert mt.dem_kind_for_shot("pymatching_pij", 7) == "pij_even_for_odd"
    assert mt.dem_kind_for_shot("pymatching_circuit", 7) == "circuit"
    exp = _catalog().get(EXP)
    dets = exp.detection_events(200)
    combined = mt.partitioned_predictions(exp, "pymatching_pij", dets)["predictions"]
    odd_only = mt.decode_batch(exp.dem_text("pij_even_for_odd"), dets[1::2])["predictions"]
    even_only = mt.decode_batch(exp.dem_text("pij_odd_for_even"), dets[0::2])["predictions"]
    assert np.array_equal(combined[1::2], odd_only) and np.array_equal(combined[0::2], even_only)


def test_decoders_never_receive_observable_flips():
    for fn in (mt.decode_batch, mt.partitioned_predictions, mt.explain_shot, isg.solve, isg.decode_with_gap):
        params = set(inspect.signature(fn).parameters)
        assert not params & {"actual", "observable_flips", "obs", "truth"}, fn.__name__


def test_dem_hyperedges_are_xor_of_suggested_decomposition_and_duplicates_merge():
    g = DemGraph.from_text("error(0.1) D0 D1 ^ D1 D2\nerror(0.2) D3 L0\nerror(0.3) D3 L0\nerror(0.05) D0 D1 D2 ^ D2")
    by = {(m.detectors, m.observables): m for m in g.mechanisms}
    assert (0, 2) in [k[0] for k in by]  # D0 D1 ^ D1 D2 -> D0 D2
    assert by[((3,), (0,))].probability == pytest.approx(0.2 * 0.7 + 0.3 * 0.8)
    assert by[((3,), (0,))].merged_lines == 2
    assert g.check_matrix.shape == (4, len(g.mechanisms))


def _random_dem(rng, nd=5, nm=10):
    lines = [f"error({rng.uniform(0.01, 0.2):.4f}) " + " ".join(f"D{d}" for d in rng.choice(nd, rng.integers(1, 4), replace=False))
             + (" L0" if rng.random() < 0.35 else "") for _ in range(nm)]
    lines.append("error(0.02) D0 L0")
    return "\n".join(lines)


@pytest.mark.parametrize("weighting", ["noise_aware", "uniform"])
def test_ising_milp_matches_brute_force_on_tiny_problems(weighting):
    rng = np.random.default_rng(11 if weighting == "uniform" else 12)
    for _ in range(25):
        g = DemGraph.from_text(_random_dem(rng))
        prob = isg.IsingProblem(g, weighting)
        x = (rng.random(len(g.mechanisms)) < 0.3).astype(np.uint8)
        syn = g.symptoms(x)
        bf = isg.brute_force(prob, syn)
        sol = isg.solve(prob, syn)
        assert sol.status == "optimal"
        assert sol.objective == pytest.approx(bf["objective"], abs=1e-9)
        assert prob.is_consistent(sol.x, syn)
        gap = isg.decode_with_gap(prob, syn)
        if len(bf["class_minima"]) == 2:
            assert gap["gap"] == pytest.approx(abs(bf["class_minima"][0] - bf["class_minima"][1]), abs=1e-9)


def test_noise_aware_weights_are_negative_log_odds_and_energy_is_nll():
    g = DemGraph.from_text("error(0.1) D0\nerror(0.01) D0 D1\nerror(0.2) D1 L0")
    prob = isg.IsingProblem(g, "noise_aware")
    p = g.probabilities
    np.testing.assert_allclose(prob.weights, np.log((1 - p) / p))
    for bits in itertools.product((0, 1), repeat=3):
        x = np.array(bits)
        nll = -sum(math.log(pi) if b else math.log(1 - pi) for b, pi in zip(bits, p))
        assert prob.constant + prob.energy(x) == pytest.approx(nll)


def test_qubo_minimum_equals_constrained_minimum():
    g = DemGraph.from_text("error(0.1) D0 D1\nerror(0.05) D1 D2 L0\nerror(0.2) D0\nerror(0.08) D2\nerror(0.03) D0 D1 D2")
    prob = isg.IsingProblem(g, "noise_aware")
    for syn in itertools.product((0, 1), repeat=3):
        model = isg.qubo(prob, np.array(syn))
        n = model["Q"].shape[0]
        best = min(isg.qubo_energy(model, np.array(z)) for z in itertools.product((0, 1), repeat=n))
        assert best == pytest.approx(isg.brute_force(prob, np.array(syn))["objective"], abs=1e-9)


def test_uniform_weighting_minimizes_mechanism_count():
    g = DemGraph.from_text("error(0.4) D0 D1\nerror(0.001) D0\nerror(0.001) D1")
    na = isg.solve(isg.IsingProblem(g, "noise_aware"), np.array([1, 1]))
    un = isg.solve(isg.IsingProblem(g, "uniform"), np.array([1, 1]))
    chosen = lambda sol: [g.mechanisms[i].detectors for i in np.flatnonzero(sol.x)]
    assert chosen(un) == [(0, 1)]  # one mechanism explains both detectors
    assert chosen(na) == [(0, 1)]  # and it is also the likely one (0.4 >> 0.001^2)


def test_solver_timeouts_and_failures_are_never_reported_as_optimal(monkeypatch):
    g = DemGraph.from_text("error(0.1) D0 L0\nerror(0.2) D0")
    prob = isg.IsingProblem(g, "noise_aware")

    class Res:
        def __init__(self, x, status):
            self.x, self.status, self.mip_gap = x, status, 0.5

    monkeypatch.setattr(isg, "milp", lambda *a, **k: Res(None, 1))
    assert isg.solve(prob, np.array([1])).status == "failed"
    monkeypatch.setattr(isg, "milp", lambda *a, **k: Res(np.array([0.0, 1.0, 0.0]), 1))
    s = isg.solve(prob, np.array([1]))
    assert s.status == "time_limit" and s.usable
    monkeypatch.setattr(isg, "milp", lambda *a, **k: Res(np.array([0.0, 0.0, 0.0]), 1))
    assert isg.solve(prob, np.array([1])).status == "failed"  # inconsistent incumbent is rejected


def test_real_shot_ising_decoding_is_parity_consistent():
    exp = _catalog().get(EXP)
    g = DemGraph.from_text(exp.dem_text("pij_even_for_odd"))
    prob = isg.IsingProblem(g, "noise_aware")
    actual = exp.observable_flips()
    dets = exp.detection_events(40)
    correct = 0
    for shot in range(1, 40, 2):
        sol = isg.solve(prob, dets[shot].astype(np.uint8), time_limit=20)
        assert sol.status == "optimal" and prob.is_consistent(sol.x, dets[shot])
        correct += sol.prediction == actual[shot]
    assert correct >= 14  # sanity: far better than the ~50% raw flip baseline on these 20 odd shots


def test_score_counts_unsolved_shots_as_wrong():
    actual = np.array([1, 0, 1, 0], dtype=bool)
    pred = np.array([1, 0, 1, 0], dtype=bool)
    valid = np.array([True, True, False, True])
    s = score(pred, actual, valid)
    assert s["count"] == 1 and s["trials"] == 4


def test_per_round_fit_recovers_known_epsilon():
    eps, amp, n = 0.03, 0.95, 200000
    pts = [{"rounds": r, "rate": (1 - amp * (1 - 2 * eps) ** r) / 2, "trials": n} for r in range(1, 26, 2)]
    fit = fit_logical_error_per_round(pts)
    assert fit["epsilon"] == pytest.approx(eps, rel=1e-6)
    assert fit["ci95"][0] < eps < fit["ci95"][1]


def _results_or_skip():
    try:
        advisor.load_results()
    except FileNotFoundError:
        pytest.skip("recorded baseline results missing")


def test_advisor_never_extrapolates_and_reports_no_match():
    _results_or_skip()
    r = advisor.recommend({"rounds": 2, "target_kind": "per_shot"})
    assert r["status"] == "no_match" and r["message"] == "No tested configuration meets these constraints."
    r = advisor.recommend({"rounds": 25, "target": 0.01, "target_kind": "per_shot"})
    assert r["status"] == "no_match" and r["message"] == advisor.NO_MATCH


def test_advisor_respects_budgets_and_uses_tested_configurations():
    _results_or_skip()
    r = advisor.recommend({"rounds": 5, "max_qubits": 17, "target_kind": "per_shot"})
    assert r["status"] == "recommended" and r["recommendation"]["physical_qubits"] <= 17
    tested = {c["experiment"] for c in advisor.configurations()}
    assert r["recommendation"]["experiment"] in tested
    lat = advisor.recommend({"rounds": 5, "max_latency_us": 1000, "target_kind": "per_shot"})
    assert lat["recommendation"]["latency_us"] is not None and lat["recommendation"]["latency_us"] <= 1000
    per_round = advisor.recommend({"target_kind": "per_round", "target": 0.05})
    keys = [(c["distance"], c["basis"], c["center"], c["method"]) for c in per_round["candidates"]]
    assert len(keys) == len(set(keys))  # one fitted operating point per patch and decoder


def test_dataset_status_never_raises_and_reports_provenance():
    s = ds.dataset_status()
    assert s["doi"] == "10.5281/zenodo.6804040" and s["archive"]["md5"] == ds.ARCHIVE_MD5
    assert s["active_layout"] in ("full", "subset", None)


def test_published_logical_error_per_round_is_reproduced_from_raw_predictions():
    _results_or_skip()
    from backend.hardware.summary import baseline_summary
    rep = baseline_summary()["published_reproduction"]
    assert rep["distance_5"] == pytest.approx(0.02914, abs=0.00016)  # Nature 614, 676 (2023): 2.914% +- 0.016%
    assert rep["distance_3"] == pytest.approx(0.03028, abs=0.00023)  # 3.028% +- 0.023%
    assert rep["distance_5"] < rep["distance_3"]


def test_recorded_ising_benchmark_is_internally_consistent():
    import json
    path = ds.REPO_ROOT / "results" / "google" / "ising.json"
    if not path.exists():
        pytest.skip("Ising benchmark not recorded")
    data = json.loads(path.read_text())
    for e in data["experiments"]:
        n = e["shots_evaluated"]
        ps = e["per_shot"]
        assert len(ps["ising_noise_aware"]) == len(ps["na_status"]) == n
        m = e["methods"]
        assert all(v["trials"] == n for v in m.values())  # every method scored on the same shots
        for method, test in (e.get("paired_all") or {}).items():
            # paired discordant counts reproduce the difference in failure counts
            assert test["only_a_wrong"] - test["only_b_wrong"] == m["ising_noise_aware"]["count"] - m[method]["count"]
