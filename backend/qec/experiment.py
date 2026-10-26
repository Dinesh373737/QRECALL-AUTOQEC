"""One QEC Lab trial: Encode -> Inject -> Measure syndrome -> Decode -> Correct -> Verify.

Simulated noise and the decoder's *declared model* are separate inputs. By default the model
equals the simulated noise (a calibrated decoder); a mismatch can be declared explicitly. The
decoder only ever receives the observed syndrome and the declared model.
"""
from __future__ import annotations

import math
from time import perf_counter

import numpy as np

from .circuits import PRESETS, STAGE_TEXT, amplitudes, build_lab_circuit, circuit_metrics, data_state, \
    describe_operations, step_through
from .codes import RepetitionCode, bits_to_string, string_to_bits
from .decoders import DECODERS, decode, decision_table
from .explain import explain, sensitivity
from .likelihood import candidate_analysis, logical_class_summary, strip_private, validate_probabilities
from .noise import bernoulli, describe_streams, streams

MODEL_P_FLOOR = 1e-3


def logical_operator(x_flip: int, z_parity: int) -> str:
    return {(0, 0): "I", (1, 0): "X̄", (0, 1): "Z̄", (1, 1): "Ȳ"}[(x_flip, z_parity)]


def run_trial(cfg: dict) -> dict:
    started = perf_counter()
    code = RepetitionCode(3)
    theta, phi = PRESETS.get(cfg.get("state", "zero"), (cfg.get("theta", 0.0), cfg.get("phi", 0.0)))
    if cfg.get("state") == "custom":
        theta, phi = float(cfg["theta"]), float(cfg["phi"])
    p = validate_probabilities(cfg.get("p", 0.0), 3, "Simulated data-error probabilities")
    q = validate_probabilities(cfg.get("q", 0.0), 2, "Simulated readout-error probabilities")
    model = cfg.get("model") or {}
    model_p = np.clip(validate_probabilities(model.get("p", p), 3, "Model data-error probabilities"), MODEL_P_FLOOR, 0.5)
    model_q = validate_probabilities(model.get("q", q), 2, "Model readout-error probabilities")
    seed = int(cfg.get("seed", 7))
    decoder = cfg.get("decoder", "energy")
    if decoder not in DECODERS:
        raise ValueError(f"Unknown decoder '{decoder}'.")
    mode = cfg.get("mode", "physical")

    injected_x = np.zeros(3, dtype=np.uint8)
    injected_z = np.zeros(3, dtype=np.uint8)
    for fault in cfg.get("injected", []):
        qb, pauli = int(fault["qubit"]), fault["pauli"]
        if not 0 <= qb < 3 or pauli not in ("X", "Y", "Z"):
            raise ValueError("Injected faults need a qubit 0-2 and a Pauli X, Y or Z.")
        if pauli in ("X", "Y"):
            injected_x[qb] ^= 1
        if pauli in ("Z", "Y"):
            injected_z[qb] ^= 1
    rng = streams(seed)
    random_x = bernoulli(rng["data"], p, 1)[0]
    readout = bernoulli(rng["readout"], q, 1)[0]
    x_err = injected_x ^ random_x
    ideal = code.syndrome(x_err)
    observed = ideal ^ readout

    analysis = candidate_analysis(code, observed, model_p, model_q, actual_error=x_err)
    energy, post = analysis["_energy"], analysis["_posterior"]
    decisions = {}
    for name in DECODERS:
        d = decode(code, name, observed, model_p, model_q)
        corr = string_to_bits(d["correction"], 3)
        residual = x_err ^ corr
        decisions[name] = {"correction": d["correction"], "residual": bits_to_string(residual),
                           "outcome": code.classify_residual(residual),
                           "logical_classes": logical_class_summary(code, energy, post, corr),
                           "decode_time_us": d["decode_time_us"], "evidence": d["evidence"],
                           "label": DECODERS[name]["label"]}
    chosen = decisions[decoder]
    correction = string_to_bits(chosen["correction"], 3)
    residual = x_err ^ correction
    z_parity = int(injected_z.sum() % 2)
    x_flip = int(code.logical_flip(residual))
    table = {bits_to_string([(k >> 1) & 1, k & 1]): bits_to_string(row)
             for k, row in enumerate(decision_table(code, decoder, model_p, model_q))}

    labels = []
    for qb in range(3):
        parts = []
        if injected_x[qb] or injected_z[qb]:
            parts.append("injected")
        if random_x[qb]:
            parts.append("random")
        labels.append(" + ".join(parts) or "none")
    circuit = build_lab_circuit(theta, phi, bits_to_string(x_err), bits_to_string(injected_z),
                                bits_to_string(readout), table, mode, labels)
    steps = step_through(circuit, seed)
    snapshots = _stage_snapshots(steps)
    final = steps[-1]
    alpha, beta = amplitudes(theta, phi)
    verification = {"actual_error": bits_to_string(x_err), "z_errors": bits_to_string(injected_z),
                    "correction": chosen["correction"], "residual": bits_to_string(residual),
                    "outcome": code.classify_residual(residual), "z_parity": z_parity,
                    "logical_operator": logical_operator(x_flip, z_parity),
                    "logical_preserved": x_flip == 0 and z_parity == 0,
                    "codeword_restored": not residual.any() and z_parity == 0,
                    "convention": code.describe()["recovery_convention"]}
    if mode == "physical":
        p_fail = float(final.get("probability_one", 0.0))
        verification["circuit_check"] = {
            "measurement": "ver (d0 after coherent majority decoding and U†)",
            "p_ver_1": p_fail, "logical_fidelity": 1 - p_fail, "sampled_ver": final["classical"].get("ver[0]"),
            "state_dependent_note": ("A logical error is invisible on states it leaves unchanged (e.g. X̄ on |+⟩), "
                                     "so the fidelity check depends on the input state; logical_operator does not.")}
    else:
        out = [final["classical"][f"out[{k}]"] for k in range(3)]
        corrected = np.array(out, dtype=np.uint8) ^ correction
        verification["circuit_check"] = {
            "measurement": "Z-basis readout of d0 d1 d2 with the Pauli frame applied in software",
            "raw_readout": bits_to_string(out), "frame": chosen["correction"],
            "corrected_readout": bits_to_string(corrected), "decoded_logical_bit": int(corrected.sum() > 1),
            "note": "Z-basis readout verifies only the bit-flip (Z̄) logical value; phase is not checked."}
    truth = {"actual_error": bits_to_string(x_err), "residual": bits_to_string(residual),
             "outcome": verification["outcome"], "z_parity": z_parity}
    return {
        "schema_version": "qec-lab-1",
        "code": code.describe(),
        "input": {"state": cfg.get("state", "zero"), "theta": theta, "phi": phi,
                  "alpha": [alpha.real, alpha.imag], "beta": [beta.real, beta.imag],
                  "injected": cfg.get("injected", []), "p": p.tolist(), "q": q.tolist(),
                  "model_p": model_p.tolist(), "model_q": model_q.tolist(), "seed": seed,
                  "decoder": decoder, "mode": mode,
                  "model_matches_simulation": bool(np.allclose(model_p, np.clip(p, MODEL_P_FLOOR, 0.5))
                                                   and np.allclose(model_q, q))},
        "noise": {"random_x": bits_to_string(random_x), "readout_flips": bits_to_string(readout),
                  "injected_x": bits_to_string(injected_x), "injected_z": bits_to_string(injected_z),
                  "total_x": bits_to_string(x_err), "streams": describe_streams(seed)},
        "syndrome": {"ideal": bits_to_string(ideal), "observed": bits_to_string(observed),
                     "stabilizer_values": code.stabilizer_values(x_err).tolist(),
                     "observed_values": (1 - 2 * observed.astype(int)).tolist(),
                     "readout_corrupted": bool(readout.any())},
        "analysis": strip_private(analysis),
        "decisions": decisions,
        "decision_table": table,
        "explanation": explain(code, analysis, decoder, chosen["correction"], model_p, model_q, truth,
                               chosen["logical_classes"]),
        "sensitivity": sensitivity(code, observed, model_p, model_q),
        "verification": verification,
        "circuit": {"mode": mode, "operations": describe_operations(circuit), "metrics": circuit_metrics(circuit.qc),
                    "qubits": ["d0", "d1", "d2", "a0", "a1"],
                    "clbits": [b for b in final["classical"]], "stage_text": STAGE_TEXT},
        "steps": steps,
        "stages": snapshots,
        "provenance": {"kind": "simulation", "engine": "Qiskit Statevector step evolution + NumPy likelihood",
                       "seed": seed, "duration_ms": (perf_counter() - started) * 1e3},
    }


def _stage_snapshots(steps: list[dict]) -> dict:
    """State at the end of each stage (data register reduced when the ancillas are in a basis state)."""
    out = {}
    for s in steps:
        out[s["stage"]] = {"after_step": s["index"], "state": s["state"], "classical": s["classical"],
                           "reduced": data_state(s["state"])}
    return out
