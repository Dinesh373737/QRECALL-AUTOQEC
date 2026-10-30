"""Resource-aware selection among implementations of ONE logical task.

Logical task (fixed for every candidate): store a logical bit b in the three-qubit bit-flip code,
run one round of Z0Z1 / Z1Z2 syndrome extraction, measure the data qubits, and decode in software
(lookup-table Pauli frame + majority vote). Candidates differ only in *how* this is implemented:

* syndrome-extraction family: two ancillas (sequential or interleaved CNOT schedule) or one
  ancilla reused with mid-circuit measurement and reset,
* Qiskit transpiler settings: optimization level, layout method, routing method and seed,

all compiled to the same target (basis rz, sx, x, cx and a fixed coupling map). Identical compiled
circuits are merged. Each candidate is checked functionally in noiseless simulation (both logical
inputs and every single-X injection) and its logical failure rate is estimated with Aer under one
common, declared noise model. This is a modeling/simulation analysis, not a hardware validation.

Selection = hard-constraint filter, then the normalized cost
    J(c) = wQ * Q/Qref + wG * G2/G2ref + wD * D/Dref
with references taken from the documented baseline candidate. This optimizes an implementation;
it is a different problem from decoding (which selects a correction).
"""
from __future__ import annotations

import hashlib
import itertools
from time import perf_counter

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister, transpile
from qiskit.converters import circuit_to_dag, dag_to_circuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, ReadoutError, depolarizing_error

from .circuits import TARGET_BASIS, coupling_maps
from .codes import RepetitionCode
from .statistics import wilson

FAMILIES = {
    "two_ancilla_sequential": "Two ancillas, CNOTs in check order (d0→a0, d1→a0, d1→a1, d2→a1).",
    "two_ancilla_interleaved": "Two ancillas, interleaved schedule (d0→a0 ∥ d1→a1, then d1→a0 ∥ d2→a1).",
    "one_ancilla_reuse": "One ancilla measured and reset between the two checks (fewer qubits, longer schedule).",
}
OPT_LEVELS = (0, 1, 2, 3)
LAYOUTS = ("trivial", "dense", "sabre")
ROUTINGS = ("basic", "sabre")
SEEDS = (11, 23)
BASELINE = {"family": "two_ancilla_sequential", "optimization_level": 0, "layout_method": "trivial",
            "routing_method": "basic", "seed": 11}
DURATIONS_NS = {"sx": 35, "x": 35, "rz": 0, "id": 35, "cx": 300, "measure": 800, "reset": 400, "barrier": 0}
DEFAULT_NOISE = {"p1": 0.001, "p2": 0.01, "p_meas": 0.02, "p_idle": 0.001}
IDLE_QUANTUM_NS = 100  # one idle marker per started 100 ns that an active qubit waits


def memory_circuit(family: str, logical_bit: int, inject: int | None = None) -> QuantumCircuit:
    if family not in FAMILIES:
        raise ValueError(f"Unknown family '{family}'.")
    d = QuantumRegister(3, "d")
    a = QuantumRegister(1 if family == "one_ancilla_reuse" else 2, "a")
    syn = ClassicalRegister(2, "syn")
    out = ClassicalRegister(3, "out")
    qc = QuantumCircuit(d, a, syn, out, name=family)
    if logical_bit:
        qc.x(d[0])
    qc.cx(d[0], d[1])
    qc.cx(d[0], d[2])
    if inject is not None:
        qc.x(d[inject])
    if family == "two_ancilla_sequential":
        qc.cx(d[0], a[0]); qc.cx(d[1], a[0]); qc.cx(d[1], a[1]); qc.cx(d[2], a[1])
        qc.measure(a[0], syn[0]); qc.measure(a[1], syn[1])
    elif family == "two_ancilla_interleaved":
        qc.cx(d[0], a[0]); qc.cx(d[1], a[1]); qc.cx(d[1], a[0]); qc.cx(d[2], a[1])
        qc.measure(a[0], syn[0]); qc.measure(a[1], syn[1])
    else:
        qc.cx(d[0], a[0]); qc.cx(d[1], a[0]); qc.measure(a[0], syn[0]); qc.reset(a[0])
        qc.cx(d[1], a[0]); qc.cx(d[2], a[0]); qc.measure(a[0], syn[1])
    qc.measure(d, out)
    return qc


