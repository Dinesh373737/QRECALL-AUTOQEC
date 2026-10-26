"""HTTP contracts for the AutoQEC routes (Module 1 simulation and Module 2 Google hardware data)."""
from time import monotonic, sleep

import pytest
from fastapi.testclient import TestClient

from backend.hardware import dataset as ds
from backend.main import app

client = TestClient(app)


def data_installed() -> bool:
    return ds.dataset_status()["active_layout"] is not None


def poll(job_id, timeout=120):
    deadline = monotonic() + timeout
    while monotonic() < deadline:
        job = client.get(f"/api/qec/jobs/{job_id}").json()
        if job["status"] in ("completed", "failed", "cancelled"):
            return job
        sleep(0.1)
    pytest.fail("job did not finish")


def test_health_lists_modules_and_versions():
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and h["schema_version"] == "1.0"
    assert {"stim", "pymatching", "qiskit"} <= set(h["versions"])
    assert "google_hardware" in h["modules"]


def test_lab_trial_contract_and_validation():
    r = client.post("/api/qec/lab/trial", json={"injected": [{"qubit": 2, "pauli": "X"}], "p": 0.0, "q": 0.0, "seed": 4})
    assert r.status_code == 200
    body = r.json()
    assert body["syndrome"]["observed"] == "01" and body["verification"]["outcome"] == "restored"
    assert {"analysis", "decisions", "explanation", "circuit", "steps", "provenance"} <= set(body)
    assert client.post("/api/qec/lab/trial", json={"injected": [{"qubit": 3, "pauli": "X"}]}).status_code == 422
    assert client.post("/api/qec/lab/trial", json={"p": 0.9}).status_code == 422
    assert client.post("/api/qec/lab/trial", json={"unexpected": 1}).status_code == 422


def test_analyze_validates_syndrome_length():
    assert client.post("/api/qec/lab/analyze", json={"distance": 5, "syndrome": "10"}).status_code == 422
    r = client.post("/api/qec/lab/analyze", json={"distance": 5, "syndrome": "1000", "p": 0.05, "q": 0.01})
    assert r.status_code == 200 and len(r.json()["analysis"]["candidates"]) == 32


def test_message_and_circuit_routes():
    m = client.post("/api/qec/message", json={"message": "QEC", "p": 0.0, "seed": 1}).json()
    assert m["text"]["protected"] == "QEC" and m["stats"]["bits"] == 24
    c = client.post("/api/qec/circuit", json={"x_errors": "100", "mode": "physical"}).json()
    assert c["observed_syndrome"] == "10" and c["correction"] == "100" and c["residual"] == "000"
    assert c["metrics"]["total_qubits"] == 5 and c["transpiled"]["metrics"]["total_qubits"] >= 5
    assert sum(c["aer_cross_check"]["counts"].values()) == 512


def test_simulation_benchmark_job_and_csv():
    job = client.post("/api/qec/benchmarks/run", json={"shots": 1000, "seed": 9}).json()
    done = poll(job["id"])
    assert done["status"] == "completed" and done["result"]["reproducibility"]["identical"]
    csv = client.get(f"/api/qec/benchmarks/jobs/{job['id']}/csv")
    assert csv.status_code == 200 and csv.text.startswith("section,distance")


def test_recorded_module1_artifacts_and_optimizer_rank():
    rec = client.get("/api/qec/benchmarks/recorded")
    if rec.status_code == 404:
        pytest.skip("recorded Module 1 results not generated")
    assert rec.json()["artifact"]["sha256"]
    r = client.post("/api/qec/optimizer/rank", json={"recorded": "h7", "weights": {"Q": 1, "G2": 1, "D": 1}, "limits": {"pL": 0.5}})
    assert r.status_code == 200 and r.json()["status"] == "selected"
    none = client.post("/api/qec/optimizer/rank", json={"recorded": "h7", "limits": {"Q": 1}}).json()
    assert none["status"] == "no_feasible_candidate" and none["selected"] is None


def test_job_errors_and_unknown_jobs():
    assert client.get("/api/qec/jobs/does-not-exist").status_code == 404
    assert client.post("/api/qec/optimizer/rank", json={"evaluation_id": "missing"}).status_code == 404


@pytest.mark.skipif(not data_installed(), reason="Google data not installed")
def test_google_catalog_experiment_and_shot_routes():
    status = client.get("/api/google/status").json()
    assert status["doi"] == "10.5281/zenodo.6804040"
    exps = client.get("/api/google/experiments").json()
    assert exps["count"] == 131
    exp_id = "surface_code_bZ_d3_r05_center_3_5"
    detail = client.get(f"/api/google/experiments/{exp_id}").json()
    assert detail["properties"]["circuit_detectors"] == 40 and len(detail["geometry"]["detectors"]) == 40
    assert client.get(f"/api/google/experiments/{exp_id}/layout.svg").headers["content-type"].startswith("image/svg+xml")
    shot = client.get(f"/api/google/experiments/{exp_id}/shots/3?live_ising=false").json()
    assert shot["measured"]["actual_observable_flip"] in (True, False)
    assert {"pymatching_circuit", "pymatching_pij", "google_tensor_network_contraction"} <= set(shot["decoders"])
    assert "does not uniquely reveal" in shot["language_note"]
    listing = client.get(f"/api/google/experiments/{exp_id}/shots?category=disagreement&limit=5").json()
    assert listing["matches"] >= len(listing["rows"])
    assert client.get("/api/google/experiments/not_real").status_code == 404


@pytest.mark.skipif(not data_installed(), reason="Google data not installed")
def test_google_reproduction_job_matches_published_predictions():
    job = client.post("/api/google/reproduce", json={"experiment": "surface_code_bZ_d3_r05_center_3_5", "max_shots": 2000}).json()
    done = poll(job["id"])
    assert done["status"] == "completed" and done["result"]["reproduced"] and done["result"]["disagreements_with_google"] == 0


def test_advisor_and_provenance_routes():
    r = client.post("/api/google/advisor", json={"rounds": 2})
    if r.status_code == 503:
        pytest.skip("recorded baseline results missing")
    assert r.json()["message"] == "No tested configuration meets these constraints."
    prov = client.get("/api/provenance").json()
    assert prov["claims"]["quantum_advantage"] == "not claimed"
    assert all(len(a["sha256"]) == 64 for a in prov["artifacts"])
