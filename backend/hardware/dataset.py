"""Parsing, verification and indexing of Google's published surface-code experiment data.

Source: Google Quantum AI, *Data for "Suppressing quantum errors by scaling a surface code
logical qubit"*, Zenodo record 6804040, DOI 10.5281/zenodo.6804040, CC-BY-4.0.

Two on-disk layouts are supported and never mixed silently:

* ``full``   -- the extracted official archive (one directory per experiment).
* ``subset`` -- a reproducibly extracted subset (see ``subset.py``) that keeps *real*
  shots only: the first K detection-event records byte-for-byte, every observable flip
  and every Google decoder prediction (bit-packed), the DEMs (gzip) and the circuits.

File formats follow the archive README: ``.b8`` stores each shot byte-aligned with bits
packed little-endian; ``.01`` stores one ASCII line per shot.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
DOI = "10.5281/zenodo.6804040"
ZENODO_RECORD = "https://zenodo.org/records/6804040"
ARCHIVE_NAME = "google_qec3v5_experiment_data.zip"
ARCHIVE_URL = f"https://zenodo.org/api/records/6804040/files/{ARCHIVE_NAME}/content"
ARCHIVE_BYTES = 315490804
ARCHIVE_MD5 = "a7fd8b481c3087090093106382dc217d"  # published by Zenodo for this record
TITLE = 'Data for "Suppressing quantum errors by scaling a surface code logical qubit"'
CREATORS = "Google Quantum AI Team"
LICENSE = "CC-BY-4.0"
PAPER = {"title": "Suppressing quantum errors by scaling a surface code logical qubit",
         "venue": "Nature 614, 676-681 (2023)", "doi": "10.1038/s41586-022-05434-1"}

EXPERIMENT_PATTERN = re.compile(
    r"^(?P<code>surface_code|repetition_code)_b(?P<basis>[XZ])_d(?P<distance>\d+)_r(?P<rounds>\d+)"
    r"_center_(?P<row>\d+)_(?P<col>\d+)$")

GOOGLE_DECODERS = {
    "pymatching": {"label": "Google · PyMatching", "dem": "circuit_detector_error_model.dem for all shots",
                   "kind": "minimum-weight perfect matching"},
    "correlated_matching": {"label": "Google · correlated matching",
                            "dem": "circuit_detector_error_model.dem for all shots",
                            "kind": "matching with X/Z correlation reweighting"},
    "belief_matching": {"label": "Google · belief matching",
                        "dem": "pij_from_even_for_odd.dem on odd shots, pij_from_odd_for_even.dem on even shots",
                        "kind": "belief propagation + matching"},
    "tensor_network_contraction": {"label": "Google · tensor network",
                                   "dem": "pij_from_even_for_odd.dem on odd shots, pij_from_odd_for_even.dem on even shots",
                                   "kind": "approximate maximum-likelihood decoding"},
}
DEM_FILES = {"circuit": "circuit_detector_error_model.dem",
             "pij_even_for_odd": "pij_from_even_for_odd.dem",
             "pij_odd_for_even": "pij_from_odd_for_even.dem"}


def full_root() -> Path:
    return Path(os.environ.get("QRECALL_GOOGLE_DATA", REPO_ROOT / "data" / "google_qec3v5" / "extracted"))


def subset_root() -> Path:
    return Path(os.environ.get("QRECALL_GOOGLE_SUBSET", REPO_ROOT / "data" / "google_subset"))


def parse_experiment_id(name: str) -> dict:
    match = EXPERIMENT_PATTERN.match(name)
    if not match:
        raise ValueError(f"'{name}' is not a Google experiment directory name.")
    g = match.groupdict()
    return {"id": name, "code": g["code"], "basis": g["basis"], "distance": int(g["distance"]),
            "rounds": int(g["rounds"]), "center": [int(g["row"]), int(g["col"])]}


def parse_properties(text: str) -> dict:
    """The archive's properties.yml files are flat ``key: value`` maps; parse them without a YAML engine."""
    props: dict = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if not sep:
            raise ValueError(f"Unexpected properties line: {line!r}")
        value = value.strip()
        props[key.strip()] = int(value) if re.fullmatch(r"-?\d+", value) else value
    return props