def compile_candidate(family: str, logical_bit: int, settings: dict, coupling: str, inject: int | None = None):
    qc = memory_circuit(family, logical_bit, inject)
    started = perf_counter()
    tq = transpile(qc, basis_gates=TARGET_BASIS, coupling_map=coupling_maps()[coupling]["map"],
                   optimization_level=settings["optimization_level"], layout_method=settings["layout_method"],
                   routing_method=settings["routing_method"], seed_transpiler=settings["seed"])
    return tq, perf_counter() - started


def fingerprint(qc: QuantumCircuit) -> str:
    parts = []
    for inst in qc.data:
        parts.append(f"{inst.operation.name}{[round(float(p), 9) for p in inst.operation.params]}"
                     f"{[qc.find_bit(q).index for q in inst.qubits]}{[qc.find_bit(c).index for c in inst.clbits]}")
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def metrics(qc: QuantumCircuit) -> dict:
    active = sorted({qc.find_bit(q).index for inst in qc.data for q in inst.qubits if inst.operation.name != "barrier"})
    names: dict[str, int] = {}
    g1 = g2 = meas = resets = 0
    for inst in qc.data:
        n = inst.operation.name
        names[n] = names.get(n, 0) + 1
        if n == "measure":
            meas += 1
        elif n == "reset":
            resets += 1
        elif n == "barrier":
            continue
        elif inst.operation.num_qubits == 2:
            g2 += 1
        else:
            g1 += 1
    return {"Q": len(active), "G2": g2, "G1": g1, "D": qc.depth(), "measurements": meas, "resets": resets,
            "active_physical_qubits": active, "ops": names, "duration_ns": duration_ns(qc)}


def duration_ns(qc: QuantumCircuit) -> float:
    """Critical-path wall-clock estimate from declared gate durations (not the same as depth)."""
    ready: dict[int, float] = {}
    cl_ready: dict[int, float] = {}
    for inst in qc.data:
        qs = [qc.find_bit(q).index for q in inst.qubits]
        cs = [qc.find_bit(c).index for c in inst.clbits]
        start = max([ready.get(q, 0.0) for q in qs] + [cl_ready.get(c, 0.0) for c in cs] + [0.0])
        end = start + DURATIONS_NS.get(inst.operation.name, 50)
        for q in qs:
            ready[q] = end
        for c in cs:
            cl_ready[c] = end
    return max(list(ready.values()) + [0.0])


def with_idle_markers(qc: QuantumCircuit) -> QuantumCircuit:
    """Insert ``id`` markers on active qubits that wait inside the schedule (ASAP layers).

    Idling is charged per unit of time, not per layer: a qubit waiting through a layer receives one marker
    per started ``IDLE_QUANTUM_NS`` of that layer's duration (the longest operation in it, from the declared
    gate times). Slow mid-circuit measurement and reset therefore cost real idle error on the data qubits.
    """
    dag = circuit_to_dag(qc)
    active = {qc.find_bit(q).index for inst in qc.data for q in inst.qubits}
    first: dict[int, int] = {}
    last: dict[int, int] = {}
    layers = list(dag.layers())
    for li, layer in enumerate(layers):
        for node in layer["graph"].op_nodes():
            for q in node.qargs:
                idx = qc.find_bit(q).index
                first.setdefault(idx, li)
                last[idx] = li
    out = QuantumCircuit(*qc.qregs, *qc.cregs)
    for li, layer in enumerate(layers):
        busy = set()
        for node in layer["graph"].op_nodes():
            out.append(node.op, [out.qubits[qc.find_bit(q).index] for q in node.qargs],
                       [out.clbits[qc.find_bit(c).index] for c in node.cargs])
            busy |= {qc.find_bit(q).index for q in node.qargs}
        layer_ns = max((DURATIONS_NS.get(node.op.name, 50) for node in layer["graph"].op_nodes()), default=0)
        markers = int(np.ceil(layer_ns / IDLE_QUANTUM_NS)) if layer_ns > 0 else 0
        for q in sorted(active - busy):
            if first[q] < li < last[q]:
                for _ in range(markers):
                    out.id(out.qubits[q])
    return out


