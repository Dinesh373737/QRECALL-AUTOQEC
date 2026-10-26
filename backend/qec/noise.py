"""Seeded, independent Bernoulli data-flip and syndrome-readout noise.

Each seed is expanded with ``numpy.random.SeedSequence`` into separate child streams
for data errors, readout errors and auxiliary draws, so changing the readout
probability never changes which data qubits flip for the same seed.
"""
from __future__ import annotations

import numpy as np

STREAMS = ("data", "readout", "aux")


def streams(seed: int) -> dict[str, np.random.Generator]:
    if not 0 <= int(seed) <= 2**32 - 1:
        raise ValueError("Seeds must be integers between 0 and 2^32 - 1.")
    children = np.random.SeedSequence(int(seed)).spawn(len(STREAMS))
    return {name: np.random.Generator(np.random.PCG64(child)) for name, child in zip(STREAMS, children)}


def bernoulli(rng: np.random.Generator, probs: np.ndarray, shots: int) -> np.ndarray:
    """(shots, len(probs)) uint8 flips; one uniform draw per entry keeps streams aligned."""
    p = np.asarray(probs, dtype=np.float64)
    return (rng.random((int(shots), p.size)) < p[None, :]).astype(np.uint8)


def describe_streams(seed: int) -> dict:
    return {"seed": int(seed), "generator": "numpy PCG64 via SeedSequence(seed).spawn(3)",
            "streams": list(STREAMS),
            "note": "Data and readout flips use independent child streams; one uniform draw per qubit per shot."}
