"""Local file downloads retain exact content while bounding names, size and lifetime."""
import json
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import backend.main as main
import backend.schemas as schemas

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def empty_export_cache():
    with main.export_lock:
        main.exports.clear()
    yield
    with main.export_lock:
        main.exports.clear()


def prepare(filename="qrecall.csv", content="case,method\n0,QAOA\n", media_type="text/csv"):
    return client.post("/api/exports", json={"filename": filename, "content": content, "media_type": media_type})


@pytest.mark.parametrize("filename,media_type,content", [
    ("qrecall-seed-42.csv", "text/csv", "case,method\n0,QAOA\n"),
    ("qrecall-seed-42.json", "application/json", '{"name":"μ-memory","seed":42}'),
])
def test_http_attachment_download_preserves_exact_utf8_content(filename, media_type, content):
    prepared = prepare(filename, content, media_type)
    assert prepared.status_code == 201, prepared.text
    artifact = prepared.json()
    assert artifact["filename"] == filename
    assert artifact["url"].startswith("/api/exports/")
    assert len(artifact["url"].removeprefix("/api/exports/")) == 32
    downloaded = client.get(artifact["url"])
    assert downloaded.status_code == 200
    assert downloaded.content == content.encode("utf-8")
    assert downloaded.headers["content-disposition"] == f'attachment; filename="{filename}"'
    assert downloaded.headers["content-type"].startswith(media_type)
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert downloaded.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("filename", [
    "../secret.csv", "/tmp/output.json", "folder/file.csv", "folder\\file.csv",
    "qrecall..csv", 'qrecall".csv', "qrecall\r\nX-Test.csv", "qrecall.html", ".hidden.json",
])
def test_filenames_cannot_be_paths_or_inject_headers(filename):
    assert prepare(filename).status_code == 422
    assert not main.exports


def test_export_contract_rejects_arbitrary_fields_and_media_types():
    assert client.post("/api/exports", json={"filename": "output.csv", "content": "x", "media_type": "text/html"}).status_code == 422
    assert client.post("/api/exports", json={"filename": "output.csv", "content": "x", "media_type": "text/csv", "path": "/tmp/output.csv"}).status_code == 422
    assert prepare("output.json", "{}", "text/csv").status_code == 422
    assert not main.exports


def test_export_content_size_limit_counts_utf8_bytes(monkeypatch):
    monkeypatch.setattr(schemas, "MAX_EXPORT_CONTENT_BYTES", 16)
    accepted = prepare(content="x" * 16)
    assert accepted.status_code == 201
    assert prepare(content="x" * 17).status_code == 422
    assert prepare(content="μ" * 9).status_code == 422


def test_real_32_mib_content_boundary_allows_largest_valid_trace_exports():
    limit = 32 * 1024 * 1024
    content = "x" * limit
    accepted = schemas.ExportRequest(filename="qrecall.json", content=content, media_type="application/json")
    assert len(accepted.content.encode("utf-8")) == limit
    with pytest.raises(ValidationError):
        schemas.ExportRequest(filename="qrecall.json", content=content + "x", media_type="application/json")


def test_export_content_previously_above_16_mib_downloads_in_full():
    content = "x" * (19 * 1024 * 1024)
    prepared = prepare(content=content)
    assert prepared.status_code == 201, prepared.text
    assert client.get(prepared.json()["url"]).content == content.encode("utf-8")


def test_real_40_mib_declared_body_boundary_rejects_larger_requests():
    limit = 40 * 1024 * 1024
    valid = {"filename": "output.csv", "content": "x", "media_type": "text/csv"}
    accepted = client.post("/api/exports", json=valid, headers={"Content-Length": str(limit)})
    assert accepted.status_code == 201
    oversized = client.post("/api/exports", json=valid, headers={"Content-Length": str(limit + 1)})
    assert oversized.status_code == 413
    assert "40 MiB" in oversized.json()["error"]["message"]


def test_export_requests_allow_large_json_without_relaxing_experiment_limits():
    content = "x" * 300_000
    exported = prepare(content=content)
    assert exported.status_code == 201
    assert client.get(exported.json()["url"]).text == content
    experiment = client.post("/api/experiment", content=" " * 300_000, headers={"Content-Type": "application/json"})
    assert experiment.status_code == 413


def test_export_body_limit_checks_declared_and_actual_size(monkeypatch):
    monkeypatch.setattr(main, "EXPORT_BODY_LIMIT_BYTES", 128)
    oversized = prepare(content="x" * 200)
    assert oversized.status_code == 413
    assert oversized.json()["error"]["code"] == "input_too_large"
    without_length = client.post("/api/exports", content=iter([b" " * 200]), headers={"Content-Type": "application/json"})
    assert without_length.status_code == 413
    assert not main.exports


def test_exports_expire_after_fifteen_minutes_without_read_extending_lifetime(monkeypatch):
    current = [100.0]
    monkeypatch.setattr(main, "monotonic", lambda: current[0])
    exported = prepare().json()
    current[0] += main.EXPORT_TTL_SECONDS - 1
    assert client.get(exported["url"]).status_code == 200
    current[0] += 1
    expired = client.get(exported["url"])
    assert expired.status_code == 404
    assert "expired" in expired.json()["error"]["message"]
    assert not main.exports


def test_sixteen_entry_cache_evicts_oldest_without_reusing_ids():
    prepared = [prepare(f"result-{i}.csv").json() for i in range(17)]
    assert len(main.exports) == 16
    assert len({p["url"] for p in prepared}) == 17
    assert client.get(prepared[0]["url"]).status_code == 404
    assert client.get(prepared[-1]["url"]).status_code == 200


def test_unknown_export_id_never_reads_a_filesystem_path():
    response = client.get("/api/exports/not-a-local-artifact")
    assert response.status_code == 404
    assert "Prepare the export again" in response.json()["error"]["message"]