def file_digest(path: Path, algorithm: str = "sha256", chunk: int = 1 << 20) -> str:
    h = hashlib.new(algorithm)
    with open(path, "rb") as fh:
        while block := fh.read(chunk):
            h.update(block)
    return h.hexdigest()


def verify_archive(path: Path) -> dict:
    path = Path(path)
    size = path.stat().st_size
    md5 = file_digest(path, "md5")
    sha = file_digest(path, "sha256")
    return {"path": str(path), "bytes": size, "md5": md5, "sha256": sha,
            "expected_md5": ARCHIVE_MD5, "expected_bytes": ARCHIVE_BYTES,
            "verified": size == ARCHIVE_BYTES and md5 == ARCHIVE_MD5}


def read_b8(path: Path, bits_per_shot: int, max_shots: int | None = None, start: int = 0,
            packed: bool = False) -> np.ndarray:
    """Decode a ``.b8`` file into (shots, bits_per_shot) booleans, or raw (shots, stride) bytes if ``packed``."""
    stride = (bits_per_shot + 7) // 8
    raw = np.fromfile(path, dtype=np.uint8, count=-1 if max_shots is None else max_shots * stride,
                      offset=start * stride)
    if raw.size % stride:
        raise ValueError(f"{Path(path).name} size is not a multiple of the {stride}-byte record length.")
    records = raw.reshape(-1, stride)
    if packed:
        return records
    bits = np.unpackbits(records, axis=1, bitorder="little")[:, :bits_per_shot]
    return bits.astype(bool)


POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)


def packed_popcount(records: np.ndarray) -> int:
    return int(POPCOUNT[records].sum(dtype=np.int64))


def read_01(path: Path) -> np.ndarray:
    data = Path(path).read_bytes().split()
    if any(v not in (b"0", b"1") for v in data[:64]):
        raise ValueError(f"{Path(path).name} is not in the 01 format.")
    return np.frombuffer(b"".join(data), dtype=np.uint8) == ord("1")


def pack_shots(bits: np.ndarray) -> bytes:
    return np.packbits(np.asarray(bits, dtype=bool), bitorder="little").tobytes()


def unpack_shots(blob: bytes, shots: int) -> np.ndarray:
    return np.unpackbits(np.frombuffer(blob, dtype=np.uint8), bitorder="little")[:shots].astype(bool)


@dataclass
class Experiment:
    """One experiment directory in either layout, with lazily loaded arrays."""

    id: str
    root: Path
    layout: str  # "full" or "subset"
    properties: dict
    meta: dict = field(default_factory=dict)

    @property
    def info(self) -> dict:
        return parse_experiment_id(self.id)

    @property
    def detectors(self) -> int:
        return int(self.properties["circuit_detectors"])

    @property
    def shots(self) -> int:
        return int(self.properties["shots"])

    @property
    def available_detection_shots(self) -> int:
        if self.layout == "full":
            return self.shots
        return int(self.meta["detection_shots"])

    def path(self, name: str) -> Path:
        return self.root / name

    def detection_events(self, max_shots: int | None = None, start: int = 0, packed: bool = False) -> np.ndarray:
        available = self.available_detection_shots - start
        if available <= 0:
            raise ValueError("Requested shots are outside the available detection-event records.")
        limit = available if max_shots is None else min(max_shots, available)
        return read_b8(self.path("detection_events.b8"), self.detectors, limit, start=start, packed=packed)

    def shot(self, index: int) -> np.ndarray:
        if not 0 <= index < self.available_detection_shots:
            raise ValueError(f"Shot {index} is not in the available range [0, {self.available_detection_shots}).")
        return self.detection_events(1, start=index)[0]

    def observable_flips(self) -> np.ndarray:
        if self.layout == "full":
            return read_01(self.path("obs_flips_actual.01"))
        return unpack_shots(self.path("obs/actual.bits").read_bytes(), self.shots)

    def google_predictions(self) -> dict[str, np.ndarray]:
        out = {}
        for decoder in GOOGLE_DECODERS:
            if self.layout == "full":
                f = self.path(f"obs_flips_predicted_by_{decoder}.01")
                if f.exists():
                    out[decoder] = read_01(f)
            else:
                f = self.path(f"obs/{decoder}.bits")
                if f.exists():
                    out[decoder] = unpack_shots(f.read_bytes(), self.shots)
        return out

    def dem_text(self, kind: str) -> str:
        name = DEM_FILES[kind]
        if self.layout == "full":
            return self.path(name).read_text()
        return gzip.decompress(self.path(f"dem/{name}.gz").read_bytes()).decode()

    def circuit_text(self) -> str:
        return self.path("circuit_ideal.stim").read_text()

    def layout_svg(self) -> str | None:
        f = self.path("layout.svg")
        return f.read_text() if f.exists() else None

    def summary(self) -> dict:
        p = self.properties
        info = self.info
        return {**info, "type": p.get("type"), "shots": self.shots, "detectors": self.detectors,
                "observables": p.get("circuit_observables"), "measurements": p.get("circuit_measurements"),
                "physical_qubits": p.get("circuit_qubits"), "data_qubits": p.get("data_qubits"),
                "measure_qubits": p.get("measure_qubits"), "sweep_bits": p.get("circuit_sweep_bits"),
                "detection_shots_available": self.available_detection_shots, "layout": self.layout,
                "google_decoders": sorted(d for d in GOOGLE_DECODERS
                                          if self.path(f"obs_flips_predicted_by_{d}.01").exists())
                if self.layout == "full" else self.meta.get("google_decoders", [])}