def noise_model(noise: dict) -> NoiseModel:
    nm = NoiseModel()
    if noise["p1"] > 0:
        nm.add_all_qubit_quantum_error(depolarizing_error(noise["p1"], 1), ["sx", "x"])
    if noise["p_idle"] > 0:
        nm.add_all_qubit_quantum_error(depolarizing_error(noise["p_idle"], 1), ["id"])
    if noise["p2"] > 0:
        nm.add_all_qubit_quantum_error(depolarizing_error(noise["p2"], 2), ["cx"])
    if noise["p_meas"] > 0:
        pm = noise["p_meas"]
        nm.add_all_qubit_readout_error(ReadoutError([[1 - pm, pm], [pm, 1 - pm]]))
    return nm


def decode_counts(counts: dict[str, int], logical_bit: int) -> tuple[int, int, dict]:
    """Lookup-table Pauli frame + majority vote on Aer counts keyed 'out syn' (bit 0 rightmost)."""
    table = RepetitionCode(3).lookup_table()
    failures = total = 0
    syndromes: dict[str, int] = {}
    for key, n in counts.items():
        out_bits, syn_bits = key.split()
        out = [int(b) for b in out_bits[::-1]]
        syn = "".join(syn_bits[::-1])  # s1 s2
        frame = [int(c) for c in table[syn]]
        corrected = [o ^ f for o, f in zip(out, frame)]
        logical = int(sum(corrected) > 1)
        failures += n * (logical != logical_bit)
        total += n
        syndromes[syn] = syndromes.get(syn, 0) + n
    return failures, total, syndromes


def functional_checks(family: str, settings: dict, coupling: str) -> dict:
    sim = AerSimulator()
    table = {"100": "10", "010": "11", "001": "01"}
    checks = []
    for b in (0, 1):
        tq, _ = compile_candidate(family, b, settings, coupling)
        counts = sim.run(tq, shots=16, seed_simulator=1).result().get_counts()
        fails, _, syn = decode_counts(counts, b)
        checks.append({"case": f"|{b}_L⟩ no error", "passed": fails == 0 and set(syn) == {"00"}})
        for k in range(3):
            tq, _ = compile_candidate(family, b, settings, coupling, inject=k)
            counts = sim.run(tq, shots=16, seed_simulator=1).result().get_counts()
            fails, _, syn = decode_counts(counts, b)
            expected = table["".join("1" if i == k else "0" for i in range(3))]
            checks.append({"case": f"|{b}_L⟩ with X{k}", "passed": fails == 0 and set(syn) == {expected},
                           "syndrome": sorted(syn)})
    return {"passed": all(c["passed"] for c in checks), "checks": checks,
            "method": "noiseless stabilizer simulation of the compiled family/settings for both logical inputs and "
                      "every single-X injection (syndrome table and decoded logical value must match)"}


