"""Local FastAPI boundary and cooperative background jobs for QRecall."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
import json
import logging
from pathlib import Path
from threading import Event, Lock
from time import perf_counter, monotonic
from uuid import uuid4

from fastapi import FastAPI, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from .schemas import ExperimentConfig, ExperimentResult, EvaluateRequest, JobRequest, JobResponse, ExportRequest, ExportResponse
from .core.conditioning import build_problem
from .core.hopfield import run_hopfield
from .core.thermal import run_gibbs
from .core.quantum import run_quantum, optimize_angles, CancelledComputation
from .core.diagnostics import experiment_diagnostics
from .core.evaluation import evaluate_experiment, reference_results, run_benchmark, get_presets, benchmark_csv
from .qec_api import router as autoqec_router

logger = logging.getLogger("qrecall")
logging.basicConfig(level=logging.INFO, format="%(message)s")
logging.getLogger("qiskit").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(_app):
    from .hardware import explanations
    explanations.warm_pool()  # spawn the live-solver worker processes in the background
    # Shutdown cooperates with the same cancellation checks as the user button.
    yield
    with job_lock:
        for job in jobs.values():
            if job["status"] in ("queued", "running"):
                job["cancel"].set()
    executor.shutdown(wait=False, cancel_futures=True)
    from .hardware import explanations
    if explanations._pool is not None:
        explanations._pool.shutdown(wait=False, cancel_futures=True)


app = FastAPI(title="QRecall AutoQEC scientific API", version="2.0", docs_url="/api/docs", openapi_url="/api/openapi.json", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "X-Request-ID"])

PACKAGES = ("numpy", "scipy", "qiskit", "qiskit-aer", "stim", "pymatching", "fastapi", "pydantic")
VERSIONS = {name: version(name) for name in PACKAGES}
executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="qrecall-job")
job_lock = Lock()
jobs: dict[str, dict] = {}
RECORDED_BENCHMARK = Path(__file__).resolve().parent.parent / "results" / "benchmark.json"
RECORDED_BENCHMARK_CSV = Path(__file__).resolve().parent.parent / "results" / "benchmark.csv"
# JSON string escaping adds overhead to the 32 MiB downloadable file content.
EXPORT_BODY_LIMIT_BYTES = 40 * 1024 * 1024
EXPORT_CACHE_LIMIT = 16
EXPORT_TTL_SECONDS = 15 * 60
export_lock = Lock()
exports: dict[str, dict] = {}


def config_hash(config: dict) -> str:
    # Revision tracks presentation freshness; it does not alter the physical model.
    physical = {k: v for k, v in config.items() if k != "revision"}
    return sha256(json.dumps(physical, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()[:20]


def _error(code: str, message: str, request_id: str, field: str | None = None,
           hint: str = "Correct the configuration and try again.") -> dict:
    return {"error": {"code": code, "message": message, "field": field,
                      "hint": hint, "request_id": request_id}}


@app.middleware("http")
async def request_context(request: Request, call_next):
    started = perf_counter()
    request.state.request_id = uuid4().hex
    if request.method == "POST":
        limit = EXPORT_BODY_LIMIT_BYTES if request.url.path == "/api/exports" else 262144
        limit_message = "Export requests are limited to 40 MiB." if request.url.path == "/api/exports" else "JSON requests are limited to 256 KiB."
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > limit):
            return JSONResponse(_error("input_too_large", limit_message, request.state.request_id), status_code=413)
        body = await request.body()
        if len(body) > limit:
            return JSONResponse(_error("input_too_large", limit_message, request.state.request_id), status_code=413)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    logger.info(json.dumps({"event": "request", "request_id": request.state.request_id,
                            "path": request.url.path, "status": response.status_code,
                            "duration_ms": round((perf_counter()-started)*1000, 2)}))
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    error = exc.errors()[0]
    field = ".".join(str(v) for v in error["loc"])
    return JSONResponse(_error("invalid_configuration", error["msg"], request.state.request_id, field), status_code=422)


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    return JSONResponse(_error("request_failed", str(exc.detail), request.state.request_id,
                               hint="Check the requested resource and retry."), status_code=exc.status_code)


@app.exception_handler(ValueError)
async def computation_error(request: Request, exc: ValueError):
    return JSONResponse(_error("scientific_input_error", str(exc), request.state.request_id), status_code=422)


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    logger.exception(json.dumps({"event": "request_failed", "request_id": request.state.request_id}))
    return JSONResponse(_error("computation_failed", "The scientific computation failed.", request.state.request_id,
                               hint="Review the local server log with this request ID."), status_code=500)


def run_experiment(config: dict, quantum_override: dict | None = None) -> dict:
    started = perf_counter()
    problem = build_problem(config)
    hopfield = run_hopfield(problem, config)
    gibbs = run_gibbs(problem, config)
    quantum = quantum_override or run_quantum(problem, config)
    references = reference_results(problem, config)
    return {"schema_version": "1.0", "config_hash": config_hash(config), "revision": config.get("revision", 0),
            "config": config, "model": problem, "hopfield": hopfield, "gibbs": gibbs,
            "quantum": quantum, "references": references,
            "diagnostics": experiment_diagnostics(problem, quantum),
            "provenance": {"seed": config["seed"], "versions": VERSIONS,
                           "execution_mode": quantum["execution_mode"], "warnings": quantum["warnings"],
                           "duration_ms": (perf_counter() - started) * 1000,
                           "computed_at": datetime.now(timezone.utc).isoformat(),
                           "bit_order": "local qubit a maps to free_indices[a]; integer bits are low-index first",
                           "normalization": "Hebbian weights use original total pixel count",
                           "units": "arbitrary normalized energy units",
                           "source_identity": "excluded from solver input",
                           "performance_claim": "classical simulation; no quantum advantage claim"}}


@app.get("/api/health")
def health():
    return {"status": "ok", "schema_version": "1.0", "versions": VERSIONS,
            "max_free_qubits": 8, "execution": "local scientific simulation",
            "modules": {"qec_studio": "simulation", "google_hardware": "experimental data (Zenodo 10.5281/zenodo.6804040)",
                        "legacy_memory_lab": "available at /legacy.html"}}


@app.post("/api/experiment", response_model=ExperimentResult)
def experiment(config: ExperimentConfig):
    return run_experiment(config.model_dump(mode="json"))


@app.post("/api/evaluate")
def evaluate(request: EvaluateRequest):
    config = request.config.model_dump(mode="json")
    if request.target_index is not None and request.target_index >= len(config["memories"]):
        raise ValueError("The evaluation target index is outside the memory bank.")
    result = run_experiment(config)
    evaluation = evaluate_experiment(result["model"], config,
                                     {"hopfield": result["hopfield"], "gibbs": result["gibbs"], "quantum": result["quantum"]},
                                     target_index=request.target_index)
    return {**evaluation, "schema_version": "1.0", "config_hash": result["config_hash"], "revision": result["revision"]}


@app.get("/api/presets")
def presets():
    return {"schema_version": "1.0", "presets": get_presets()}


def _expire_exports(now: float):
    for export_id in list(exports):
        if exports[export_id]["expires_at"] <= now:
            del exports[export_id]


@app.post("/api/exports", response_model=ExportResponse, status_code=201)
def prepare_export(request: ExportRequest):
    content = request.content.encode("utf-8")
    export_id = uuid4().hex
    with export_lock:
        now = monotonic()
        _expire_exports(now)
        if len(exports) >= EXPORT_CACHE_LIMIT:
            del exports[next(iter(exports))]
        exports[export_id] = {"filename": request.filename, "content": content,
                              "media_type": request.media_type, "expires_at": now + EXPORT_TTL_SECONDS}
    return {"url": f"/api/exports/{export_id}", "filename": request.filename}


@app.get("/api/exports/{export_id}")
def download_export(export_id: str):
    with export_lock:
        _expire_exports(monotonic())
        prepared = exports.get(export_id)
        if prepared is None:
            raise HTTPException(404, "Export not found or expired. Prepare the export again.")
        content, filename, media_type = prepared["content"], prepared["filename"], prepared["media_type"]
    return Response(content, media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})


@app.get("/api/benchmarks/recorded")
def recorded_benchmark():
    if not RECORDED_BENCHMARK.is_file():
        raise HTTPException(404, "The recorded benchmark has not been generated yet.")
    content = RECORDED_BENCHMARK.read_bytes()
    result = json.loads(content)
    return {**result, "replay_provenance": {"execution_mode": "recorded replay",
            "artifact": "results/benchmark.json", "sha256": sha256(content).hexdigest(),
            "computed_at": result.get("created_utc"), "benchmark_seed": result.get("benchmark_seed")}}


@app.get("/api/benchmarks/recorded/csv")
def recorded_benchmark_csv():
    if not RECORDED_BENCHMARK_CSV.is_file():
        raise HTTPException(404, "The recorded benchmark CSV has not been generated yet.")
    content = RECORDED_BENCHMARK_CSV.read_bytes()
    return Response(content, media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="qrecall-recorded-benchmark.csv"',
        "X-Execution-Mode": "recorded-replay", "ETag": '"' + sha256(content).hexdigest() + '"'})


def _public_job(job: dict) -> dict:
    return {key: value for key, value in job.items() if key not in ("cancel", "request", "future")}


def _work_job(job_id: str):
    with job_lock:
        job = jobs[job_id]
        if job["cancel"].is_set():
            job.update(status="cancelled", phase="Cancelled before execution")
            return
        job.update(status="running", phase="Preparing scientific model")
        request, cancel = job["request"], job["cancel"]
    config = request.config.model_dump(mode="json")

    def progress(value, phase="Running benchmark"):
        fraction = value.get("fraction", 0) if isinstance(value, dict) else float(value)
        with job_lock:
            jobs[job_id].update(progress=max(0.0, min(1.0, fraction)), phase=phase)

    try:
        if request.kind == "optimize":
            problem = build_problem(config)
            quantum = optimize_angles(problem, config, request.evaluation_budget, progress, cancel.is_set)
            optimized = {**config, "gammas": quantum["gammas"], "betas": quantum["betas"]}
            result = run_experiment(optimized, quantum_override=quantum)
            result["requested_config_hash"] = config_hash(config)
        else:
            result = run_benchmark(config, cases=request.cases, benchmark_seed=request.benchmark_seed,
                                   evaluation_budget=request.evaluation_budget, progress_callback=progress,
                                   cancel_check=cancel.is_set)
        with job_lock:
            if cancel.is_set():
                jobs[job_id].update(status="cancelled", phase="Cancelled", result=None)
            else:
                jobs[job_id].update(status="completed", progress=1.0, phase="Completed", result=result)
        logger.info(json.dumps({"event": "job_completed", "job_id": job_id, "kind": request.kind}))
    except (CancelledComputation, InterruptedError):
        with job_lock:
            jobs[job_id].update(status="cancelled", phase="Cancelled", result=None)
    except Exception as exc:
        logger.exception(json.dumps({"event": "job_failed", "job_id": job_id, "kind": request.kind}))
        with job_lock:
            jobs[job_id].update(status="failed", phase="Failed", error={"code": "job_failed", "message": str(exc),
                                                                       "job_id": job_id, "hint": "Review the local server log."})


@app.post("/api/jobs", response_model=JobResponse, status_code=202)
def create_job(request: JobRequest):
    config = request.config.model_dump(mode="json")
    job_id = uuid4().hex
    with job_lock:
        active = sum(j["status"] in ("queued", "running") for j in jobs.values())
        if active >= 8:
            raise HTTPException(429, "Eight jobs are already queued or running. Cancel or wait for a job.")
        # Bounded in-memory history: active jobs are retained, oldest terminal jobs expire.
        if len(jobs) >= 128:
            for key in list(jobs):
                if jobs[key]["status"] in ("completed", "cancelled", "failed"):
                    del jobs[key]
                    break
        jobs[job_id] = {"schema_version": "1.0", "id": job_id, "kind": request.kind,
                        "status": "queued", "config_hash": config_hash(config), "revision": config["revision"],
                        "progress": 0.0, "phase": "Queued", "created_at": datetime.now(timezone.utc).isoformat(),
                        "result": None, "error": None, "request": request, "cancel": Event()}
        initial = _public_job(jobs[job_id])
    executor.submit(_work_job, job_id)
    return initial


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: str):
    with job_lock:
        if job_id not in jobs:
            raise HTTPException(404, "Job not found. Local jobs expire when the server restarts.")
        return _public_job(jobs[job_id])


@app.delete("/api/jobs/{job_id}", response_model=JobResponse)
def cancel_job(job_id: str):
    with job_lock:
        if job_id not in jobs:
            raise HTTPException(404, "Job not found.")
        job = jobs[job_id]
        if job["status"] in ("queued", "running"):
            job["cancel"].set()
            job["phase"] = "Cancellation requested"
            if job["status"] == "queued":
                job["status"] = "cancelled"
        return _public_job(job)


@app.get("/api/jobs/{job_id}/csv")
def export_benchmark(job_id: str):
    with job_lock:
        job = jobs.get(job_id)
        if not job or job["status"] != "completed" or job["kind"] != "benchmark":
            raise HTTPException(409, "A completed benchmark job is required for CSV export.")
        result = job["result"]
    return Response(benchmark_csv(result), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="qrecall-benchmark-{job_id[:8]}.csv"'})


app.include_router(autoqec_router)

logger.info(json.dumps({"event": "scientific_api_loaded", "versions": VERSIONS, "max_free_qubits": 8}))
