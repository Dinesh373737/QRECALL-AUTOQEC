"""Hebbian memory and energy functions, independent of HTTP and rendering.

The pixel convention is spin = 1 - 2*bit. The normalization denominator is
always the original number of pixels, including pixels later clamped.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np


def as_spins(values: Sequence[int], n: int | None = None, *, name: str = "spins") -> np.ndarray:
    array = np.asarray(values)
    if array.ndim != 1 or (n is not None and len(array) != n):
        raise ValueError(f"{name} must be a one-dimensional array" + (f" of {n} spins" if n is not None else ""))
    if array.dtype.kind == "b" or any(isinstance(value, (bool, np.bool_)) for value in values) or not np.all(np.isin(array, [-1, 1])):
        raise ValueError(f"{name} must contain only spin values -1 and +1")
    return array.astype(np.int8)


def hebbian_weights(memories: Sequence[Sequence[int]]) -> np.ndarray:
    """Learn W_ij = sum_mu xi_mu[i] xi_mu[j] / n, with W_ii = 0."""
    patterns = np.asarray(memories)
    if patterns.ndim != 2 or patterns.shape[0] == 0 or patterns.shape[1] == 0:
        raise ValueError("memories must contain at least one equally sized, nonempty pattern")
    if patterns.dtype.kind == "b" or any(isinstance(value, (bool, np.bool_)) for memory in memories for value in memory) or not np.all(np.isin(patterns, [-1, 1])):
        raise ValueError("memories must contain only spin values -1 and +1")
    patterns = patterns.astype(np.float64)
    weights = patterns.T @ patterns / patterns.shape[1]
    np.fill_diagonal(weights, 0.0)
    return weights


learn_weights = hebbian_weights


def validate_weights(weights: Sequence[Sequence[float]]) -> np.ndarray:
    matrix = np.asarray(weights, dtype=np.float64)
    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1] or not np.isfinite(matrix).all():
        raise ValueError("weights must be a finite square matrix")
    if not np.allclose(matrix, matrix.T, atol=1e-12, rtol=0.0):
        raise ValueError("weights must be symmetric")
    if not np.allclose(np.diag(matrix), 0.0, atol=1e-12, rtol=0.0):
        raise ValueError("weights must have a zero diagonal")
    return matrix


def energy(weights: Sequence[Sequence[float]], spins: Sequence[int], biases: Sequence[float] | None = None) -> float:
    """Evaluate E(s) = -1/2 s.T W s - b.T s in normalized units."""
    matrix = validate_weights(weights)
    state = as_spins(spins, len(matrix))
    bias = np.zeros(len(matrix), dtype=np.float64) if biases is None else np.asarray(biases, dtype=np.float64)
    if bias.shape != (len(matrix),) or not np.isfinite(bias).all():
        raise ValueError("biases must have one finite value per pixel")
    return float(-0.5 * state @ matrix @ state - bias @ state)


def pair_energy(weights: Sequence[Sequence[float]], spins: Sequence[int], biases: Sequence[float] | None = None) -> float:
    """Independent single-counted pair form, useful for checking the convention."""
    matrix = validate_weights(weights)
    state = as_spins(spins, len(matrix))
    bias = np.zeros(len(matrix), dtype=np.float64) if biases is None else np.asarray(biases, dtype=np.float64)
    if bias.shape != (len(matrix),) or not np.isfinite(bias).all():
        raise ValueError("biases must have one finite value per pixel")
    pairs = sum(matrix[i, j] * int(state[i]) * int(state[j]) for i in range(len(state)) for j in range(i + 1, len(state)))
    return float(-pairs - bias @ state)


def spins_to_bits(spins: Sequence[int]) -> list[int]:
    return ((1 - as_spins(spins)) // 2).tolist()


def bits_to_spins(bits: Sequence[int]) -> list[int]:
    values = np.asarray(bits)
    if values.ndim != 1 or not np.all(np.isin(values, [0, 1])):
        raise ValueError("bits must contain only 0 and 1")
    return (1 - 2 * values.astype(np.int8)).tolist()
