from threading import Event
from time import sleep, monotonic

import pytest
from fastapi.testclient import TestClient

from backend.main import app, config_hash
from backend.schemas import ExperimentResult

client = TestClient(app)


def config():
    return {"rows": 2, "cols": 2, "memories": [[1, 1, -1, -1], [1, -1, 1, -1]],
            "cue": [1, None, None, -1], "mode": "erasure", "seed": 42,
            "samples": 8, "burn_in": 2, "thinning": 1, "shots": 32,
            "depth": 1, "gammas": [0.7], "betas": [0.35], "revision": 5}


def poll(job_id):
    deadline = monotonic() + 8
    while monotonic() < deadline:
        response = client.get(f"/api/jobs/{job_id}")
        assert response.status_code == 200
        job = response.json()
        if job["status"] in ("completed", "cancelled", "failed"):
            return job
        sleep(0.01)
    pytest.fail("Job did not reach a terminal state.")


def test_health_and_full_experiment_contract():
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["versions"]["qiskit"]
    response = client.post("/api/experiment", json=config())
    assert response.status_code == 200, response.text
    result = response.json()
    ExperimentResult.model_validate(result)
    assert result["revision"] == 5
    assert result["model"]["free_indices"] == [1, 2]
    assert sum(result["quantum"]["counts"].values()) == 32
    assert result["provenance"]["source_identity"] == "excluded from solver input"
    assert "x-request-id" in response.headers


@pytest.mark.parametrize("change", [
    {"target_index": 0}, {"shots": 100000}, {"samples": 0}, {"temperature": 0.0},
    {"temperature": float("inf")}, {"cue": [1, 1]}, {"depth": 2},
    {"cue": [True, None, None, -1]}, {"memories": [[1.0, 1, -1, -1]]},
    {"mode": "noisy", "trusted_mask": [True, False, False, False]},
])
def test_invalid_inputs_have_structured_errors(change):
    # JSONResponse itself refuses non-finite JSON; send its JSON token explicitly.
    if change.get("temperature") == float("inf"):
        import json
        response = client.post("/api/experiment", content=json.dumps({**config(), **change}), headers={"Content-Type": "application/json"})
    else:
        response = client.post("/api/experiment", json={**config(), **change})
    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "invalid_configuration"
    assert error["request_id"] and error["message"] and error["field"]


def test_free_qubit_limit_and_fully_clamped_case():
    large = {**config(), "rows": 4, "cols": 4, "memories": [[1] * 16], "cue": [None] * 16}
    response = client.post("/api/experiment", json=large)
    assert response.status_code == 422
    assert "8 free qubits" in response.json()["error"]["message"]
    c = config()
    c["cue"] = c["memories"][0]
    result = client.post("/api/experiment", json=c)
    assert result.status_code == 200
    assert result.json()["quantum"]["output"] == c["cue"]


def test_reset_cue_evaluation_returns_trusted_pattern_with_zero_quantum_shots():
    c = config()
    c["cue"] = c["memories"][0]
    experiment = client.post("/api/experiment", json=c)
    evaluation = client.post("/api/evaluate", json={"config": c, "target_index": 0})
    assert experiment.status_code == evaluation.status_code == 200, evaluation.text
    result = experiment.json()
    assert result["model"]["free_indices"] == []
    assert result["quantum"]["counts"] == {}
    assert result["quantum"]["measurement_trace"] == []
    assert result["quantum"]["resources"]["shots"] == 0
    metrics = evaluation.json()["methods"]["quantum"]
    assert metrics["final_state"] == c["cue"]
    assert metrics["recovery"]
    assert metrics["sample_count"] == 0
    assert metrics["sampled_energy"] is None
    assert metrics["empirical_target_probability"] is None
    assert metrics["resources"]["shots"] == 0
    assert evaluation.json()["config_hash"] == result["config_hash"]


def test_malformed_json_and_oversized_import():
    malformed = client.post("/api/experiment", content="{", headers={"Content-Type": "application/json"})
    assert malformed.status_code == 422
    large = client.post("/api/experiment", content=" " * 262145, headers={"Content-Type": "application/json"})
    assert large.status_code == 413
    assert large.json()["error"]["code"] == "input_too_large"


