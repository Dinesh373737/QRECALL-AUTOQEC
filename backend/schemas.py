"""Bounded, versioned HTTP contracts. Solver requests never accept a target."""
from __future__ import annotations

from typing import Annotated, Any, Literal
from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

Spin = Literal[-1, 1]
Finite = Annotated[float, Field(allow_inf_nan=False)]
Angle = Annotated[float, Field(ge=-6.283185307179586, le=6.283185307179586, allow_inf_nan=False)]
# Full valid p=3 / 8192-update traces can exceed 16 MiB before benchmark data.
MAX_EXPORT_CONTENT_BYTES = 32 * 1024 * 1024


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class ExportRequest(StrictModel):
    filename: Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*\.(json|csv)$")]
    content: Annotated[str, Field(max_length=MAX_EXPORT_CONTENT_BYTES)]
    media_type: Literal["application/json", "text/csv"]

    @model_validator(mode="after")
    def bounded_file(self) -> "ExportRequest":
        if ".." in self.filename:
            raise ValueError("Export filenames must be safe basenames without parent-directory segments.")
        expected = ".json" if self.media_type == "application/json" else ".csv"
        if not self.filename.endswith(expected):
            raise ValueError("The filename extension must match the export media type.")
        if len(self.content.encode("utf-8")) > MAX_EXPORT_CONTENT_BYTES:
            raise ValueError("Export content is limited to 32 MiB of UTF-8 data.")
        return self


class ExportResponse(StrictModel):
    url: str
    filename: str


class NoiseConfig(StrictModel):
    enabled: bool = False
    gate_error: Annotated[float, Field(ge=0, le=0.2)] = 0.01
    readout_error: Annotated[float, Field(ge=0, le=0.2)] = 0.02


