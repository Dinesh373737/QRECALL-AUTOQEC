"""HTTP routes for QRecall AutoQEC: Module 1 (QEC Studio) and Module 2 (Google Hardware Analyzer)."""
from __future__ import annotations

import csv
import io
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
from threading import Event, Lock
from time import perf_counter
from uuid import uuid4

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from .hardware import advisor as hw_advisor
from .hardware import dataset as ds
from .hardware import explanations as hw_explain
from .hardware import matching as hw_matching
from .hardware import summary as hw_summary
from .hardware.benchmarks import score
from .hardware.dem import DemGraph
from .qec import benchmarks as sim_bench
from .qec import optimizer as opt
from .qec.circuits import PRESETS, STAGE_TEXT, build_lab_circuit, circuit_metrics, describe_operations, \
    step_through, transpile_for_target
from .qec.codes import RepetitionCode, bits_to_string, string_to_bits
from .qec.decoders import DECODERS, decision_table
from .qec.experiment import run_trial
from .qec.likelihood import candidate_analysis, strip_private
from .qec.message import run_message
from .qec_schemas import (AdvisorRequest, AnalyzeRequest, CircuitRequest, JobInfo, LabTrialRequest, MessageRequest,
                          OptimizerEvaluateRequest, OptimizerRankRequest, ReproduceRequest, SimBenchRequest)

router = APIRouter(prefix="/api")
RESULTS = ds.REPO_ROOT / "results"
PACKAGES = ("numpy", "scipy", "qiskit", "qiskit-aer", "stim", "pymatching", "fastapi", "pydantic")
VERSIONS = {p: version(p) for p in PACKAGES}


# ------------------------------------------------------------------------------------------- jobs