def test_hash_covers_scientific_seed_and_ignores_revision():
    c = config()
    assert config_hash(c) == config_hash({**c, "revision": 99})
    assert config_hash(c) != config_hash({**c, "seed": 43})
    assert config_hash(c) != config_hash({**c, "gammas": [0.8]})


def test_optimizer_job_completion_and_revision_contract():
    initial = client.post("/api/jobs", json={"kind": "optimize", "config": config(), "evaluation_budget": 8})
    assert initial.status_code == 202, initial.text
    job = poll(initial.json()["id"])
    assert job["status"] == "completed", job
    assert job["progress"] == 1
    assert job["revision"] == 5
    assert job["result"]["requested_config_hash"] == job["config_hash"]
    assert job["result"]["quantum"]["optimizer_history"]
    assert len(job["result"]["quantum"]["optimizer_history"]) <= 8


def test_job_cancellation_and_failure_are_terminal(monkeypatch):
    import backend.main as main
    entered = Event()

    def cancellable(*args, cancel_check=None, **kwargs):
        entered.set()
        while not cancel_check():
            sleep(0.005)
        raise InterruptedError("cancelled")

    monkeypatch.setattr(main, "run_benchmark", cancellable)
    job = client.post("/api/jobs", json={"kind": "benchmark", "config": config()}).json()
    assert entered.wait(2)
    assert client.delete(f'/api/jobs/{job["id"]}').status_code == 200
    assert poll(job["id"])["status"] == "cancelled"

    def fail(*args, **kwargs):
        raise ValueError("deliberate test failure")

    monkeypatch.setattr(main, "run_benchmark", fail)
    failed = client.post("/api/jobs", json={"kind": "benchmark", "config": config()}).json()
    terminal = poll(failed["id"])
    assert terminal["status"] == "failed"
    assert terminal["error"]["code"] == "job_failed"
    assert terminal["result"] is None


def test_evaluator_keeps_target_separate_and_validates_index():
    result = client.post("/api/evaluate", json={"config": config(), "target_index": 0})
    assert result.status_code == 200, result.text
    assert result.json()["target_index"] == 0
    experiment = client.post("/api/experiment", json=config()).json()
    assert result.json()["config_hash"] == experiment["config_hash"]
    rejected = client.post("/api/evaluate", json={"config": config(), "target_index": 7})
    assert rejected.status_code == 422


def test_openapi_exposes_versioned_config_and_quantum_trace():
    schemas = client.get("/api/openapi.json").json()["components"]["schemas"]
    assert schemas["ExperimentConfig"]["additionalProperties"] is False
    assert "target_index" not in schemas["ExperimentConfig"]["properties"]
    assert "amplitudes" in schemas["QuantumEvent"]["properties"]


def test_recorded_benchmark_preserves_evidence_and_labels_replay():
    import json
    from hashlib import sha256
    from backend.main import RECORDED_BENCHMARK
    expected = RECORDED_BENCHMARK.read_bytes()
    response = client.get("/api/benchmarks/recorded")
    assert response.status_code == 200
    result = response.json()
    replay = result.pop("replay_provenance")
    assert result == json.loads(expected)
    assert replay["execution_mode"] == "recorded replay"
    assert replay["sha256"] == sha256(expected).hexdigest()
    assert replay["benchmark_seed"] == result["benchmark_seed"]
    assert replay["computed_at"] == result["created_utc"]


def test_recorded_csv_is_the_actual_fixed_artifact():
    from backend.main import RECORDED_BENCHMARK_CSV
    response = client.get("/api/benchmarks/recorded/csv")
    assert response.status_code == 200
    assert response.content == RECORDED_BENCHMARK_CSV.read_bytes()
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["x-execution-mode"] == "recorded-replay"


def test_missing_recorded_artifact_has_a_clear_error(monkeypatch, tmp_path):
    import backend.main as main
    monkeypatch.setattr(main, "RECORDED_BENCHMARK", tmp_path / "missing.json")
    response = client.get("/api/benchmarks/recorded")
    assert response.status_code == 404
    assert "has not been generated" in response.json()["error"]["message"]
