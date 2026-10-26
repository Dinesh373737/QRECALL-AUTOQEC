"""Syndrome-constrained fault-mechanism decoding as an Ising / QUBO problem.

Binary variable ``x_i = 1`` means fault mechanism ``i`` of the detector error model fired.
For independent Bernoulli mechanisms with probabilities ``p_i`` the negative log-likelihood is

    E(x) = sum_i -ln(1 - p_i)  +  sum_i w_i x_i,      w_i = ln((1 - p_i) / p_i)

subject to detector parity  ``sum_{i in N(j)} x_i = s_j (mod 2)`` for every detector ``j``.
The prediction is the observable parity ``sum_i L_i x_i (mod 2)`` of the minimizer, i.e.
most-likely-error (MLE) decoding on the *full hypergraph* (no graphlike decomposition).

Weightings
    ``noise_aware``  w_i = ln((1-p_i)/p_i) from the held-out ``pij`` model of the shot's partition.
    ``uniform``      w_i = 1 on the same hypergraph: fewest mechanisms consistent with the syndrome.

Equivalent forms
    Ising: with spins s_i = 1 - 2 x_i, sum_i w_i x_i = const - 1/2 sum_i w_i s_i and each parity
    constraint is the multi-body condition prod_{i in N(j)} s_i = (-1)^{s_j}.
    QUBO: integer slacks k_j (binary-encoded) give the penalty
    lambda * (sum_{i in N(j)} x_i - 2 k_j - s_j)^2 (see ``qubo``); for lambda above the bound in
    ``penalty_bound`` the QUBO minimizers equal the constrained minimizers.

Solver
    Exact branch-and-bound mixed-integer programming (HiGHS via ``scipy.optimize.milp``) on the
    parity-constrained problem, with a per-shot time limit. A solve that stops at the limit is
    reported as ``time_limit`` (incumbent not proven optimal) or ``failed`` -- never as optimal.
    ``brute_force`` enumerates tiny problems as an independent correctness oracle, and
    ``anneal_qubo`` is a seeded simulated-annealing heuristic used only for the documented
    heuristic-solver ablation.

Formulation precedent: decoding as Ising-model ground-state search (e.g. Fujisaki et al.,
arXiv:2308.00369) and most-likely-error decoding by integer programming. Nothing here is a new
decoding algorithm and nothing runs on quantum hardware.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from functools import cached_property
from itertools import product
from time import perf_counter

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import csr_matrix, hstack, identity, vstack

from .dem import DemGraph

WEIGHTINGS = {
    "noise_aware": "w_i = ln((1-p_i)/p_i) from the held-out pij detector error model",
    "uniform": "w_i = 1 for every mechanism of the same hypergraph (minimum number of mechanisms)",
}


@dataclass
class IsingProblem:
    graph: DemGraph
    weighting: str

    def __post_init__(self):
        if self.weighting not in WEIGHTINGS:
            raise ValueError(f"Unknown weighting '{self.weighting}'.")

    @cached_property
    def weights(self) -> np.ndarray:
        p = self.graph.probabilities
        if self.weighting == "uniform":
            return np.ones_like(p)
        return np.log((1 - p) / p)

    @cached_property
    def constant(self) -> float:
        p = self.graph.probabilities
        return float(-np.sum(np.log1p(-p))) if self.weighting == "noise_aware" else 0.0

    @cached_property
    def _milp_parts(self):
        a = self.graph.check_matrix.astype(np.float64)
        d, m = a.shape
        degree = np.asarray(self.graph.check_matrix.sum(axis=1)).ravel()
        constraint = hstack([a, -2.0 * identity(d, format="csr")]).tocsr()
        cost = np.concatenate([self.weights, np.zeros(d)])
        upper = np.concatenate([np.ones(m), np.floor(degree / 2)])
        return constraint, cost, upper

    def energy(self, x: np.ndarray) -> float:
        return float(self.weights @ np.asarray(x, dtype=np.float64))

    def is_consistent(self, x: np.ndarray, syndrome: np.ndarray) -> bool:
        return bool(np.array_equal(self.graph.symptoms(x), np.asarray(syndrome, dtype=np.int64)))


@dataclass
class Solution:
    status: str  # optimal | time_limit | failed | infeasible
    x: np.ndarray | None
    objective: float | None
    prediction: int | None
    seconds: float
    mip_gap: float | None = None

    @property
    def usable(self) -> bool:
        return self.x is not None and self.status in ("optimal", "time_limit")


def solve(problem: IsingProblem, syndrome: np.ndarray, time_limit: float = 10.0,
          force_observable: int | None = None) -> Solution:
    """Exact MILP minimization of the parity-constrained objective (optionally forcing observable 0)."""
    graph = problem.graph
    s = np.asarray(syndrome, dtype=np.float64)
    constraint, cost, upper = problem._milp_parts
    m = len(graph.mechanisms)
    rows_lo = rows_hi = s
    if force_observable is not None:
        obs_row = graph.observable_matrix[0].astype(np.float64)
        k_max = math.floor(obs_row.sum() / 2)
        d = graph.num_detectors
        constraint = vstack([hstack([constraint, csr_matrix((d, 1))]),
                             csr_matrix(np.concatenate([obs_row, np.zeros(d), [-2.0]])[None, :])]).tocsr()
        cost = np.concatenate([cost, [0.0]])
        upper = np.concatenate([upper, [k_max]])
        rows_lo = rows_hi = np.concatenate([s, [float(force_observable)]])
    started = perf_counter()
    res = milp(cost, constraints=LinearConstraint(constraint, rows_lo, rows_hi),
               integrality=np.ones(cost.size), bounds=Bounds(np.zeros(cost.size), upper),
               options={"time_limit": float(time_limit), "disp": False})
    seconds = perf_counter() - started
    if res.x is None:
        status = "infeasible" if res.status == 2 else "failed"
        return Solution(status, None, None, None, seconds)
    x = np.round(res.x[:m]).astype(np.uint8)
    if not problem.is_consistent(x, syndrome):
        return Solution("failed", None, None, None, seconds)
    status = "optimal" if res.status == 0 else "time_limit"
    gap = getattr(res, "mip_gap", None)
    prediction = int(graph.observable_flip(x)[0]) if graph.num_observables else 0
    return Solution(status, x, problem.energy(x), prediction, seconds, None if gap is None else float(gap))


def decode_with_gap(problem: IsingProblem, syndrome: np.ndarray, time_limit: float = 10.0) -> dict:
    """Best solution plus the best solution constrained to the opposite logical observable."""
    best = solve(problem, syndrome, time_limit)
    out = {"best": best, "complement": None, "gap": None}
    if best.usable and problem.graph.num_observables:
        comp = solve(problem, syndrome, time_limit, force_observable=1 - best.prediction)
        out["complement"] = comp
        if comp.usable and best.status == comp.status == "optimal":
            out["gap"] = comp.objective - best.objective
    return out


def brute_force(problem: IsingProblem, syndrome: np.ndarray, max_mechanisms: int = 22) -> dict:
    """Exhaustive enumeration for tiny problems (independent oracle for tests)."""
    m = len(problem.graph.mechanisms)
    if m > max_mechanisms:
        raise ValueError("Brute force is limited to tiny problems.")
    target = np.asarray(syndrome, dtype=np.int64)
    best: dict[int, tuple[float, tuple]] = {}
    for bits in product((0, 1), repeat=m):
        x = np.array(bits, dtype=np.uint8)
        if not np.array_equal(problem.graph.symptoms(x), target):
            continue
        e = problem.energy(x)
        obs = int(problem.graph.observable_flip(x)[0]) if problem.graph.num_observables else 0
        if obs not in best or e < best[obs][0] - 1e-12:
            best[obs] = (e, bits)
    if not best:
        return {"feasible": False}
    winner = min(best, key=lambda o: best[o][0])
    return {"feasible": True, "objective": best[winner][0], "prediction": winner,
            "x": np.array(best[winner][1], dtype=np.uint8),
            "class_minima": {o: v[0] for o, v in best.items()}}


def penalty_bound(problem: IsingProblem) -> float:
    """A penalty strictly larger than any objective improvement obtainable by violating parity."""
    return float(np.sum(np.abs(problem.weights)) + 1.0)


def qubo(problem: IsingProblem, syndrome: np.ndarray, penalty: float | None = None) -> dict:
    """Dense QUBO ``z^T Q z + offset`` over mechanism bits followed by binary slack bits."""
    graph = problem.graph
    lam = penalty_bound(problem) if penalty is None else float(penalty)
    s = np.asarray(syndrome, dtype=np.int64)
    m = len(graph.mechanisms)
    a = graph.check_matrix.toarray().astype(np.int64)
    slack_index: list[list[int]] = []
    n = m
    for j in range(graph.num_detectors):
        k_max = int(a[j].sum() // 2)
        bits = max(1, math.ceil(math.log2(k_max + 1))) if k_max > 0 else 0
        slack_index.append(list(range(n, n + bits)))
        n += bits
    q = np.zeros((n, n))
    offset = 0.0
    q[np.arange(m), np.arange(m)] += problem.weights
    for j in range(graph.num_detectors):
        coeff = np.zeros(n)
        coeff[:m] = a[j]
        for b, idx in enumerate(slack_index[j]):
            coeff[idx] = -2 * (2 ** b)
        # lam * (coeff . z - s_j)^2 with z binary (z_i^2 = z_i)
        outer = lam * np.outer(coeff, coeff)
        q += np.triu(outer, 1) * 2 + np.diag(np.diag(outer))
        q[np.arange(n), np.arange(n)] += -2 * lam * s[j] * coeff
        offset += lam * s[j] ** 2
    return {"Q": np.triu(q), "offset": offset, "mechanism_variables": m, "slack_variables": n - m,
            "penalty": lam}


def qubo_energy(model: dict, z: np.ndarray) -> float:
    z = np.asarray(z, dtype=np.float64)
    return float(z @ model["Q"] @ z + model["offset"])


def anneal_qubo(model: dict, sweeps: int = 2000, seed: int = 7, t_start: float | None = None,
                t_end: float = 0.05) -> dict:
    """Seeded single-flip Metropolis annealing on a dense QUBO (heuristic; may violate parity)."""
    q = model["Q"]
    sym = q + q.T - np.diag(np.diag(q))
    n = q.shape[0]
    rng = np.random.default_rng(seed)
    z = np.zeros(n)
    diag = np.diag(q)
    t0 = t_start if t_start is not None else max(1.0, float(np.abs(sym).max()))
    temps = np.geomspace(t0, t_end, sweeps)
    field = np.zeros(n)  # sym @ z excluding diagonal
    energy = qubo_energy(model, z)
    best_z, best_e = z.copy(), energy
    for t in temps:
        for i in rng.permutation(n):
            delta = (1 - 2 * z[i]) * (diag[i] + field[i])
            if delta <= 0 or rng.random() < math.exp(-delta / t):
                step = 1 - 2 * z[i]
                z[i] = 1 - z[i]
                field += step * sym[:, i]
                field[i] -= step * sym[i, i]
                energy += delta
                if energy < best_e - 1e-12:
                    best_e, best_z = energy, z.copy()
    return {"z": best_z.astype(np.uint8), "energy": best_e}


def explain_solution(problem: IsingProblem, solution: Solution, coords: dict[int, list[float]] | None = None) -> list[dict]:
    if solution.x is None:
        return []
    rows = []
    for i in np.flatnonzero(solution.x):
        mech = problem.graph.mechanisms[i]
        rows.append({"mechanism": int(i), "detectors": list(mech.detectors), "observables": list(mech.observables),
                     "probability": mech.probability, "weight": float(problem.weights[i]),
                     "hyperedge": len(mech.detectors) > 2,
                     "coordinates": [coords[d] for d in mech.detectors] if coords else None})
    rows.sort(key=lambda r: -r["weight"])
    return rows
