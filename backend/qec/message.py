"""Message Lab: classical message bits carried by computational-basis states of a repetition code.

Scientific boundary: each message bit is prepared as |0_L> or |1_L> (a known basis state), so
this demonstrates protecting *classical* bits stored in qubits. It does not transmit or copy an
arbitrary unknown quantum state. Bits are processed sequentially, so only one 3-data + 2-ancilla
block is needed at a time.

The unprotected channel is paired with the protected one: an unprotected bit flips exactly when
physical qubit d0 of the corresponding protected block flips in the same seeded draw.
"""
from __future__ import annotations

from time import perf_counter

import numpy as np

from .circuits import build_lab_circuit, circuit_metrics
from .codes import RepetitionCode, bits_to_string
from .decoders import DECODERS, decision_table, syndrome_index
from .likelihood import candidate_analysis, strip_private, validate_probabilities
from .noise import bernoulli, describe_streams, streams
from .statistics import proportion

MAX_MESSAGE_BYTES = 64


def message_bits(text: str) -> tuple[bytes, np.ndarray]:
    data = text.encode("utf-8")
    if not data:
        raise ValueError("Enter at least one character.")
    if len(data) > MAX_MESSAGE_BYTES:
        raise ValueError(f"Messages are limited to {MAX_MESSAGE_BYTES} UTF-8 bytes.")
    bits = np.unpackbits(np.frombuffer(data, dtype=np.uint8))  # most-significant bit first in each byte
    return data, bits


def bits_to_bytes(bits: np.ndarray) -> bytes:
    return np.packbits(np.asarray(bits, dtype=np.uint8)).tobytes()


def char_spans(text: str) -> list[dict]:
    spans, start = [], 0
    for ch in text:
        width = len(ch.encode("utf-8"))
        spans.append({"char": ch, "byte_start": start, "byte_end": start + width,
                      "bit_start": start * 8, "bit_end": (start + width) * 8})
        start += width
    return spans


def decode_span(data: bytes, span: dict) -> str:
    return data[span["byte_start"]:span["byte_end"]].decode("utf-8", errors="replace")


