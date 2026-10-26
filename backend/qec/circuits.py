"""Qiskit circuits for the three-qubit bit-flip code, with stage metadata and step-by-step evolution.

Registers: data ``d0 d1 d2`` and ancillas ``a0 a1``; classical ``syn`` (``syn[0] = s1`` for
``S1 = Z0 Z1``, ``syn[1] = s2`` for ``S2 = Z1 Z2``). Qiskit's integer value of ``syn`` is
``s1 + 2 s2``; this module converts it to the ``s1 s2`` strings used everywhere else.

Two correction styles implement the *same* decoder decision:

* ``physical``    -- classical feed-forward: ``if_test`` blocks apply X gates conditioned on the
  measured syndrome, then a coherent majority decoder (CX, CX, CCX) and the inverse state
  preparation verify the logical qubit; ``ver = 0`` means the logical state was recovered.
* ``pauli_frame`` -- no correction gates. The correction is recorded as a classical Pauli-frame
  update and applied in software to the final Z-basis data readout (memory-experiment style).
  This verifies only the Z-basis logical value.

Readout errors are modeled physically as an X on the ancilla immediately before its measurement
(equivalent to flipping the recorded classical bit of that final ancilla measurement).
"""
from __future__ import annotations

import math
from time import perf_counter

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister, transpile
from qiskit.circuit import IfElseOp
from qiskit.converters import circuit_to_dag
from qiskit.quantum_info import Statevector
from qiskit.transpiler import CouplingMap

STAGES = ("prepare", "encode", "inject", "extract", "measure", "correct", "verify")
STAGE_TEXT = {
    "prepare": "Prepare the physical qubit d0 in α|0⟩ + β|1⟩.",
    "encode": "Spread the logical value with two CNOTs: α|000⟩ + β|111⟩.",
    "inject": "Errors act on the data qubits (deliberate faults and seeded random flips).",
    "extract": "Ancillas accumulate the parities Z0Z1 and Z1Z2 without measuring the logical value.",
    "measure": "Measure the ancillas into the syndrome register (with modeled readout flips).",
    "correct": "Apply the decoder's correction: physical feed-forward or a classical Pauli-frame update.",
    "verify": "Check whether the logical information survived.",
}
PRESETS = {"zero": (0.0, 0.0), "one": (math.pi, 0.0), "plus": (math.pi / 2, 0.0),
           "minus": (math.pi / 2, math.pi), "plus_i": (math.pi / 2, math.pi / 2)}

TARGET_BASIS = ["rz", "sx", "x", "cx"]


def syndrome_int(syndrome: str) -> int:
    """'s1s2' string -> Qiskit integer value of the syn register (s1 + 2 s2)."""
    return int(syndrome[0]) + 2 * int(syndrome[1])


def amplitudes(theta: float, phi: float) -> tuple[complex, complex]:
    return complex(math.cos(theta / 2)), complex(math.cos(phi), math.sin(phi)) * math.sin(theta / 2)


class Annotated:
    """QuantumCircuit plus per-instruction stage/explanation metadata."""

    def __init__(self, qc: QuantumCircuit):
        self.qc = qc
        self.meta: list[dict] = []

    def add(self, stage: str, explanation: str, op_call, kind: str = "gate", **extra):
        before = len(self.qc.data)
        op_call()
        for _ in range(len(self.qc.data) - before):
            self.meta.append({"stage": stage, "explanation": explanation, "kind": kind, **extra})