class Jobs:
    def __init__(self, workers: int = 2):
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="autoqec-job")
        self.lock = Lock()
        self.jobs: dict[str, dict] = {}

    def submit(self, kind: str, fn, *args) -> dict:
        job_id = uuid4().hex
        cancel = Event()
        with self.lock:
            active = sum(j["status"] in ("queued", "running") for j in self.jobs.values())
            if active >= 6:
                raise HTTPException(429, "Six jobs are already queued or running. Wait or cancel one.")
            if len(self.jobs) > 64:
                for key in [k for k, j in self.jobs.items() if j["status"] in ("completed", "failed", "cancelled")][:16]:
                    del self.jobs[key]
            self.jobs[job_id] = {"id": job_id, "kind": kind, "status": "queued", "progress": 0.0, "phase": "Queued",
                                 "created_at": datetime.now(timezone.utc).isoformat(), "result": None, "error": None,
                                 "_cancel": cancel}

        def progress(fraction, phase="Running"):
            with self.lock:
                self.jobs[job_id].update(progress=float(max(0, min(1, fraction))), phase=phase)

        def run():
            with self.lock:
                if cancel.is_set():
                    self.jobs[job_id].update(status="cancelled", phase="Cancelled")
                    return
                self.jobs[job_id].update(status="running", phase="Running")
            try:
                result = fn(*args, progress=progress, cancel=cancel.is_set)
                with self.lock:
                    status = "cancelled" if cancel.is_set() else "completed"
                    self.jobs[job_id].update(status=status, progress=1.0, phase=status.title(),
                                             result=None if cancel.is_set() else result)
            except InterruptedError:
                with self.lock:
                    self.jobs[job_id].update(status="cancelled", phase="Cancelled")
            except Exception as exc:  # reported, never fabricated
                with self.lock:
                    self.jobs[job_id].update(status="failed", phase="Failed",
                                             error={"code": "job_failed", "message": str(exc)})

        self.pool.submit(run)
        return self.public(job_id)

    def public(self, job_id: str) -> dict:
        with self.lock:
            if job_id not in self.jobs:
                raise HTTPException(404, "Job not found. Jobs live in memory and expire on restart.")
            return {k: v for k, v in self.jobs[job_id].items() if not k.startswith("_")}

    def cancel(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                raise HTTPException(404, "Job not found.")
            job["_cancel"].set()
            if job["status"] == "queued":
                job.update(status="cancelled", phase="Cancelled")
        return self.public(job_id)

    def result(self, job_id: str, kind: str) -> dict:
        job = self.public(job_id)
        if job["kind"] != kind or job["status"] != "completed":
            raise HTTPException(409, f"A completed {kind} job is required.")
        return job["result"]


jobs = Jobs()


@router.get("/qec/jobs/{job_id}", response_model=JobInfo)
def job_status(job_id: str):
    return jobs.public(job_id)


@router.delete("/qec/jobs/{job_id}", response_model=JobInfo)
def job_cancel(job_id: str):
    return jobs.cancel(job_id)


def _recorded(path, missing: str) -> dict:
    if not path.exists():
        raise HTTPException(404, missing)
    content = path.read_bytes()
    data = json.loads(content)
    data["artifact"] = {"path": str(path.relative_to(ds.REPO_ROOT)).replace("\\", "/"),
                        "sha256": sha256(content).hexdigest(), "execution_mode": "recorded replay"}
    return data


# ----------------------------------------------------------------------------------- Module 1

@router.get("/qec/info")
def qec_info():
    return {"code": RepetitionCode(3).describe(), "decoders": DECODERS, "presets": list(PRESETS) + ["custom"],
            "stages": STAGE_TEXT, "syndrome_table": {"000": "00", "100": "10", "010": "11", "001": "01"},
            "lookup_table": RepetitionCode(3).lookup_table(), "versions": VERSIONS}


@router.post("/qec/lab/trial")
def lab_trial(req: LabTrialRequest):
    return run_trial(req.model_dump())


@router.post("/qec/lab/analyze")
def lab_analyze(req: AnalyzeRequest):
    code = RepetitionCode(req.distance)
    y = string_to_bits(req.syndrome, code.m)
    actual = None if req.actual_error is None else string_to_bits(req.actual_error, code.n)
    analysis = candidate_analysis(code, y, req.p, req.q, actual_error=actual)
    from .qec.decoders import decode
    decisions = {name: decode(code, name, y, analysis["p"], analysis["q"]) for name in DECODERS
                 if not (name == "exact" and code.n > 7)}
    from .qec.explain import explain, sensitivity
    return {"code": code.describe(), "analysis": strip_private(analysis), "decisions": decisions,
            "explanation": explain(code, analysis, "energy", analysis["best"], analysis["p"], analysis["q"]),
            "sensitivity": sensitivity(code, y, analysis["p"], analysis["q"], points=41) if code.n <= 5 else None,
            "provenance": {"kind": "exact enumeration", "candidates": 2 ** code.n}}


@router.post("/qec/message")
def message(req: MessageRequest):
    return run_message(req.model_dump())


@router.post("/qec/circuit")
def circuit(req: CircuitRequest):
    started = perf_counter()
    code = RepetitionCode(3)
    theta, phi = (req.theta, req.phi) if req.state == "custom" else PRESETS[req.state]
    p, q = [max(req.p, 1e-3)] * 3, [req.q] * 2
    table_arr = decision_table(code, req.decoder, p, q)
    table = {bits_to_string([(k >> 1) & 1, k & 1]): bits_to_string(r) for k, r in enumerate(table_arr)}
    x = string_to_bits(req.x_errors, 3)
    observed = code.syndrome(x) ^ string_to_bits(req.readout_flips, 2)
    correction = table[bits_to_string(observed)]
    c = build_lab_circuit(theta, phi, req.x_errors, req.z_errors, req.readout_flips, table, req.mode)
    steps = step_through(c, req.seed)
    transpiled = transpile_for_target(c.qc, req.optimization_level, req.seed, req.coupling)
    from qiskit_aer import AerSimulator
    counts = AerSimulator().run(c.qc, shots=512, seed_simulator=req.seed).result().get_counts()
    return {"input": req.model_dump(), "theta": theta, "phi": phi, "decision_table": table,
            "observed_syndrome": bits_to_string(observed), "correction": correction,
            "residual": bits_to_string(x ^ string_to_bits(correction, 3)),
            "operations": describe_operations(c), "metrics": circuit_metrics(c.qc), "steps": steps,
            "qubits": ["d0", "d1", "d2", "a0", "a1"], "clbits": list(steps[-1]["classical"]),
            "stage_text": STAGE_TEXT, "transpiled": transpiled,
            "aer_cross_check": {"shots": 512, "seed": req.seed, "counts": counts,
                                "key_format": "registers right-to-left as declared (syn rightmost), bit 0 rightmost"},
            "frame_note": ("Physical mode applies X gates inside if_test blocks (classical feed-forward). Pauli-frame "
                           "mode applies no gates: the correction is tracked classically and applied to the readout."),
            "qasm_note": "Generated with Qiskit; metrics recurse into control-flow blocks.",
            "provenance": {"kind": "simulation", "engine": "Qiskit Statevector + Aer", "versions": VERSIONS,
                           "duration_ms": (perf_counter() - started) * 1e3}}


_evaluations: dict[str, dict] = {}


def _optimizer_job(cfg: dict, progress=None, cancel=None):
    result = opt.evaluate(cfg, progress, cancel)
    key = sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()[:16]
    _evaluations[key] = result
    while len(_evaluations) > 8:
        del _evaluations[next(iter(_evaluations))]
    return {"evaluation_id": key, "summary": {k: result[k] for k in ("unique_candidates", "grid_size",
                                                                      "duration_seconds")}}


@router.post("/qec/optimizer/evaluate", response_model=JobInfo, status_code=202)
def optimizer_evaluate(req: OptimizerEvaluateRequest):
    return jobs.submit("optimizer", _optimizer_job, req.model_dump())


def _recorded_optimizer(target: str) -> dict:
    return _recorded(RESULTS / "qec" / f"optimizer_{target}.json",
                     "Recorded optimizer evaluation missing; run python -m backend.generate_qec_results.")


@router.post("/qec/optimizer/rank")
def optimizer_rank(req: OptimizerRankRequest):
    if req.evaluation_id:
        evaluation = _evaluations.get(req.evaluation_id)
        if evaluation is None:
            raise HTTPException(404, "Evaluation expired; evaluate again.")
    else:
        evaluation = _recorded_optimizer(req.recorded or "h7")
    ranking = opt.rank(evaluation, req.weights, {k: v for k, v in req.limits.items()}, req.conservative)
    return {"evaluation": {k: v for k, v in evaluation.items() if k != "candidates"},
            "candidates_detail": {c["id"]: {"settings": c["settings"], "verification": c["verification"],
                                            "ops": c["ops"], "active_physical_qubits": c["active_physical_qubits"],
                                            "measurements": c["measurements"], "resets": c["resets"],
                                            "family_text": c["family_text"]} for c in evaluation["candidates"]},
            **ranking}


def _sim_job(cfg: dict, progress=None, cancel=None):
    if progress:
        progress(0.1, "Simulating seeded trials")
    return sim_bench.run_all(cfg)


@router.post("/qec/benchmarks/run", response_model=JobInfo, status_code=202)
def sim_run(req: SimBenchRequest):
    return jobs.submit("simulation_benchmark", _sim_job, req.model_dump())


@router.get("/qec/benchmarks/recorded")
def sim_recorded():
    return _recorded(RESULTS / "qec" / "simulation_benchmark.json",
                     "Recorded simulation benchmark missing; run python -m backend.generate_qec_results.")


def _csv(rows: list[dict], name: str) -> Response:
    buf = io.StringIO()
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/qec/benchmarks/recorded/csv")
def sim_recorded_csv():
    return _csv(sim_bench.to_csv_rows(sim_recorded()), "autoqec-simulation-benchmark.csv")


@router.get("/qec/benchmarks/jobs/{job_id}/csv")
def sim_job_csv(job_id: str):
    return _csv(sim_bench.to_csv_rows(jobs.result(job_id, "simulation_benchmark")), "autoqec-simulation-run.csv")


# ----------------------------------------------------------------------------------- Module 2

def _catalog():
    try:
        return ds.catalog()
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc))