def run_message(cfg: dict) -> dict:
    started = perf_counter()
    code = RepetitionCode(3)
    text = cfg.get("message", "HELLO")
    decoder = cfg.get("decoder", "energy")
    if decoder not in DECODERS:
        raise ValueError(f"Unknown decoder '{decoder}'.")
    p = validate_probabilities(cfg.get("p", 0.05), 3, "Data-error probability")
    q = validate_probabilities(cfg.get("q", 0.0), 2, "Readout-error probability")
    model = cfg.get("model") or {}
    model_p = np.clip(validate_probabilities(model.get("p", p), 3, "Model data-error probabilities"), 1e-3, 0.5)
    model_q = validate_probabilities(model.get("q", q), 2, "Model readout-error probabilities")
    seed = int(cfg.get("seed", 2026))
    data, bits = message_bits(text)
    n = bits.size
    rng = streams(seed)
    flips = bernoulli(rng["data"], p, n)
    readout = bernoulli(rng["readout"], q, n)
    ideal = code.syndrome(flips)
    observed = ideal ^ readout
    table = decision_table(code, decoder, model_p, model_q)
    corrections = table[syndrome_index(code, observed)]
    residual = flips ^ corrections
    logical = code.logical_flip(residual).astype(np.uint8)
    protected = bits ^ logical
    unprotected = bits ^ flips[:, 0]
    outcome = np.where(~residual.any(axis=1), "restored",
                       np.where(logical == 1, "logical_flip", "recoverable_residual"))

    spans = char_spans(text)
    prot_bytes, unprot_bytes = bits_to_bytes(protected), bits_to_bytes(unprotected)
    chars = []
    for i, s in enumerate(spans):
        sl = slice(s["bit_start"], s["bit_end"])
        chars.append({**s, "index": i, "unprotected": decode_span(unprot_bytes, s),
                      "protected": decode_span(prot_bytes, s),
                      "unprotected_bit_errors": int((unprotected[sl] != bits[sl]).sum()),
                      "protected_bit_errors": int((protected[sl] != bits[sl]).sum()),
                      "physical_flips": int(flips[sl].sum()), "readout_flips": int(readout[sl].sum())})

    syndromes = {}
    for k in range(4):
        y = np.array([(k >> 1) & 1, k & 1], dtype=np.uint8)
        a = strip_private(candidate_analysis(code, y, model_p, model_q))
        syndromes[bits_to_string(y)] = {"correction": bits_to_string(table[k]), "best": a["best"],
                                        "second": a["second"], "energy_gap": a["energy_gap"],
                                        "top": a["candidates"][:4],
                                        "occurrences": int((syndrome_index(code, observed) == k).sum())}
    circuit = build_lab_circuit(0.0, 0.0, mode="pauli_frame")
    per_bit = circuit_metrics(circuit.qc)
    resources = {"per_bit": {k: per_bit[k] for k in ("data_qubits", "ancilla_qubits", "total_qubits",
                                                      "two_qubit_gates", "measurements", "depth")},
                 "message_bits": int(n), "concurrent_physical_qubits": per_bit["total_qubits"],
                 "total_two_qubit_gates": per_bit["two_qubit_gates"] * int(n),
                 "total_measurements": per_bit["measurements"] * int(n),
                 "unprotected": {"physical_qubits_per_bit": 1, "measurements_per_bit": 1},
                 "overhead": f"{per_bit['total_qubits']}× qubits per bit (reused sequentially), "
                             f"{per_bit['two_qubit_gates']} CNOTs and {per_bit['measurements']} measurements per bit",
                 "circuit_mode": "pauli_frame (correction applied in software to the Z-basis readout)"}
    return {
        "schema_version": "qec-message-1",
        "input": {"message": text, "p": p.tolist(), "q": q.tolist(), "model_p": model_p.tolist(),
                  "model_q": model_q.tolist(), "decoder": decoder, "seed": seed},
        "bytes": list(data), "bits": bits.tolist(),
        "trace": {"flips": [bits_to_string(r) for r in flips], "readout": [bits_to_string(r) for r in readout],
                  "ideal_syndrome": [bits_to_string(r) for r in ideal],
                  "observed_syndrome": [bits_to_string(r) for r in observed],
                  "correction": [bits_to_string(r) for r in corrections],
                  "residual": [bits_to_string(r) for r in residual], "outcome": outcome.tolist(),
                  "protected": protected.tolist(), "unprotected": unprotected.tolist()},
        "chars": chars,
        "text": {"original": text, "unprotected": unprot_bytes.decode("utf-8", errors="replace"),
                 "protected": prot_bytes.decode("utf-8", errors="replace"),
                 "unprotected_exact": unprot_bytes == data, "protected_exact": prot_bytes == data},
        "stats": {"bits": int(n),
                  "unprotected_bit_errors": proportion(int((unprotected != bits).sum()), int(n)),
                  "protected_bit_errors": proportion(int((protected != bits).sum()), int(n)),
                  "physical_flips": int(flips.sum()), "readout_flips": int(readout.sum()),
                  "blocks_with_errors": int(flips.any(axis=1).sum()),
                  "restored": int((outcome == "restored").sum()),
                  "recoverable_residual": int((outcome == "recoverable_residual").sum()),
                  "logical_failures": int((outcome == "logical_flip").sum()),
                  "char_errors_unprotected": sum(c["unprotected_bit_errors"] > 0 for c in chars),
                  "char_errors_protected": sum(c["protected_bit_errors"] > 0 for c in chars)},
        "decoder_table": syndromes,
        "resources": resources,
        "scientific_boundary": ("Classical bits are stored in computational-basis states |0_L> or |1_L>. This is not "
                                "transmission or copying of an arbitrary unknown quantum state."),
        "provenance": {"kind": "simulation", "streams": describe_streams(seed),
                       "pairing": "unprotected bit i flips iff physical qubit d0 of protected block i flips",
                       "duration_ms": (perf_counter() - started) * 1e3},
    }
