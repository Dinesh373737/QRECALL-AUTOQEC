"""Generate real curated illustrations and an independent small benchmark.

Run from the repository root: .venv/bin/python -m backend.generate_results
Presets are searched only with CURATION_SEED. The benchmark uses a different
seed and is never searched for, filtered or used to change the parameters.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np

from .core.conditioning import build_problem
from .core.evaluation import BENCHMARK_SEED, CURATION_SEED, benchmark_csv, evaluate_experiment, run_benchmark
from .core.hopfield import run_hopfield
from .core.quantum import optimize_angles, run_quantum
from .core.thermal import run_gibbs
from .schemas import ExperimentConfig

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "results"
DEMO_MEMORIES = [
    [-1, 1, 1, -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, -1, -1, 1],
    [1, 1, 1, -1, 1, -1, -1, 1, 1, 1, 1, -1, 1, -1, -1, 1],
    [1, 1, 1, 1, 1, -1, -1, -1, 1, -1, -1, -1, 1, 1, 1, 1],
]


def base_config(memories, cue, seed, rows=2, cols=4, mode="erasure"):
    return ExperimentConfig(rows=rows, cols=cols, memories=memories, cue=cue, seed=seed,
                            mode=mode, temperature=0.45, cue_strength=0.25,
                            shots=1024, samples=256, burn_in=24, thinning=1).model_dump()


def evaluate(config, target_index, optimize=True):
    problem = build_problem(config)
    quantum = optimize_angles(problem, config, evaluation_budget=24) if optimize else run_quantum(problem, config)
    config = {**config, "gammas": quantum["gammas"], "betas": quantum["betas"]}
    results = {"hopfield": run_hopfield(problem, config), "gibbs": run_gibbs(problem, config), "quantum": quantum}
    comparison = evaluate_experiment(problem, config, results, target_index)
    return config, comparison, {"quantum_counts": quantum["counts"],
                                "optimizer": quantum.get("optimization"),
                                "optimizer_history": quantum.get("optimizer_history", []),
                                "minimum_energy": problem["minimum_energy"],
                                "ground_states": problem["ground_states"], "free_indices": problem["free_indices"]}


def preset(id, label, description, config, target_index, claim, evidence, comparison, search_trials):
    return {"id": id, "label": label, "description": description, "config": config, "target_index": target_index,
            "verified_claim": claim, "verification": {"curation_seed": CURATION_SEED, "search_trials": search_trials,
                "created_utc": datetime.now(timezone.utc).isoformat(), "evidence": evidence, "comparison": comparison,
                "purpose": "curated explanatory illustration; excluded from independent benchmark"}}


def generate_presets():
    rng = np.random.default_rng(CURATION_SEED)
    presets = []
    # The first successful mask in a reproducible search, rather than a claim
    # about every cue or a substituted minimum-energy shot.
    for trial in range(1, 49):
        mask = sorted(rng.choice(16, 6, replace=False).tolist())
        cue = [None if index in mask else spin for index, spin in enumerate(DEMO_MEMORIES[0])]
        config = base_config(DEMO_MEMORIES, cue, int(rng.integers(2**32)), rows=4, cols=4)
        config, comparison, evidence = evaluate(config, 0)
        if all(comparison["methods"][method]["recovery"] for method in ("nearest_memory", "hopfield", "gibbs", "quantum")):
            presets.append(preset("easy", "Easy recall", "A trusted 4×4 cue with six erased pixels recovers the source under all three displayed methods.",
                                  config, 0, "Nearest memory, Hopfield, Gibbs mode and QAOA sample mode recover the source for this recorded seed.", evidence, comparison, trial))
            break
    else:
        raise RuntimeError("no easy illustration found inside the documented search budget")
    print("Verified easy recall", flush=True)

    # Discover genuine memory interference: the source has a worse conditioned
    # energy than the exact optimum despite all observed pixels being trusted.
    interference = None
    for trial in range(1, 2001):
        memories = np.unique(rng.choice([-1, 1], size=(5, 8)), axis=0).tolist()
        if len(memories) < 3:
            continue
        target_index = int(rng.integers(len(memories)))
        mask = rng.choice(8, 5, replace=False).tolist()
        cue = [None if index in mask else spin for index, spin in enumerate(memories[target_index])]
        config = base_config(memories, cue, int(rng.integers(2**32)))
        problem = build_problem(config)
        target_integer = sum(int(memories[target_index][g] == -1) << a for a, g in enumerate(problem["free_indices"]))
        target_gap = problem["energies"][target_integer] - min(problem["energies"])
        if target_gap > 1e-8:
            config, comparison, evidence = evaluate(config, target_index)
            evidence["source_energy_gap"] = target_gap
            interference = preset("interference", "Memory interference", "The shared Hebbian model prefers a state other than the generating memory; a lower energy can mean worse recall.",
                                  config, target_index, f"The source is {target_gap:.3f} normalized energy units above the exact conditioned minimum.", evidence, comparison, trial)
            presets.append(interference)
            break
    if interference is None:
        raise RuntimeError("no interference found within the documented search budget")
    print("Verified energy-model interference", flush=True)

    # A cue shared by two similar bank entries provably cannot identify which
    # source generated it. Lowest-bank-index resolution remains visible.
    difference = [index for index in range(16) if DEMO_MEMORIES[0][index] != DEMO_MEMORIES[1][index]]
    cue = [None if index in difference else spin for index, spin in enumerate(DEMO_MEMORIES[0])]
    config = base_config(DEMO_MEMORIES, cue, int(rng.integers(2**32)), rows=4, cols=4)
    config, comparison, evidence = evaluate(config, 1)
    ties = comparison["references"]["nearest_memory"]["tied_memory_indices"]
    if not {0, 1}.issubset(ties):
        raise RuntimeError("ambiguous cue did not preserve the expected observation tie")
    evidence["tied_memory_indices"] = ties
    presets.append(preset("ambiguous", "Ambiguous cue", "The observed pixels are shared by two stored memories; the cue cannot reveal the generating identity.",
                          config, 1, "Stored memories 0 and 1 tie exactly on every available observation; no target-based tie resolution is used.", evidence, comparison, 1))
    print("Verified cue ambiguity", flush=True)

    # An honest bounded optimizer can minimize energy without improving source
    # recovery. Search seeds only for this illustration; none are benchmark seeds.
    for trial in range(1, 97):
        memories = np.unique(rng.choice([-1, 1], size=(3, 8)), axis=0).tolist()
        target_index = int(rng.integers(len(memories)))
        cue = list(memories[target_index])
        for pixel in rng.choice(8, 1, replace=False):
            cue[int(pixel)] *= -1
        config = base_config(memories, cue, int(rng.integers(2**32)), mode="noisy")
        problem = build_problem(config)
        classical = run_hopfield(problem, config)
        if classical["output"] != memories[target_index]:
            continue
        config, comparison, evidence = evaluate(config, target_index)
        if comparison["methods"]["hopfield"]["recovery"] and not comparison["methods"]["quantum"]["recovery"]:
            presets.append(preset("quantum-worse", "Quantum worse", "For this soft noisy cue, Hopfield recovers the source and the bounded depth-one QAOA mode does not.",
                                  config, target_index, "Hopfield recovers the source; modal QAOA recall fails after 24 ideal-energy objective evaluations for this recorded seed.", evidence, comparison, trial))
            break
    else:
        raise RuntimeError("no quantum-worse illustration found inside the documented search budget")
    print("Verified bounded-QAOA recall counterexample", flush=True)
    return presets


def source_digest():
    paths = sorted((ROOT / "backend" / "core").glob("*.py")) + [ROOT / "backend" / "generate_results.py"]
    digest = hashlib.sha256()
    for path in paths:
        digest.update(str(path.relative_to(ROOT)).encode())
        digest.update(path.read_bytes())
    return {"algorithm": "SHA256", "value": digest.hexdigest(), "files": [str(path.relative_to(ROOT)) for path in paths]}


def main():
    OUTPUT.mkdir(exist_ok=True)
    presets = generate_presets()
    (OUTPUT / "presets.json").write_text(json.dumps(presets, indent=2) + "\n")
    # The benchmark bank is the UI's bank, with a fixed eight-erasure channel.
    # This definition is set before seeing any benchmark outcome.
    cue = [None if index in [1, 4, 5, 6, 9, 10, 11, 14] else spin for index, spin in enumerate(DEMO_MEMORIES[0])]
    config = base_config(DEMO_MEMORIES, cue, 42, rows=4, cols=4)
    benchmark = run_benchmark(config, cases=12, benchmark_seed=BENCHMARK_SEED, evaluation_budget=24,
                              progress_callback=lambda progress: print(f"Benchmark {progress['completed_cases']}/12", flush=True))
    benchmark["source_digest"] = source_digest()
    (OUTPUT / "benchmark.json").write_text(json.dumps(benchmark, indent=2) + "\n")
    (OUTPUT / "benchmark.csv").write_text(benchmark_csv(benchmark))
    # A second independent seed repeats the same preregistered budget/channel;
    # no configurations are selected based on either result.
    repeat = run_benchmark(deepcopy(config), cases=12, benchmark_seed=BENCHMARK_SEED + 1, evaluation_budget=24,
                           progress_callback=lambda progress: print(f"Repeat benchmark {progress['completed_cases']}/12", flush=True))
    repeat["source_digest"] = source_digest()
    (OUTPUT / "benchmark-repeat.json").write_text(json.dumps(repeat, indent=2) + "\n")
    (OUTPUT / "benchmark-repeat.csv").write_text(benchmark_csv(repeat))
    print(json.dumps({"first": benchmark["aggregate"], "independent_repeat": repeat["aggregate"]}, indent=2), flush=True)


if __name__ == "__main__":
    main()