class ExperimentConfig(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    revision: Annotated[int, Field(ge=0, le=2**31 - 1)] = 0
    rows: Annotated[int, Field(ge=1, le=8)]
    cols: Annotated[int, Field(ge=1, le=8)]
    memories: Annotated[list[list[Spin]], Field(min_length=1, max_length=8)]
    cue: list[Spin | None]
    mode: Literal["erasure", "noisy"] = "erasure"
    seed: Annotated[int, Field(ge=0, le=2**32 - 1)] = 42
    temperature: Annotated[float, Field(ge=0.001, le=100)] = 0.6
    cue_strength: Annotated[float, Field(ge=0, le=10)] = 0.6
    depth: Annotated[int, Field(ge=1, le=3)] = 1
    gammas: Annotated[list[Angle], Field(min_length=1, max_length=3)] = [0.7]
    betas: Annotated[list[Angle], Field(min_length=1, max_length=3)] = [0.35]
    shots: Annotated[int, Field(ge=1, le=8192)] = 1024
    burn_in: Annotated[int, Field(ge=0, le=256)] = 32
    samples: Annotated[int, Field(ge=1, le=1024)] = 256
    thinning: Annotated[int, Field(ge=1, le=16)] = 2
    max_sweeps: Annotated[int, Field(ge=1, le=128)] = 32
    update_order: Literal["sequential", "random"] = "sequential"
    noise: NoiseConfig = Field(default_factory=NoiseConfig)
    observed_mask: list[bool] | None = None
    trusted_mask: list[bool] | None = None
    reliability: list[Finite] | None = None
    biases: list[Finite] | None = None

    @field_validator("cue", "memories", mode="before")
    @classmethod
    def integer_spins(cls, value, info):
        arrays = value if info.field_name == "memories" else [value]
        if not isinstance(arrays, list) or any(not isinstance(row, list) for row in arrays):
            raise ValueError("Spin patterns must be JSON arrays.")
        for row in arrays:
            for spin in row:
                if spin is None and info.field_name == "cue":
                    continue
                if type(spin) is not int or spin not in (-1, 1):
                    raise ValueError("Spins must be integers -1 or +1; use null for erasures.")
        return value

    @model_validator(mode="after")
    def scientific_limits(self) -> "ExperimentConfig":
        n = self.rows * self.cols
        if n > 16:
            raise ValueError("The demonstration supports at most 16 pixels.")
        if len(self.cue) != n or any(len(m) != n for m in self.memories):
            raise ValueError("Cue and every memory must contain rows × cols spins.")
        if len(self.gammas) != self.depth or len(self.betas) != self.depth:
            raise ValueError("Provide exactly one gamma and beta per QAOA layer.")
        for name in ("observed_mask", "trusted_mask", "reliability", "biases"):
            values = getattr(self, name)
            if values is not None and len(values) != n:
                raise ValueError(f"{name} must contain rows × cols entries.")
        if self.reliability is not None and any(r < 0 or r > 1 for r in self.reliability):
            raise ValueError("Reliability weights must lie between 0 and 1.")
        observed = self.observed_mask or [c is not None for c in self.cue]
        if any(v and self.cue[i] is None for i, v in enumerate(observed)):
            raise ValueError("Observed pixels must have a spin in the cue.")
        trusted = self.trusted_mask or ([False] * n if self.mode == "noisy" else observed)
        if any(t and not observed[i] for i, t in enumerate(trusted)):
            raise ValueError("Trusted pixels must also be observed.")
        if self.mode == "noisy" and any(trusted):
            raise ValueError("Soft noisy cues are never clamped; trusted_mask must be empty.")
        if n - sum(trusted) > 8:
            raise ValueError("At most 8 free qubits are supported. Trust more pixels or use an 8-pixel system.")
        if (self.burn_in + self.samples * self.thinning) * (n - sum(trusted)) > 8192:
            raise ValueError("Thermal trace generation is limited to 8192 individual updates per request.")
        return self


class EvaluateRequest(StrictModel):
    config: ExperimentConfig
    target_index: Annotated[int, Field(ge=0, le=7)] | None = None


class JobRequest(StrictModel):
    kind: Literal["optimize", "benchmark"]
    config: ExperimentConfig
    evaluation_budget: Annotated[int, Field(ge=4, le=128)] = 24
    cases: Annotated[int, Field(ge=1, le=36)] = 12
    benchmark_seed: Annotated[int, Field(ge=0, le=2**32 - 1)] = 20261005

    @model_validator(mode="after")
    def optimizer_budget(self) -> "JobRequest":
        if self.evaluation_budget < 2 * self.config.depth + 2:
            raise ValueError("The evaluation budget must be at least 2 × depth + 2 for COBYLA initialization.")
        return self


class ComplexAmplitude(StrictModel):
    real: Finite
    imag: Finite


class CircuitGate(StrictModel):
    gate: Literal["h", "rzz", "rz", "rx"]
    layer: int
    qubits: list[int]
    global_qubits: list[int]
    angle: Finite | None = None
    coefficient: Finite | None = None


class QuantumEvent(StrictModel):
    event: Literal["initialization", "cost", "mixer", "cost_layer", "mixer_layer"]
    index: int
    layer: int
    gate: str | None
    angle: Finite | None
    qubits: list[int]
    global_qubits: list[int]
    coefficient: Finite | None
    probabilities: list[Finite]
    amplitudes: list[ComplexAmplitude]
    phases: list[Finite | None]
    expected_energy: Finite


class MeasurementEvent(StrictModel):
    event: Literal["measurement"]
    shots: int
    counts: dict[str, int]
    output: list[Spin]
    state_integer: int
    ties: list[int]


class QuantumResult(StrictModel):
    method: Literal["quantum"]
    status: Literal["completed"]
    trace: list[QuantumEvent]
    measurement_trace: list[MeasurementEvent]
    output: list[Spin]
    final_state: list[Spin]
    state_integer: int
    counts: dict[str, int]
    qiskit_counts: dict[str, int]
    probabilities: list[Finite]
    empirical_probabilities: list[Finite]
    expected_energy: Finite
    sampled_energy: Finite
    gates: list[CircuitGate]
    gammas: list[Finite]
    betas: list[Finite]
    ties: list[int]
    decision: dict[str, JsonValue]
    resources: dict[str, JsonValue]
    execution_mode: str
    phase_trace_mode: str
    probability_source: str
    warnings: list[str]
    optimizer_history: list[dict[str, JsonValue]] = []
    optimization: dict[str, JsonValue] | None = None


class QuantumSnapshotDiagnostics(StrictModel):
    index: Annotated[int, Field(ge=0)]
    amplitude_norm: Finite
    probability_sum: Finite
    expected_energy: Finite
    energy_variance: Finite | None
    basis_entropy_bits: Finite
    effective_basis_states: Finite


class BasisEnergyBreakdown(StrictModel):
    state_integer: Annotated[int, Field(ge=0, le=255)]
    pair_energy: Finite
    field_energy: Finite
    constant_energy: Finite
    total_energy: Finite


class ExperimentDiagnostics(StrictModel):
    source: Literal["ideal_statevector"]
    quantum_trace: Annotated[list[QuantumSnapshotDiagnostics], Field(min_length=1, max_length=139)]
    quantum_final: QuantumSnapshotDiagnostics
    basis_energy: Annotated[list[BasisEnergyBreakdown], Field(min_length=1, max_length=256)]
    notes: list[str]


class ExperimentResult(StrictModel):
    schema_version: Literal["1.0"]
    config_hash: str
    revision: int
    config: ExperimentConfig
    model: dict[str, JsonValue]
    hopfield: dict[str, JsonValue]
    gibbs: dict[str, JsonValue]
    quantum: QuantumResult
    references: dict[str, JsonValue]
    diagnostics: ExperimentDiagnostics | None = None
    provenance: dict[str, JsonValue]


class JobResponse(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    id: str
    kind: Literal["optimize", "benchmark"]
    status: Literal["queued", "running", "completed", "cancelled", "failed"]
    config_hash: str
    revision: int
    progress: Finite
    phase: str
    created_at: str
    result: dict[str, JsonValue] | None
    error: dict[str, JsonValue] | None