def evaluate(cfg: dict, progress=None, cancel=None) -> dict:
    """Compile the documented grid, merge duplicates, verify and estimate p_L for each unique circuit."""
    started = perf_counter()
    coupling = cfg.get("coupling", "h7")
    noise = {**DEFAULT_NOISE, **(cfg.get("noise") or {})}
    shots = int(cfg.get("shots", 4000))
    seed = int(cfg.get("seed", 1234))
    families = cfg.get("families") or list(FAMILIES)
    grid = [{"family": f, "optimization_level": o, "layout_method": l, "routing_method": r, "seed": s}
            for f, o, l, r, s in itertools.product(families, OPT_LEVELS, LAYOUTS, ROUTINGS, SEEDS)]
    if BASELINE not in grid:
        grid.insert(0, dict(BASELINE))
    unique: dict[str, dict] = {}
    for k, settings in enumerate(grid):
        if cancel and cancel():
            raise InterruptedError
        tq, seconds = compile_candidate(settings["family"], 0, settings, coupling)
        fp = fingerprint(tq) + settings["family"]
        entry = unique.setdefault(fp, {"id": fp[:10], "family": settings["family"], "circuit": tq, "settings": [],
                                       "compile_seconds": []})
        entry["settings"].append({k2: v for k2, v in settings.items() if k2 != "family"})
        entry["compile_seconds"].append(seconds)
        if progress:
            progress(0.4 * (k + 1) / len(grid), "Compiling candidates")
    nm = noise_model(noise)
    sim = AerSimulator(noise_model=nm)
    candidates = []
    for k, entry in enumerate(unique.values()):
        if cancel and cancel():
            raise InterruptedError
        first = entry["settings"][0]
        settings = {"family": entry["family"], **first}
        failures = total = 0
        for b in (0, 1):
            tq, _ = compile_candidate(entry["family"], b, settings, coupling)
            noisy = with_idle_markers(tq)
            counts = sim.run(noisy, shots=shots, seed_simulator=seed + b).result().get_counts()
            f, t, _ = decode_counts(counts, b)
            failures, total = failures + f, total + t
        low, high = wilson(failures, total)
        m = metrics(entry["circuit"])
        is_baseline = any(s == {k2: v for k2, v in BASELINE.items() if k2 != "family"} for s in entry["settings"]) \
            and entry["family"] == BASELINE["family"]
        candidates.append({"id": entry["id"], "family": entry["family"], "family_text": FAMILIES[entry["family"]],
                           "settings": entry["settings"], "equivalent_settings": len(entry["settings"]),
                           "compile_ms": 1e3 * float(np.median(entry["compile_seconds"])),
                           **{k2: v for k2, v in m.items()},
                           "pL": failures / total, "pL_ci95": [low, high], "failures": failures, "trials": total,
                           "spacetime_proxy": m["Q"] * m["duration_ns"],
                           "verification": functional_checks(entry["family"], settings, coupling),
                           "is_baseline": is_baseline})
        if progress:
            progress(0.4 + 0.6 * (k + 1) / len(unique), "Verifying and simulating candidates")
    return {"schema_version": "qec-optimizer-1", "kind": "simulation",
            "task": "One QEC cycle of the 3-qubit bit-flip memory (|0_L⟩ and |1_L⟩), lookup Pauli frame + majority readout",
            "target": {"coupling": coupling, "coupling_label": coupling_maps()[coupling]["label"],
                       "coupling_edges": coupling_maps()[coupling]["edges"], "basis": TARGET_BASIS},
            "noise": noise, "noise_text": ("Depolarizing p1 on sx/x, p2 on cx, p_idle per 100 ns that an active qubit idles (explicit id "
                                           "markers sized by each layer's duration), symmetric readout error p_meas."),
            "shots_per_logical_input": shots, "seed": seed, "grid_size": len(grid),
            "unique_candidates": len(candidates), "baseline_settings": BASELINE,
            "durations_ns": DURATIONS_NS, "candidates": candidates,
            "duration_seconds": perf_counter() - started}