class Catalog:
    """Index of experiments; prefers the full archive when present, otherwise the subset."""

    def __init__(self, layout: str | None = None):
        full, subset = full_root(), subset_root()
        if layout is None:
            layout = "full" if (full / "README.txt").exists() else "subset"
        self.layout = layout
        self.root = full if layout == "full" else subset
        self.manifest = None
        if layout == "subset":
            manifest = subset / "manifest.json"
            if not manifest.exists():
                raise FileNotFoundError("The Google data subset is missing. Run: python -m backend.hardware.pipeline subset")
            self.manifest = json.loads(manifest.read_text())
        elif not (full / "README.txt").exists():
            raise FileNotFoundError("The extracted Google archive is missing. Run: python -m backend.hardware.pipeline fetch")

    @lru_cache(maxsize=None)
    def ids(self) -> tuple[str, ...]:
        if self.layout == "subset":
            return tuple(sorted(self.manifest["experiments"]))
        return tuple(sorted(p.name for p in self.root.iterdir() if p.is_dir() and EXPERIMENT_PATTERN.match(p.name)))

    @lru_cache(maxsize=256)
    def get(self, experiment_id: str) -> Experiment:
        if experiment_id not in self.ids():
            raise KeyError(f"Unknown experiment '{experiment_id}'.")
        root = self.root / experiment_id
        props = parse_properties((root / "properties.yml").read_text())
        meta = self.manifest["experiments"][experiment_id] if self.manifest else {}
        return Experiment(experiment_id, root, self.layout, props, meta)

    def experiments(self) -> list[Experiment]:
        return [self.get(i) for i in self.ids()]


@lru_cache(maxsize=4)
def catalog(layout: str | None = None) -> Catalog:
    return Catalog(layout)


def dataset_status() -> dict:
    """Readiness report used by the API and the UI; never raises."""
    full, subset = full_root(), subset_root()
    status = {"doi": DOI, "record": ZENODO_RECORD, "title": TITLE, "creators": CREATORS, "license": LICENSE,
              "paper": PAPER, "archive": {"name": ARCHIVE_NAME, "bytes": ARCHIVE_BYTES, "md5": ARCHIVE_MD5,
                                          "url": ARCHIVE_URL},
              "full_archive_present": (full / "README.txt").exists(),
              "subset_present": (subset / "manifest.json").exists()}
    if status["subset_present"]:
        manifest = json.loads((subset / "manifest.json").read_text())
        status["subset"] = {k: v for k, v in manifest.items() if k != "experiments"}
        status["subset"]["experiment_count"] = len(manifest["experiments"])
    status["active_layout"] = "full" if status["full_archive_present"] else ("subset" if status["subset_present"] else None)
    return status
