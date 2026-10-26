"""Bit-flip repetition codes: parity checks, syndromes and the declared recovery convention.

Conventions (tested in backend/tests/test_qec_core.py):

* Data qubit ``i`` carries bit ``e_i`` of an X-error pattern. Patterns are written
  left-to-right with qubit 0 first, e.g. ``"100"`` is an X error on qubit 0.
* Check ``j`` is the stabilizer ``S_{j+1} = Z_j Z_{j+1}``. Its measured eigenvalue +1
  is syndrome bit 0 and -1 is syndrome bit 1; syndromes are written ``s_1 s_2 ...``.
* Logical recovery is judged on the residual ``r = e XOR e_hat`` after an *ideal*
  final round (noiseless data readout followed by majority vote, the convention of
  memory experiments). ``r = 0`` is exact restoration; ``weight(r) <= (n-1)/2`` keeps
  the logical value recoverable; otherwise the logical bit is flipped.

The bit-flip code detects X (and the X part of Y) errors only. Z errors commute with
every check, leave the syndrome unchanged and act as a logical phase flip.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property

import numpy as np

MIN_DISTANCE = 3
MAX_DISTANCE = 9


def bits_to_string(bits) -> str:
    return "".join(str(int(b)) for b in bits)


def string_to_bits(text: str, width: int) -> np.ndarray:
    if len(text) != width or any(c not in "01" for c in text):
        raise ValueError(f"Expected a {width}-character binary string.")
    return np.array([int(c) for c in text], dtype=np.uint8)


@dataclass(frozen=True)
class RepetitionCode:
    """Distance-n bit-flip repetition code with nearest-neighbour Z_jZ_{j+1} checks."""

    distance: int = 3

    def __post_init__(self):
        if not (MIN_DISTANCE <= self.distance <= MAX_DISTANCE) or self.distance % 2 == 0:
            raise ValueError("Repetition-code distance must be an odd integer between 3 and 9.")

    @property
    def n(self) -> int:
        return self.distance

    @property
    def m(self) -> int:
        return self.distance - 1

    @cached_property
    def parity_check(self) -> np.ndarray:
        h = np.zeros((self.m, self.n), dtype=np.uint8)
        for j in range(self.m):
            h[j, j] = h[j, j + 1] = 1
        h.setflags(write=False)
        return h

    @property
    def stabilizers(self) -> list[dict]:
        return [{"name": f"S{j + 1}", "pauli": f"Z{j} Z{j + 1}", "qubits": [j, j + 1]} for j in range(self.m)]

    @cached_property
    def patterns(self) -> np.ndarray:
        """All 2^n X-error patterns, row k is the binary expansion of k with qubit 0 first."""
        k = np.arange(2 ** self.n)
        shifts = np.arange(self.n - 1, -1, -1)
        table = ((k[:, None] >> shifts[None, :]) & 1).astype(np.uint8)
        table.setflags(write=False)
        return table

    def syndrome(self, errors: np.ndarray) -> np.ndarray:
        """Ideal syndrome ``H e mod 2`` for one pattern (n,) or a batch (N, n)."""
        e = np.asarray(errors, dtype=np.uint8)
        return (e @ self.parity_check.T % 2).astype(np.uint8)

    def stabilizer_values(self, errors: np.ndarray) -> np.ndarray:
        return 1 - 2 * self.syndrome(errors).astype(np.int8)

    def logical_flip(self, residual: np.ndarray) -> np.ndarray | int:
        """Logical X applied after an ideal majority-vote final round."""
        r = np.asarray(residual, dtype=np.uint8)
        flipped = r.sum(axis=-1) > self.n // 2
        return flipped.astype(np.uint8) if flipped.ndim else int(flipped)

    def classify_residual(self, residual) -> str:
        r = np.asarray(residual, dtype=np.uint8)
        if not r.any():
            return "restored"
        return "logical_flip" if self.logical_flip(r) else "recoverable_residual"

    def lookup_table(self) -> dict[str, str]:
        """Minimum-weight X correction for every syndrome, assuming a perfect syndrome."""
        table: dict[str, str] = {}
        weights = self.patterns.sum(axis=1)
        syndromes = self.syndrome(self.patterns)
        for k in np.lexsort((np.arange(len(weights)), weights)):
            key = bits_to_string(syndromes[k])
            table.setdefault(key, bits_to_string(self.patterns[k]))
        return dict(sorted(table.items()))

    def describe(self) -> dict:
        return {"name": f"{self.n}-qubit bit-flip repetition code", "distance": self.n,
                "data_qubits": self.n, "checks": self.m, "parity_check": self.parity_check.tolist(),
                "stabilizers": self.stabilizers, "logical_x": "X" * self.n, "logical_z": "Z0",
                "codewords": {"0": "0" * self.n, "1": "1" * self.n},
                "protects_against": "independent X (bit-flip) errors on at most (n-1)/2 data qubits",
                "does_not_protect_against": "Z (phase) errors: they commute with every Z_jZ_{j+1} check",
                "recovery_convention": ("Residual r = e XOR e_hat after an ideal final round: r = 0 restores the "
                                        "codeword, weight(r) <= (n-1)/2 keeps the logical value recoverable, "
                                        "otherwise the logical bit is flipped.")}
