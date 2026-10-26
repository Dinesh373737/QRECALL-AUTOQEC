"""Reproducible extraction of a deployable subset of the official Google archive.

The subset contains only *real* experimental records:

* the first K detection-event records of each experiment, byte-for-byte (``detection_events.b8``,
  readable by ``stim.read_shot_data_file``); K is larger for the short experiments used by the
  exact Ising benchmark,
* the actual observable flips and every Google decoder prediction for *all* shots, bit-packed
  (little-endian, 8 shots per byte),
* the three detector error models (gzip), ``circuit_ideal.stim``, ``layout.svg`` and
  ``properties.yml``,
* a manifest with the archive checksum and the SHA-256 of every source and derived file.

Nothing is synthesized, resampled or reordered.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from . import dataset as ds

SUBSET_VERSION = "1"


def detection_shot_budget(info: dict) -> int:
    if info["code"] == "surface_code" and info["rounds"] <= 5:
        return 5000
    return 2000


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_subset(full: Path, out: Path, archive_check: dict | None = None) -> dict:
    full, out = Path(full), Path(out)
    if not (full / "README.txt").exists():
        raise FileNotFoundError("Extract the official archive first (python -m backend.hardware.pipeline fetch).")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    shutil.copyfile(full / "README.txt", out / "GOOGLE_README.txt")
    experiments = {}
    for exp_dir in sorted(p for p in full.iterdir() if p.is_dir() and ds.EXPERIMENT_PATTERN.match(p.name)):
        info = ds.parse_experiment_id(exp_dir.name)
        props = ds.parse_properties((exp_dir / "properties.yml").read_text())
        target = out / exp_dir.name
        (target / "dem").mkdir(parents=True)
        (target / "obs").mkdir()
        files = {}
        sources = {}
        for name in ("properties.yml", "circuit_ideal.stim", "layout.svg"):
            data = (exp_dir / name).read_bytes()
            (target / name).write_bytes(data)
            files[name] = _sha(data)
            sources[name] = _sha(data)
        for kind, name in ds.DEM_FILES.items():
            data = (exp_dir / name).read_bytes()
            packed = gzip.compress(data, compresslevel=9, mtime=0)
            (target / "dem" / f"{name}.gz").write_bytes(packed)
            files[f"dem/{name}.gz"] = _sha(packed)
            sources[name] = _sha(data)
        shots = int(props["shots"])
        actual = ds.read_01(exp_dir / "obs_flips_actual.01")
        if actual.size != shots:
            raise ValueError(f"{exp_dir.name}: observable flips do not match the declared shot count.")
        blob = ds.pack_shots(actual)
        (target / "obs" / "actual.bits").write_bytes(blob)
        files["obs/actual.bits"] = _sha(blob)
        sources["obs_flips_actual.01"] = ds.file_digest(exp_dir / "obs_flips_actual.01")
        decoders = []
        for decoder in ds.GOOGLE_DECODERS:
            src = exp_dir / f"obs_flips_predicted_by_{decoder}.01"
            if not src.exists():
                continue
            pred = ds.read_01(src)
            if pred.size != shots:
                raise ValueError(f"{exp_dir.name}: {decoder} predictions do not match the shot count.")
            blob = ds.pack_shots(pred)
            (target / "obs" / f"{decoder}.bits").write_bytes(blob)
            files[f"obs/{decoder}.bits"] = _sha(blob)
            sources[src.name] = ds.file_digest(src)
            decoders.append(decoder)
        k = min(detection_shot_budget(info), shots)
        stride = (int(props["circuit_detectors"]) + 7) // 8
        with open(exp_dir / "detection_events.b8", "rb") as fh:
            prefix = fh.read(k * stride)
        if len(prefix) != k * stride:
            raise ValueError(f"{exp_dir.name}: detection events are shorter than expected.")
        (target / "detection_events.b8").write_bytes(prefix)
        files["detection_events.b8"] = _sha(prefix)
        sources["detection_events.b8"] = ds.file_digest(exp_dir / "detection_events.b8")
        experiments[exp_dir.name] = {**info, "shots": shots, "detection_shots": k,
                                     "detection_shot_range": [0, k], "google_decoders": decoders,
                                     "files": files, "source_sha256": sources}
    manifest = {"subset_version": SUBSET_VERSION, "doi": ds.DOI, "record": ds.ZENODO_RECORD,
                "title": ds.TITLE, "license": ds.LICENSE, "creators": ds.CREATORS,
                "archive": archive_check or {"name": ds.ARCHIVE_NAME, "md5": ds.ARCHIVE_MD5},
                "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "rules": {"detection_events": "first K records byte-for-byte; K=5000 for surface-code runs with "
                                              "rounds <= 5, otherwise K=2000",
                          "observables": "all shots, bit-packed little-endian (8 shots per byte)",
                          "dems": "gzip level 9, mtime 0", "synthetic_data": "none"},
                "label": "Subset of the official Google Quantum AI dataset (real experimental shots only)",
                "experiments": experiments}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def verify_subset(out: Path) -> dict:
    """Recompute every file hash listed in the manifest."""
    out = Path(out)
    manifest = json.loads((out / "manifest.json").read_text())
    bad = []
    for exp_id, meta in manifest["experiments"].items():
        for rel, digest in meta["files"].items():
            if _sha((out / exp_id / rel).read_bytes()) != digest:
                bad.append(f"{exp_id}/{rel}")
    return {"experiments": len(manifest["experiments"]), "mismatches": bad, "verified": not bad}