def build_lab_circuit(theta: float = 0.0, phi: float = 0.0, x_errors: str = "000", z_errors: str = "000",
                      readout_flips: str = "00", correction_table: dict[str, str] | None = None,
                      mode: str = "physical", error_labels: list[str] | None = None) -> Annotated:
    """The exact circuit used by the QEC Lab for one trial."""
    if mode not in ("physical", "pauli_frame"):
        raise ValueError("Correction mode must be 'physical' or 'pauli_frame'.")
    d = QuantumRegister(3, "d")
    a = QuantumRegister(2, "a")
    syn = ClassicalRegister(2, "syn")
    regs = [d, a, syn]
    if mode == "physical":
        ver = ClassicalRegister(1, "ver")
        regs.append(ver)
    else:
        out = ClassicalRegister(3, "out")
        regs.append(out)
    qc = QuantumCircuit(*regs, name=f"bitflip_{mode}")
    c = Annotated(qc)
    if theta or phi:
        c.add("prepare", f"U(θ={theta:.3f}, φ={phi:.3f}) prepares α|0⟩ + β|1⟩ on d0.", lambda: qc.u(theta, phi, 0, d[0]))
    c.add("encode", "CNOT d0→d1 copies the computational-basis value (not the unknown state).",
          lambda: qc.cx(d[0], d[1]))
    c.add("encode", "CNOT d0→d2 completes α|000⟩ + β|111⟩.", lambda: qc.cx(d[0], d[2]))
    c.add("encode", "Stage boundary.", lambda: qc.barrier(), kind="barrier")
    labels = error_labels or ["error"] * 3
    for q in range(3):
        xe, ze = x_errors[q] == "1", z_errors[q] == "1"
        if xe and ze:
            c.add("inject", f"Y on d{q} ({labels[q]}): an X part the code detects plus a Z part it cannot.",
                  lambda q=q: qc.y(d[q]), kind="error", source=labels[q])
        elif xe:
            c.add("inject", f"X on d{q} ({labels[q]}): a bit flip.", lambda q=q: qc.x(d[q]), kind="error",
                  source=labels[q])
        elif ze:
            c.add("inject", f"Z on d{q} ({labels[q]}): a phase flip, invisible to Z-parity checks.",
                  lambda q=q: qc.z(d[q]), kind="error", source=labels[q])
    c.add("inject", "Stage boundary.", lambda: qc.barrier(), kind="barrier")
    c.add("extract", "CNOT d0→a0: a0 accumulates the parity of d0.", lambda: qc.cx(d[0], a[0]), check="S1")
    c.add("extract", "CNOT d1→a0: a0 now holds d0 ⊕ d1, the Z0Z1 parity.", lambda: qc.cx(d[1], a[0]), check="S1")
    c.add("extract", "CNOT d1→a1: a1 accumulates the parity of d1.", lambda: qc.cx(d[1], a[1]), check="S2")
    c.add("extract", "CNOT d2→a1: a1 now holds d1 ⊕ d2, the Z1Z2 parity.", lambda: qc.cx(d[2], a[1]), check="S2")
    for j in range(2):
        if readout_flips[j] == "1":
            c.add("measure", f"Modeled readout error: the recorded S{j + 1} bit is flipped.",
                  lambda j=j: qc.x(a[j]), kind="readout_error")
    c.add("measure", "Measure a0 → syn[0] = s1 (0 means S1 = +1).", lambda: qc.measure(a[0], syn[0]), kind="measure")
    c.add("measure", "Measure a1 → syn[1] = s2 (0 means S2 = +1).", lambda: qc.measure(a[1], syn[1]), kind="measure")
    table = correction_table or {"00": "000", "10": "100", "11": "010", "01": "001"}
    if mode == "physical":
        for synd in ("00", "10", "11", "01"):
            corr = table[synd]
            if corr == "000":
                continue

            def block(corr=corr, synd=synd):
                with qc.if_test((syn, syndrome_int(synd))):
                    for q in range(3):
                        if corr[q] == "1":
                            qc.x(d[q])
            c.add("correct", f"Feed-forward: if the syndrome reads {synd}, apply X on "
                             f"{', '.join(f'd{q}' for q in range(3) if corr[q] == '1')} (correction {corr}).",
                  block, kind="feed_forward", syndrome=synd, correction=corr)
        c.add("correct", "Stage boundary.", lambda: qc.barrier(), kind="barrier")
        c.add("verify", "Ideal verification: CNOT d0→d1.", lambda: qc.cx(d[0], d[1]))
        c.add("verify", "Ideal verification: CNOT d0→d2.", lambda: qc.cx(d[0], d[2]))
        c.add("verify", "Toffoli (d1, d2 → d0) flips d0 back if both partners disagree: a coherent majority vote.",
              lambda: qc.ccx(d[1], d[2], d[0]))
        if theta or phi:
            # U(θ, φ, 0)† = U(-θ, 0, -φ)
            c.add("verify", "Inverse preparation U† on d0: a recovered logical state returns to |0⟩.",
                  lambda: qc.u(-theta, 0, -phi, d[0]), inverse_preparation=True)
        c.add("verify", "Measure d0 → ver: 0 means the logical information was recovered.",
              lambda: qc.measure(d[0], regs[3][0]), kind="measure")
    else:
        c.add("correct", "Pauli frame: the correction is recorded classically; no gate is applied.",
              lambda: qc.barrier(), kind="frame_update")
        for q in range(3):
            c.add("verify", f"Measure d{q} in the Z basis → out[{q}].", lambda q=q: qc.measure(d[q], regs[3][q]),
                  kind="measure")
    return c