@router.get("/google/status")
def google_status():
    status = ds.dataset_status()
    status["results"] = {name: (RESULTS / "google" / name).exists()
                         for name in ("baseline.json", "ising.json", "archive_verification.json")}
    return status


def _headlines() -> dict:
    path = RESULTS / "google" / "baseline.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    out = {}
    for res in data["experiments"]:
        m = res["methods"]
        out[res["experiment"]["id"]] = {k: {"rate": v["rate"], "ci95": v["ci95"], "count": v["count"],
                                            "trials": v["trials"]} for k, v in m.items()}
    return out


@router.get("/google/experiments")
def google_experiments():
    cat = _catalog()
    heads = _headlines()
    rows = []
    for exp in cat.experiments():
        rows.append({**exp.summary(), "results": heads.get(exp.id)})
    return {"layout": cat.layout, "count": len(rows), "experiments": rows,
            "label": "Google Quantum AI experimental data" + (" (deployable subset)" if cat.layout == "subset" else ""),
            "doi": ds.DOI}


@router.get("/google/experiments/{experiment_id}")
def google_experiment(experiment_id: str):
    cat = _catalog()
    try:
        exp = cat.get(experiment_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc))
    dems = {kind: DemGraph.from_text(exp.dem_text(kind)).summary() for kind in ds.DEM_FILES}
    return {"experiment": exp.summary(), "properties": exp.properties, "dems": dems,
            "dem_files": ds.DEM_FILES, "geometry": hw_explain.geometry(experiment_id),
            "files": exp.meta.get("files") if exp.meta else None,
            "source_sha256": exp.meta.get("source_sha256") if exp.meta else None,
            "results": _headlines().get(experiment_id),
            "provenance": {"doi": ds.DOI, "layout": cat.layout, "experiment_dir": experiment_id}}