def rank(evaluation: dict, weights: dict, limits: dict, conservative: bool = True) -> dict:
    cands = evaluation["candidates"]
    baseline = next((c for c in cands if c["is_baseline"]), cands[0])
    refs = {"Q": baseline["Q"], "G2": max(1, baseline["G2"]), "D": max(1, baseline["D"])}
    w = {"Q": float(weights.get("Q", 1)), "G2": float(weights.get("G2", 1)), "D": float(weights.get("D", 1))}
    rows = []
    for c in cands:
        p_used = c["pL_ci95"][1] if conservative else c["pL"]
        violations = []
        if limits.get("Q") is not None and c["Q"] > limits["Q"]:
            violations.append(f"Q = {c['Q']} > {limits['Q']}")
        if limits.get("G2") is not None and c["G2"] > limits["G2"]:
            violations.append(f"G2 = {c['G2']} > {limits['G2']}")
        if limits.get("D") is not None and c["D"] > limits["D"]:
            violations.append(f"D = {c['D']} > {limits['D']}")
        if limits.get("pL") is not None and p_used > limits["pL"]:
            violations.append(f"pL{' (95% upper bound)' if conservative else ''} = {p_used:.4f} > {limits['pL']}")
        if not c["verification"]["passed"]:
            violations.append("failed functional verification")
        terms = {k: w[k] * c[k] / refs[k] for k in ("Q", "G2", "D")}
        rows.append({**{k: c[k] for k in ("id", "family", "Q", "G2", "D", "G1", "pL", "pL_ci95", "duration_ns",
                                          "compile_ms", "equivalent_settings", "is_baseline", "spacetime_proxy")},
                     "settings": c["settings"][0], "feasible": not violations, "violations": violations,
                     "cost_terms": terms, "J": sum(terms.values()), "p_used": p_used})
    for r in rows:
        r["pareto"] = not any(_dominates(o, r) for o in rows if o is not r)
    feasible = sorted([r for r in rows if r["feasible"]], key=lambda r: (round(r["J"], 12), r["pL"], r["id"]))
    for i, r in enumerate(feasible, start=1):
        r["rank"] = i
    selected = feasible[0] if feasible else None
    comparison = None
    if selected:
        comparison = {k: {"baseline": baseline[k], "selected": selected[k],
                          "change_percent": None if not baseline[k] else 100 * (selected[k] - baseline[k]) / baseline[k]}
                      for k in ("Q", "G2", "D", "pL", "duration_ns")}
        comparison["pL_note"] = ("Logical failure rates are Monte Carlo estimates with 95% Wilson intervals; overlapping "
                                 "intervals mean the difference is not resolved at this shot count.")
    dominates_all = False
    if selected:
        others = [r for r in feasible if r is not selected]
        dominates_all = bool(others) and all(all(selected[k] <= o[k] for k in ("Q", "G2", "D")) for o in others)
    sensitivity = _weight_sensitivity(selected, feasible, w, refs) if selected else []
    reason = None
    if selected:
        reason = (f"Lowest normalized cost J = {selected['J']:.3f} among {len(feasible)} feasible candidate(s) "
                  f"(J = {' + '.join(f'{k}: {v:.3f}' for k, v in selected['cost_terms'].items())}).")
        if dominates_all:
            reason += (" It is no worse than every other feasible candidate on qubits, two-qubit gates and depth at "
                       "the same time, so changing the weights cannot change this choice; tighten a constraint or "
                       "change the noise model to explore trade-offs.")
    return {"references": refs, "reference_source": f"baseline candidate {baseline['id']} "
                                                   f"({BASELINE['family']}, opt level 0, trivial layout, basic routing)",
            "weights": w, "limits": limits, "conservative_pL": conservative, "candidates": rows,
            "feasible_count": len(feasible), "selected": selected, "baseline": next(r for r in rows if r["id"] == baseline["id"]),
            "comparison": comparison, "status": "selected" if selected else "no_feasible_candidate",
            "selected_dominates_all": dominates_all, "weight_sensitivity": sensitivity,
            "message": reason or "No feasible candidate: every candidate violates at least one hard constraint.",
            "objective": "J(c) = wQ·Q/Qref + wG·G2/G2ref + wD·D/Dref (hard constraints applied first)"}


def _weight_sensitivity(selected: dict, feasible: list[dict], w: dict, refs: dict, w_max: float = 10.0) -> list[dict]:
    """For each weight alone, the value at which another feasible candidate first takes over.

    J is linear in each weight, so J_c - J_sel = gap + (t - w_k) * slope with slope = (c_k - sel_k) / ref_k;
    the first crossing in each direction is the nearest switch point. Other weights stay as they are.
    """
    out = []
    for k in ("Q", "G2", "D"):
        for direction in ("raise", "lower"):
            best = None
            for c in feasible:
                if c is selected:
                    continue
                slope = (c[k] - selected[k]) / refs[k]
                gap = c["J"] - selected["J"]
                if direction == "raise" and slope < 0:
                    t = w[k] + gap / -slope
                    if t <= w_max and (best is None or t < best[0]):
                        best = (t, c)
                elif direction == "lower" and slope > 0:
                    t = w[k] - gap / slope
                    if t >= 0 and (best is None or t > best[0]):
                        best = (t, c)
            if best:
                c = best[1]
                out.append({"weight": k, "direction": direction, "threshold": best[0],
                            "switches_to": {key: c[key] for key in ("id", "family", "Q", "G2", "D", "pL")}})
    return out


def _dominates(a: dict, b: dict) -> bool:
    keys = ("Q", "G2", "D", "pL")
    return all(a[k] <= b[k] for k in keys) and any(a[k] < b[k] for k in keys)
