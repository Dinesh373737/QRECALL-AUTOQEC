"""Bounded request contracts for the QEC Studio (Module 1) and Google Hardware Analyzer (Module 2)."""
from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Prob = Annotated[float, Field(ge=0.0, le=0.5, allow_inf_nan=False)]
Seed = Annotated[int, Field(ge=0, le=2**32 - 1)]
Decoder = Literal["none", "lookup", "energy", "exact"]
Bits3 = Annotated[str, Field(pattern=r"^[01]{3}$")]
Bits2 = Annotated[str, Field(pattern=r"^[01]{2}$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Fault(Strict):
    qubit: Annotated[int, Field(ge=0, le=2)]
    pauli: Literal["X", "Y", "Z"]


class Model(Strict):
    p: Annotated[list[Prob], Field(min_length=1, max_length=3)] | Prob | None = None
    q: Annotated[list[Prob], Field(min_length=1, max_length=2)] | Prob | None = None


class LabTrialRequest(Strict):
    state: Literal["zero", "one", "plus", "minus", "plus_i", "custom"] = "zero"
    theta: Annotated[float, Field(ge=0, le=3.141592653589793)] = 0.0
    phi: Annotated[float, Field(ge=-6.283185307179586, le=6.283185307179586)] = 0.0
    injected: Annotated[list[Fault], Field(max_length=6)] = []
    p: Annotated[list[Prob], Field(min_length=3, max_length=3)] | Prob = 0.0
    q: Annotated[list[Prob], Field(min_length=2, max_length=2)] | Prob = 0.0
    model: Model | None = None
    decoder: Decoder = "energy"
    mode: Literal["physical", "pauli_frame"] = "physical"
    seed: Seed = 7


class AnalyzeRequest(Strict):
    distance: Literal[3, 5, 7] = 3
    syndrome: Annotated[str, Field(pattern=r"^[01]{2,6}$")]
    p: Annotated[list[Annotated[float, Field(ge=1e-6, le=0.5)]], Field(min_length=1, max_length=7)] | Annotated[
        float, Field(ge=1e-6, le=0.5)] = 0.05
    q: Annotated[list[Prob], Field(min_length=1, max_length=6)] | Prob = 0.02
    actual_error: Annotated[str, Field(pattern=r"^[01]{3,7}$")] | None = None

    @field_validator("actual_error")
    @classmethod
    def error_length(cls, v, info):
        distance = info.data.get("distance", 3)
        if v is not None and len(v) != distance:
            raise ValueError("actual_error must contain one bit per data qubit.")
        return v

    @field_validator("syndrome")
    @classmethod
    def syndrome_length(cls, v, info):
        distance = info.data.get("distance", 3)
        if len(v) != distance - 1:
            raise ValueError("The syndrome must contain distance - 1 bits.")
        return v


class MessageRequest(Strict):
    message: Annotated[str, Field(min_length=1, max_length=64)] = "HELLO"
    p: Prob = 0.05
    q: Prob = 0.0
    model: Model | None = None
    decoder: Decoder = "energy"
    seed: Seed = 2026


class CircuitRequest(Strict):
    state: Literal["zero", "one", "plus", "minus", "plus_i", "custom"] = "plus"
    theta: Annotated[float, Field(ge=0, le=3.141592653589793)] = 0.0
    phi: Annotated[float, Field(ge=-6.283185307179586, le=6.283185307179586)] = 0.0
    x_errors: Bits3 = "010"
    z_errors: Bits3 = "000"
    readout_flips: Bits2 = "00"
    decoder: Decoder = "energy"
    p: Prob = 0.05
    q: Prob = 0.02
    mode: Literal["physical", "pauli_frame"] = "physical"
    coupling: Literal["line", "h7"] = "line"
    optimization_level: Annotated[int, Field(ge=0, le=3)] = 1
    seed: Seed = 11


class NoiseParams(Strict):
    p1: Annotated[float, Field(ge=0, le=0.05)] = 0.001
    p2: Annotated[float, Field(ge=0, le=0.1)] = 0.01
    p_meas: Annotated[float, Field(ge=0, le=0.1)] = 0.02
    p_idle: Annotated[float, Field(ge=0, le=0.05)] = 0.002


class OptimizerEvaluateRequest(Strict):
    coupling: Literal["line", "h7"] = "h7"
    noise: NoiseParams = Field(default_factory=NoiseParams)
    shots: Annotated[int, Field(ge=200, le=20000)] = 4000
    seed: Seed = 1234


class OptimizerRankRequest(Strict):
    evaluation_id: str | None = None
    recorded: Literal["h7", "line"] | None = "h7"
    weights: dict[Literal["Q", "G2", "D"], Annotated[float, Field(ge=0, le=10)]] = {"Q": 1.0, "G2": 1.0, "D": 1.0}
    limits: dict[Literal["Q", "G2", "D", "pL"], Annotated[float, Field(ge=0)] | None] = {}
    conservative: bool = True


class SimBenchRequest(Strict):
    shots: Annotated[int, Field(ge=1000, le=200000)] = 20000
    seed: Seed = 20261026
    p: Annotated[float, Field(gt=0, le=0.3)] = 0.05
    q: Annotated[float, Field(ge=0, le=0.3)] = 0.02


class AdvisorRequest(Strict):
    rounds: Annotated[int, Field(ge=1, le=50)] | None = 25
    basis: Literal["X", "Z", "any"] = "any"
    target_kind: Literal["per_shot", "per_round"] = "per_shot"
    target: Annotated[float, Field(gt=0, le=1)] | None = None
    max_qubits: Annotated[int, Field(ge=1, le=1000)] | None = None
    max_latency_us: Annotated[float, Field(gt=0)] | None = None
    conservative: bool = True
    priorities: dict[Literal["reliability", "space", "speed"], Annotated[float, Field(ge=0, le=10)]] = {}


class ReproduceRequest(Strict):
    experiment: Annotated[str, Field(max_length=80)]
    max_shots: Annotated[int, Field(ge=100, le=500000)] | None = None


class JobInfo(Strict):
    id: str
    kind: str
    status: Literal["queued", "running", "completed", "cancelled", "failed"]
    progress: float
    phase: str
    created_at: str
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