@router.get("/google/experiments/{experiment_id}/layout.svg")
def google_layout(experiment_id: str):
    exp = _catalog().get(experiment_id)
    svg = exp.layout_svg()
    if svg is None:
        raise HTTPException(404, "No layout diagram for this experiment.")
    return Response(svg, media_type="image/svg+xml",
                    headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
                             "X-Content-Type-Options": "nosniff"})


@router.get("/google/experiments/{experiment_id}/shots")
def google_shots(experiment_id: str, category: str = "disagreement", limit: int = 200):
    if limit < 1 or limit > 2000:
        raise HTTPException(422, "limit must be between 1 and 2000")
    _catalog().get(experiment_id)
    return hw_explain.find_shots(experiment_id, category, limit)


@router.get("/google/experiments/{experiment_id}/shots/{shot}")
def google_shot(experiment_id: str, shot: int, live_ising: bool = True):
    try:
        return hw_explain.shot_evidence(experiment_id, shot, live_ising)
    except KeyError as exc:
        raise HTTPException(404, str(exc))


def _strip_per_shot(entry: dict) -> dict:
    return {k: v for k, v in entry.items() if k != "per_shot"}


@router.get("/google/benchmarks/baseline")
def google_baseline():
    return _recorded(RESULTS / "google" / "baseline.json",
                     "Baseline missing; run python -m backend.hardware.pipeline baseline.")


