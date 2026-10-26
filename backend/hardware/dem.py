"""Detector error models as weighted fault-mechanism hypergraphs.

Every ``error(p) ...`` instruction of a (flattened) stim DEM is one independent
Bernoulli fault mechanism. Components separated by ``^`` are stim's *suggested*
graphlike decomposition; the mechanism's true symptom set is the XOR of all
components. Mechanisms with identical symptoms (detectors, observables) are merged
with the independent-XOR rule ``p = p1 (1 - p2) + p2 (1 - p1)``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property

import numpy as np
import stim
from scipy.sparse import csr_matrix


@dataclass
class Mechanism:
    probability: float
    detectors: tuple[int, ...]
    observables: tuple[int, ...]
    decomposition: list[tuple[tuple[int, ...], tuple[int, ...]]] = field(default_factory=list)
    merged_lines: int = 1


@dataclass
class DemGraph:
    num_detectors: int
    num_observables: int
    mechanisms: list[Mechanism]

    @classmethod
    def from_text(cls, text: str) -> "DemGraph":
        return cls.from_dem(stim.DetectorErrorModel(text))

    @classmethod
    def from_dem(cls, dem: stim.DetectorErrorModel) -> "DemGraph":
        merged: dict[tuple, Mechanism] = {}
        for inst in dem.flattened():
            if inst.type != "error":
                continue
            p = float(inst.args_copy()[0])
            dets: set[int] = set()
            obs: set[int] = set()
            parts: list[tuple[tuple[int, ...], tuple[int, ...]]] = []
            cur_d: set[int] = set()
            cur_o: set[int] = set()
            for t in inst.targets_copy():
                if t.is_separator():
                    parts.append((tuple(sorted(cur_d)), tuple(sorted(cur_o))))
                    cur_d, cur_o = set(), set()
                    continue
                if t.is_relative_detector_id():
                    dets ^= {t.val}
                    cur_d ^= {t.val}
                elif t.is_logical_observable_id():
                    obs ^= {t.val}
                    cur_o ^= {t.val}
            parts.append((tuple(sorted(cur_d)), tuple(sorted(cur_o))))
            if not dets and not obs:
                continue
            key = (tuple(sorted(dets)), tuple(sorted(obs)))
            if key in merged:
                old = merged[key]
                old.probability = old.probability * (1 - p) + p * (1 - old.probability)
                old.merged_lines += 1
            else:
                merged[key] = Mechanism(p, key[0], key[1], parts if len(parts) > 1 else [])
        mechanisms = sorted(merged.values(), key=lambda m: (m.detectors, m.observables))
        return cls(dem.num_detectors, dem.num_observables, mechanisms)

    @cached_property
    def probabilities(self) -> np.ndarray:
        return np.array([m.probability for m in self.mechanisms], dtype=np.float64)

    @cached_property
    def check_matrix(self) -> csr_matrix:
        rows, cols = [], []
        for i, m in enumerate(self.mechanisms):
            rows.extend(m.detectors)
            cols.extend([i] * len(m.detectors))
        return csr_matrix((np.ones(len(rows), dtype=np.int8), (rows, cols)),
                          shape=(self.num_detectors, len(self.mechanisms)))

    @cached_property
    def observable_matrix(self) -> np.ndarray:
        out = np.zeros((self.num_observables, len(self.mechanisms)), dtype=np.uint8)
        for i, m in enumerate(self.mechanisms):
            for o in m.observables:
                out[o, i] = 1
        return out

    def symptoms(self, selected: np.ndarray) -> np.ndarray:
        x = np.asarray(selected, dtype=np.int64)
        return (self.check_matrix @ x) % 2

    def observable_flip(self, selected: np.ndarray) -> np.ndarray:
        return (self.observable_matrix.astype(np.int64) @ np.asarray(selected, dtype=np.int64)) % 2

    def summary(self) -> dict:
        sizes = np.array([len(m.detectors) for m in self.mechanisms])
        p = self.probabilities
        return {"mechanisms": len(self.mechanisms), "detectors": self.num_detectors,
                "observables": self.num_observables,
                "hyperedges": int(np.sum(sizes > 2)), "boundary_or_single": int(np.sum(sizes == 1)),
                "graphlike": int(np.sum(sizes == 2)),
                "undetectable_logical": int(sum(1 for m in self.mechanisms if not m.detectors and m.observables)),
                "probability_min": float(p.min()) if p.size else None,
                "probability_median": float(np.median(p)) if p.size else None,
                "probability_max": float(p.max()) if p.size else None}


def detector_coordinates(circuit_text: str) -> dict[int, list[float]]:
    circuit = stim.Circuit(circuit_text)
    return {int(k): [float(c) for c in v] for k, v in circuit.get_detector_coordinates().items()}


def qubit_coordinates(circuit_text: str) -> dict[int, list[float]]:
    circuit = stim.Circuit(circuit_text)
    return {int(k): [float(c) for c in v] for k, v in circuit.get_final_qubit_coordinates().items()}
