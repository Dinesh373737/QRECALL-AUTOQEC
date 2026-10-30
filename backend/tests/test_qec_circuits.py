"""Qiskit circuits, stepping, transpilation metrics and the resource-aware optimizer."""
import math

import numpy as np
import pytest
from qiskit.quantum_info import Operator
from qiskit_aer import AerSimulator

from backend.qec import optimizer as opt
from backend.qec.circuits import build_lab_circuit, circuit_metrics, describe_operations, step_through, transpile_for_target


@pytest.mark.parametrize("x_errors,syndrome", [("000", (0, 0)), ("100", (1, 0)), ("010", (1, 1)), ("001", (0, 1))])
def test_measured_syndrome_matches_table_and_state_recovers(x_errors, syndrome):
    c = build_lab_circuit(1.0, 0.3, x_errors=x_errors)
    final = step_through(c, seed=2)[-1]
    assert (final["classical"]["syn[0]"], final["classical"]["syn[1]"]) == syndrome
    assert final["classical"]["ver[0]"] == 0
    assert final["probability_one"] == pytest.approx(0.0, abs=1e-12)


def test_double_error_is_a_logical_error_in_the_circuit():
    c = build_lab_circuit(math.pi, 0.0, x_errors="110")  # |1_L>, decoder corrects to the wrong codeword
    final = step_through(c, seed=2)[-1]
    assert final["classical"]["ver[0]"] == 1 and final["probability_one"] == pytest.approx(1.0)


def test_encoding_produces_the_codeword_superposition():
    c = build_lab_circuit(math.pi / 2, 0.0)
    steps = step_through(c)
    after_encode = [s for s in steps if s["stage"] == "encode"][-1]
    probs = {a["basis"]: a["prob"] for a in after_encode["state"]}
    assert probs == pytest.approx({"00000": 0.5, "11100": 0.5})


def test_readout_flip_is_recoverable_under_the_convention():
    c = build_lab_circuit(0.0, 0.0, x_errors="000", readout_flips="10")
    final = step_through(c)[-1]
    assert final["classical"]["syn[0]"] == 1  # the decoder sees a corrupted syndrome
    assert final["classical"]["ver[0]"] == 0  # the coherent majority verifier still recovers the logical bit


def test_pauli_frame_mode_applies_no_correction_gates():
    c = build_lab_circuit(0.0, 0.0, x_errors="010", mode="pauli_frame")
    ops = describe_operations(c)
    assert not any(o["name"] == "if_else" for o in ops)
    final = step_through(c)[-1]
    out = [final["classical"][f"out[{k}]"] for k in range(3)]
    assert out == [0, 1, 0]  # the raw readout still carries the error; the frame fixes it in software


def test_metrics_count_gates_inside_control_flow():
    c = build_lab_circuit(1.0, 0.0, x_errors="100")
    m = circuit_metrics(c.qc)
    assert (m["data_qubits"], m["ancilla_qubits"], m["total_qubits"]) == (3, 2, 5)
    assert m["two_qubit_gates"] == 8 and m["multi_qubit_gates"] == 1  # 2 encode + 4 extract + 2 verify; Toffoli
    assert m["conditional_blocks"] == 3 and m["measurements"] == 3
    assert m["by_name"]["x"] == 1 + 3  # injected error + one X inside each conditional block


def test_step_simulator_agrees_with_aer():
    c = build_lab_circuit(0.8, 0.4, x_errors="001")
    final = step_through(c, seed=0)[-1]
    counts = AerSimulator().run(c.qc, shots=200, seed_simulator=5).result().get_counts()
    assert counts == {f"0 {final['classical']['syn[1]']}{final['classical']['syn[0]']}": 200}


def test_transpiled_circuit_respects_target_and_reports_metrics():
    c = build_lab_circuit(1.0, 0.0, x_errors="010")
    t = transpile_for_target(c.qc, optimization_level=1, seed=11, coupling="line")
    names = set(t["metrics"]["by_name"])
    assert names - {"measure"} <= {"rz", "sx", "x", "cx"}
    assert t["metrics"]["two_qubit_gates"] >= 8 and t["metrics"]["multi_qubit_gates"] == 0
    assert t["compile_seconds"] >= 0 and set(t["layout"]) == {"d0", "d1", "d2", "a0", "a1"}


def test_measurement_free_core_is_unitarily_equivalent_after_transpilation():
    from qiskit import QuantumCircuit, transpile
    from qiskit.transpiler import CouplingMap
    core = QuantumCircuit(5)
    core.cx(0, 1); core.cx(0, 2); core.cx(0, 3); core.cx(1, 3); core.cx(1, 4); core.cx(2, 4)
    t = transpile(core, basis_gates=["rz", "sx", "x", "cx"], coupling_map=CouplingMap.from_line(5), optimization_level=2, seed_transpiler=3)
    assert Operator.from_circuit(t).equiv(Operator(core))


def test_optimizer_family_functional_checks_pass_and_detect_syndromes():
    for family in opt.FAMILIES:
        res = opt.functional_checks(family, {**{k: v for k, v in opt.BASELINE.items() if k != "family"}}, "line")
        assert res["passed"], (family, res["checks"])