@router.get("/google/benchmarks/ising")
def google_ising(per_shot: bool = False):
    data = _recorded(RESULTS / "google" / "ising.json",
                     "Ising benchmark missing; run python -m backend.hardware.pipeline ising.")
    if not per_shot:
        data["experiments"] = [_strip_per_shot(e) for e in data["experiments"]]
    return data


@router.get("/google/benchmarks/summary")
def google_summary():
    return {"baseline": hw_summary.baseline_summary(), "ising": hw_summary.ising_summary()}


@router.get("/google/benchmarks/baseline/csv")
def google_baseline_csv():
    path = RESULTS / "google" / "baseline.csv"
    if not path.exists():
        raise HTTPException(404, "Baseline CSV missing.")
    return Response(path.read_bytes(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="autoqec-google-baseline.csv"'})


@router.get("/google/benchmarks/ising/csv")
def google_ising_csv():
    data = google_ising()
    rows = []
    for e in data["experiments"]:
        info = e["experiment"]
        for method, m in e["methods"].items():
            rows.append({"experiment": info["id"], "distance": info["distance"], "basis": info["basis"],
                         "rounds": info["rounds"], "method": method, "shots": m["trials"], "failures": m["count"],
                         "rate": m["rate"], "ci_low": m["ci95"][0], "ci_high": m["ci95"][1],
                         "median_us": (m.get("runtime") or {}).get("median_us")})
    return _csv(rows, "autoqec-google-ising.csv")


def _reproduce_job(experiment_id: str, max_shots: int | None, progress=None, cancel=None):
    exp = ds.catalog().get(experiment_id)
    n = exp.available_detection_shots if max_shots is None else min(max_shots, exp.available_detection_shots)
    if progress:
        progress(0.1, f"Decoding {n} real shots with PyMatching")
    dets = exp.detection_events(n, packed=True)
    actual = exp.observable_flips()[:n]
    out = hw_matching.partitioned_predictions(exp, "pymatching_circuit", dets)
    google = exp.google_predictions().get("pymatching")
    disagree = int(np.sum(out["predictions"] != google[:n])) if google is not None else None
    return {"experiment": exp.summary(), "shots": n, "layout": exp.layout,
            "ours": score(out["predictions"], actual), "google_pymatching": score(google[:n], actual)
            if google is not None else None, "disagreements_with_google": disagree,
            "reproduced": disagree == 0, "per_shot_us": out["per_shot_us"],
            "configuration": "PyMatching with circuit_detector_error_model.dem for every shot (Google's setup)",
            "versions": VERSIONS}


@router.post("/google/reproduce", response_model=JobInfo, status_code=202)
def google_reproduce(req: ReproduceRequest):
    _catalog().get(req.experiment)
    return jobs.submit("reproduce", _reproduce_job, req.experiment, req.max_shots)


@router.post("/google/advisor")
def google_advisor(req: AdvisorRequest):
    try:
        return hw_advisor.recommend(req.model_dump())
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc))


@router.get("/google/advisor/configurations")
def google_configurations():
    try:
        return {"configurations": hw_advisor.configurations()}
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc))


# ----------------------------------------------------------------------------------- provenance

@router.get("/provenance")
def provenance():
    artifacts = []
    for path in sorted(RESULTS.rglob("*")):
        if path.is_file() and path.suffix in (".json", ".csv") and ("qec" in path.parts or "google" in path.parts):
            artifacts.append({"path": str(path.relative_to(ds.REPO_ROOT)).replace("\\", "/"),
                              "bytes": path.stat().st_size, "sha256": sha256(path.read_bytes()).hexdigest()})
    return {"versions": VERSIONS, "dataset": ds.dataset_status(), "artifacts": artifacts,
            "claims": {"quantum_advantage": "not claimed", "hardware_speedup": "not claimed",
                       "novel_decoder": "not claimed: energy/Ising and matching decoders are prior work",
                       "module_1_data": "simulation", "module_2_data": "Google experimental measurements"}}