def qubit_label(qc: QuantumCircuit, qubit) -> str:
    loc = qc.find_bit(qubit)
    reg, index = loc.registers[0]
    return f"{reg.name}{index}"


def clbit_label(qc: QuantumCircuit, clbit) -> str:
    loc = qc.find_bit(clbit)
    reg, index = loc.registers[0]
    return f"{reg.name}[{index}]"


def _layers(qc: QuantumCircuit) -> list[int]:
    """ASAP layer index for every instruction (barriers synchronize all wires they touch)."""
    frontier: dict = {}
    layers = []
    for inst in qc.data:
        wires = list(inst.qubits) + list(inst.clbits)
        if isinstance(inst.operation, IfElseOp):
            wires += [b for b in qc.clbits if b not in wires and _condition_bits(qc, inst.operation, b)]
        start = max((frontier.get(w, 0) for w in wires), default=0)
        layers.append(start)
        for w in wires:
            frontier[w] = start + 1
    return layers


def _condition_bits(qc, op, bit) -> bool:
    target = op.condition[0]
    return bit in (list(target) if hasattr(target, "__iter__") else [target])


def describe_operations(c: Annotated) -> list[dict]:
    qc = c.qc
    layers = _layers(qc)
    ops = []
    for i, inst in enumerate(qc.data):
        op = inst.operation
        meta = c.meta[i] if i < len(c.meta) else {"stage": "transpiled", "explanation": "", "kind": "gate"}
        entry = {"index": i, "name": op.name, "qubits": [qubit_label(qc, q) for q in inst.qubits],
                 "clbits": [clbit_label(qc, b) for b in inst.clbits], "params": [_param(p) for p in op.params
                                                                                 if not isinstance(p, QuantumCircuit)],
                 "layer": layers[i], **meta}
        if isinstance(op, IfElseOp):
            target, value = op.condition
            entry["condition"] = {"register": getattr(target, "name", str(target)), "value": int(value)}
            body = op.params[0]
            entry["body"] = [{"name": b.operation.name,
                              "qubits": [qubit_label(qc, qc.qubits[body.find_bit(q).index]) for q in b.qubits]}
                             for b in body.data]
            entry["qubits"] = sorted({q for b in entry["body"] for q in b["qubits"]})
        if meta.get("inverse_preparation"):
            entry["display"] = "U†"
        ops.append(entry)
    return ops


def _param(p):
    try:
        return float(p)
    except TypeError:
        return str(p)


