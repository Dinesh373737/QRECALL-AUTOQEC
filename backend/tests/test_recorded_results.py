"""Recorded illustrative claims are replayed from their actual solver configs."""
import json
from pathlib import Path

import pytest

from backend.core.conditioning import build_problem
from backend.core.evaluation import CURATION_SEED, evaluate_experiment, get_presets
from backend.core.hopfield import run_hopfield
from backend.core.quantum import run_quantum
from backend.core.thermal import run_gibbs
import hashlib

ROOT = Path(__file__).resolve().parents[2]


def source_digest():
    """Platform-independent mirror of backend.generate_results.source_digest (POSIX relative paths).

    The generator stringifies paths with the OS separator, so its digest can only match on POSIX systems.
    Hashing the same bytes with POSIX-style paths lets the provenance check run on Windows too.
    """
    paths = sorted((ROOT / "backend" / "core").glob("*.py")) + [ROOT / "backend" / "generate_results.py"]
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.relative_to(ROOT).as_posix().encode())
        digest.update(path.read_bytes())
    return {"algorithm": "SHA256", "value": digest.hexdigest(),
            "files": [path.relative_to(ROOT).as_posix() for path in paths]}


@pytest.mark.parametrize("preset_id", ["easy", "interference", "ambiguous", "quantum-worse"])
def test_curated_claim_is_reproducible_from_real_solvers(preset_id):
    presets = {preset["id"]: preset for preset in get_presets()}
    preset = presets[preset_id]
    config = preset["config"]
    assert not any(key in config for key in ("target", "target_index", "source_index"))
    problem = build_problem(config)
    assert len(problem["free_indices"]) <= 8
    results = {"hopfield": run_hopfield(problem, config), "gibbs": run_gibbs(problem, config), "quantum": run_quantum(problem, config)}
    comparison = evaluate_experiment(problem, config, results, preset["target_index"])
    recorded = preset["verification"]["comparison"]
    for method in results:
        for key in ("final_state", "state_integer", "recovery", "energy_gap", "sample_count"):
            assert comparison["methods"][method][key] == recorded["methods"][method][key]
    assert results["quantum"]["counts"] == preset["verification"]["evidence"]["quantum_counts"]
    if preset_id == "easy":
        assert all(comparison["methods"][method]["recovery"] for method in (*results, "nearest_memory"))
    elif preset_id == "interference":
        target = config["memories"][preset["target_index"]]
        integer = sum(int(target[global_index] == -1) << local for local, global_index in enumerate(problem["free_indices"]))
        assert problem["energies"][integer] > min(problem["energies"]) + 1e-8
    elif preset_id == "ambiguous":
        assert {0, 1}.issubset(comparison["references"]["nearest_memory"]["tied_memory_indices"])
    elif preset_id == "quantum-worse":
        assert comparison["methods"]["hopfield"]["recovery"]
        assert not comparison["methods"]["quantum"]["recovery"]
        assert preset["verification"]["evidence"]["optimizer"]["evaluations"] <= 24


@pytest.mark.parametrize("filename", ["benchmark.json", "benchmark-repeat.json"])
def test_benchmark_evidence_provenance_and_aggregate(filename):
    benchmark = json.loads((ROOT / "results" / filename).read_text())
    assert benchmark["source_digest"] == source_digest(), "Scientific source changed: regenerate recorded results."
    assert benchmark["benchmark_seed"] != CURATION_SEED
    assert benchmark["case_count"] == len(benchmark["cases"]) == 12
    assert not benchmark["definition"]["tuned_on_benchmark"]
    assert all("target_index" not in case["config"] for case in benchmark["cases"])
    assert len({case["config"]["seed"] for case in benchmark["cases"]}) == 12
    assert all(len(case["free_indices"]) <= 8 for case in benchmark["cases"])
    for method, aggregate in benchmark["aggregate"].items():
        entries = [case["comparison"]["methods"][method] for case in benchmark["cases"]]
        assert sum(entry["recovery"] for entry in entries) == aggregate["recovered"]
        assert aggregate["constraint_violation_cases"] == 0
        assert aggregate["runtime_seconds"] >= 0
        if method == "quantum":
            assert aggregate["resources_total"]["optimizer_evaluations"] <= 12 * 24
            assert aggregate["resources_total"]["shots"] == 12 * 1024
            assert aggregate["resources_per_case_range"]["qubits"] == [8, 8]