def _fake_eval():
    rows = []
    for i, (q, g2, d, pl) in enumerate([(5, 10, 8, 0.02), (4, 7, 12, 0.03), (6, 27, 24, 0.06), (5, 12, 10, 0.015)]):
        rows.append({"id": f"c{i}", "family": "two_ancilla_sequential", "family_text": "", "settings": [{}], "equivalent_settings": 1,
                     "compile_ms": 1.0, "Q": q, "G2": g2, "G1": 3, "D": d, "measurements": 5, "resets": 0, "active_physical_qubits": [],
                     "ops": {}, "duration_ns": 1000.0 * d, "pL": pl, "pL_ci95": [pl * 0.8, pl * 1.2], "failures": 1, "trials": 100,
                     "spacetime_proxy": q * d, "verification": {"passed": True, "checks": []}, "is_baseline": i == 2})
    return {"candidates": rows}


def test_rank_applies_hard_constraints_then_normalized_cost():
    ev = _fake_eval()
    r = opt.rank(ev, {"Q": 1, "G2": 1, "D": 1}, {"pL": 0.025}, conservative=False)
    assert r["references"] == {"Q": 6, "G2": 27, "D": 24}
    feasible = {c["id"] for c in r["candidates"] if c["feasible"]}
    assert feasible == {"c0", "c3"}
    expected = {cid: 1 * q / 6 + 1 * g / 27 + 1 * d / 24 for cid, q, g, d in (("c0", 5, 10, 8), ("c3", 5, 12, 10))}
    assert r["selected"]["id"] == min(expected, key=expected.get)
    assert r["selected"]["J"] == pytest.approx(expected[r["selected"]["id"]])
    assert r["comparison"]["Q"]["change_percent"] == pytest.approx(100 * (5 - 6) / 6)


def test_rank_conservative_upper_bound_and_no_feasible_state():
    ev = _fake_eval()
    loose = opt.rank(ev, {"Q": 1}, {"pL": 0.02}, conservative=False)
    strict = opt.rank(ev, {"Q": 1}, {"pL": 0.02}, conservative=True)
    assert loose["feasible_count"] > strict["feasible_count"]
    none = opt.rank(ev, {"Q": 1}, {"Q": 3}, conservative=False)
    assert none["status"] == "no_feasible_candidate" and none["selected"] is None
    assert "No feasible candidate" in none["message"]


def test_pareto_flags_non_dominated_candidates():
    r = opt.rank(_fake_eval(), {"Q": 1, "G2": 1, "D": 1}, {}, conservative=False)
    pareto = {c["id"] for c in r["candidates"] if c["pareto"]}
    assert "c2" not in pareto  # dominated on every axis
    assert {"c1", "c3"} <= pareto


def test_weight_sensitivity_predicts_the_switch_point():
    weights = {"Q": 1, "G2": 1, "D": 1}
    r = opt.rank(_fake_eval(), weights, {}, conservative=False)
    raise_d = next(s for s in r["weight_sensitivity"] if s["weight"] == "D" and s["direction"] == "raise")
    other = raise_d["switches_to"]["id"]
    assert other != r["selected"]["id"]
    below = opt.rank(_fake_eval(), {**weights, "D": raise_d["threshold"] - 1e-6}, {}, conservative=False)
    above = opt.rank(_fake_eval(), {**weights, "D": raise_d["threshold"] + 1e-6}, {}, conservative=False)
    assert below["selected"]["id"] == r["selected"]["id"]
    assert above["selected"]["id"] == other
    # The selected candidate already has the fewest qubits, so no weight on Q can push the choice away from it.
    assert not any(s["weight"] == "Q" and s["direction"] == "raise" for s in r["weight_sensitivity"])


def test_failed_verification_is_never_feasible():
    ev = _fake_eval()
    ev["candidates"][0]["verification"] = {"passed": False, "checks": []}
    r = opt.rank(ev, {"Q": 1}, {}, conservative=False)
    row = next(c for c in r["candidates"] if c["id"] == "c0")
    assert not row["feasible"] and "failed functional verification" in row["violations"]


def test_idle_markers_and_duration_estimate():
    tq, _ = opt.compile_candidate("one_ancilla_reuse", 0, {k: v for k, v in opt.BASELINE.items() if k != "family"}, "line")
    marked = opt.with_idle_markers(tq)
    assert sum(1 for i in marked.data if i.operation.name == "id") > 0
    m = opt.metrics(tq)
    assert m["duration_ns"] > 0 and m["resets"] == 1 and m["Q"] == 4


def test_decode_counts_lookup_and_majority():
    # out bits are written right-to-left: "out syn"; out = 010 with syndrome 11 -> frame 010 -> logical 0
    fails, total, syn = opt.decode_counts({"010 11": 7, "000 00": 3}, 0)
    assert (fails, total) == (0, 10) and syn == {"11": 7, "00": 3}
    fails, _, _ = opt.decode_counts({"011 00": 4}, 0)
    assert fails == 4  # two data flips with a clean syndrome: majority says 1