def _count(qc: QuantumCircuit, counts: dict):
    for inst in qc.data:
        op = inst.operation
        if isinstance(op, IfElseOp):
            counts["conditional_blocks"] += 1
            for block in op.blocks:
                if block is not None:
                    _count(block, counts)
            continue
        name = op.name
        if name == "barrier":
            continue
        if name == "measure":
            counts["measurements"] += 1
        elif name == "reset":
            counts["resets"] += 1
        elif op.num_qubits == 1:
            counts["one_qubit_gates"] += 1
        elif op.num_qubits == 2:
            counts["two_qubit_gates"] += 1
        else:
            counts["multi_qubit_gates"] += 1
        counts["by_name"][name] = counts["by_name"].get(name, 0) + 1


def circuit_metrics(qc: QuantumCircuit, data_qubits: int = 3) -> dict:
    counts = {"one_qubit_gates": 0, "two_qubit_gates": 0, "multi_qubit_gates": 0, "measurements": 0,
              "resets": 0, "conditional_blocks": 0, "by_name": {}}
    _count(qc, counts)
    active = {qc.find_bit(q).index for inst in qc.data for q in inst.qubits
              if inst.operation.name != "barrier"}
    gates = counts["one_qubit_gates"] + counts["two_qubit_gates"] + counts["multi_qubit_gates"]
    return {"data_qubits": data_qubits, "ancilla_qubits": len(active) - data_qubits if len(active) >= data_qubits else 0,
            "total_qubits": len(active), "total_gates": gates, **counts,
            "depth": qc.depth(lambda inst: inst.operation.name != "barrier")}


def transpile_for_target(qc: QuantumCircuit, optimization_level: int = 1, seed: int = 11,
                         coupling: str = "line") -> dict:
    coupling_map = coupling_maps()[coupling]["map"]
    started = perf_counter()
    tq = transpile(qc, basis_gates=TARGET_BASIS, coupling_map=coupling_map,
                   optimization_level=optimization_level, seed_transpiler=seed)
    elapsed = perf_counter() - started
    layout = tq.layout.final_index_layout() if tq.layout is not None else list(range(qc.num_qubits))
    ops = []
    layers = _layers(tq)
    for i, inst in enumerate(tq.data):
        op = inst.operation
        entry = {"index": i, "name": op.name, "qubits": [f"q{tq.find_bit(q).index}" for q in inst.qubits],
                 "clbits": [clbit_label(tq, b) for b in inst.clbits],
                 "params": [_param(p) for p in op.params if not isinstance(p, QuantumCircuit)], "layer": layers[i]}
        if isinstance(op, IfElseOp):
            target, value = op.condition
            entry["condition"] = {"register": getattr(target, "name", str(target)), "value": int(value)}
            body = op.params[0]
            entry["body"] = [{"name": b.operation.name,
                              "qubits": [f"q{tq.find_bit(tq.qubits[body.find_bit(q).index]).index}" for q in b.qubits]}
                             for b in body.data]
            entry["qubits"] = sorted({q for b in entry["body"] for q in b["qubits"]})
        ops.append(entry)
    virtual = [qubit_label(qc, q) for q in qc.qubits]
    return {"operations": ops, "metrics": circuit_metrics(tq), "compile_seconds": elapsed,
            "layout": {v: f"q{layout[i]}" for i, v in enumerate(virtual)},
            "physical_qubits": tq.num_qubits, "basis": TARGET_BASIS, "coupling": coupling,
            "coupling_edges": coupling_maps()[coupling]["edges"], "optimization_level": optimization_level,
            "seed_transpiler": seed}


def coupling_maps() -> dict:
    line = CouplingMap.from_line(5)
    # H-shaped 7-qubit graph (the connectivity pattern of IBM's 7-qubit Falcon devices).
    h_edges = [(0, 1), (1, 2), (1, 3), (3, 5), (4, 5), (5, 6)]
    h = CouplingMap([list(e) for e in h_edges] + [[b, a] for a, b in h_edges])
    return {"line": {"map": line, "edges": [list(e) for e in line.get_edges() if e[0] < e[1]],
                     "label": "5-qubit line"},
            "h7": {"map": h, "edges": [list(e) for e in h_edges], "label": "7-qubit H-shaped graph"}}


def _format_state(sv: Statevector, labels: list[str], threshold: float = 1e-10) -> list[dict]:
    """Non-zero amplitudes, with basis strings written in register order d0 d1 d2 a0 a1."""
    data = np.asarray(sv.data)
    n = len(labels)
    rows = []
    for k in np.flatnonzero(np.abs(data) > threshold):
        bits = "".join(str((int(k) >> q) & 1) for q in range(n))
        amp = data[k]
        rows.append({"basis": bits, "re": float(amp.real), "im": float(amp.imag), "prob": float(abs(amp) ** 2)})
    rows.sort(key=lambda r: r["basis"])
    return rows


def step_through(c: Annotated, seed: int = 0) -> list[dict]:
    """Evolve the circuit instruction by instruction with Qiskit's Statevector.

    Measurements are projective: when an outcome has probability 1 it is recorded as deterministic;
    otherwise a seeded draw selects the branch and the probabilities are reported with it.
    """
    qc = c.qc
    labels = [qubit_label(qc, q) for q in qc.qubits]
    sv = Statevector.from_label("0" * qc.num_qubits)
    clbits = {clbit_label(qc, b): 0 for b in qc.clbits}
    rng = np.random.default_rng(seed)
    steps = [{"index": -1, "name": "init", "stage": "prepare", "state": _format_state(sv, labels),
              "classical": dict(clbits)}]
    for i, inst in enumerate(qc.data):
        op = inst.operation
        qidx = [qc.find_bit(q).index for q in inst.qubits]
        info = {"index": i, "name": op.name, "stage": c.meta[i]["stage"]}
        if op.name == "barrier":
            continue
        if op.name == "measure":
            q = qidx[0]
            probs = sv.probabilities([q])
            p1 = float(probs[1])
            if p1 < 1e-12 or p1 > 1 - 1e-12:
                outcome = int(round(p1))
                deterministic = True
            else:
                outcome = int(rng.random() < p1)
                deterministic = False
            proj = np.zeros(2 ** qc.num_qubits)
            proj[[k for k in range(2 ** qc.num_qubits) if ((k >> q) & 1) == outcome]] = 1
            vec = sv.data * proj
            sv = Statevector(vec / np.linalg.norm(vec))
            clbits[clbit_label(qc, inst.clbits[0])] = outcome
            info.update(outcome=outcome, probability_one=p1, deterministic=deterministic)
        elif isinstance(op, IfElseOp):
            target, value = op.condition
            reg_bits = [clbit_label(qc, b) for b in target]
            current = sum(clbits[b] << k for k, b in enumerate(reg_bits))
            taken = current == int(value)
            info.update(condition_value=int(value), register_value=current, taken=taken)
            if taken:
                body = op.params[0]
                for b in body.data:
                    targets = [qidx_from_body(qc, inst, body, q) for q in b.qubits]
                    sv = sv.evolve(b.operation, targets)
        else:
            sv = sv.evolve(op, qidx)
        info["state"] = _format_state(sv, labels)
        info["classical"] = dict(clbits)
        steps.append(info)
    return steps


def qidx_from_body(qc: QuantumCircuit, inst, body: QuantumCircuit, q) -> int:
    return qc.find_bit(inst.qubits[body.find_bit(q).index]).index


def data_state(sv_rows: list[dict]) -> dict:
    """Reduce a 5-qubit snapshot to the data register when the ancillas are in a basis state."""
    anc = {r["basis"][3:] for r in sv_rows}
    if len(anc) != 1:
        return {"separable": False}
    return {"separable": True, "ancilla": anc.pop(),
            "data": [{"basis": r["basis"][:3], "re": r["re"], "im": r["im"], "prob": r["prob"]} for r in sv_rows]}
