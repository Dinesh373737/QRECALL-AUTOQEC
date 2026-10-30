// Shared contracts mirroring backend/qec_api.py payloads.
export type DecoderId = "none" | "lookup" | "energy" | "exact";
export type Outcome = "restored" | "recoverable_residual" | "logical_flip";
export type Interval = [number, number];

export interface Proportion {
  count: number;
  trials: number;
  rate: number | null;
  ci95: Interval;
  interval?: string;
}

export interface Candidate {
  rank: number;
  candidate: string;
  weight: number;
  predicted_syndrome: string;
  readout_flips: string;
  data_energy: number | null;
  readout_energy: number | null;
  energy: number | null;
  possible: boolean;
  posterior: number;
  delta_from_best: number | null;
  logically_equivalent_to_best: boolean;
  if_applied_outcome?: Outcome;
  preserves_logical?: boolean;
  is_actual_error?: boolean;
}

export interface LogicalClasses {
  correction: string;
  p_logical_preserved: number;
  p_logical_flip: number;
  p_exact_restoration: number;
  logical_margin_nats: number | null;
  best_preserving_candidate: { candidate: string; energy: number } | null;
  best_flipping_candidate: { candidate: string; energy: number } | null;
  logical_energy_gap: number | null;
  meaning: string;
}

export interface Analysis {
  observed_syndrome: string;
  p: number[];
  q: number[];
  candidates: Candidate[];
  best: string;
  second: string | null;
  energy_gap: number | null;
  energy_gap_meaning: string;
  best_vs_second_logically_equivalent: boolean | null;
  posterior_best: number;
  logical_classes: LogicalClasses;
  tie_breaking: string;
}

export interface Explanation {
  decoder: string;
  correction: string;
  answers: { question: string; answer: string }[];
  model: { p: number[]; q: number[]; assumptions: string[] };
  indicators: {
    energy_gap: number | null;
    likelihood_ratio: number | null;
    logical_margin_nats: number | null;
    p_logical_preserved_model: number;
    calibration_note: string;
  };
}

export interface Amp {
  basis: string;
  re: number;
  im: number;
  prob: number;
}

export interface Step {
  index: number;
  name: string;
  stage: string;
  state: Amp[];
  classical: Record<string, number>;
  outcome?: number;
  probability_one?: number;
  deterministic?: boolean;
  condition_value?: number;
  register_value?: number;
  taken?: boolean;
}

export interface Operation {
  index: number;
  name: string;
  qubits: string[];
  clbits: string[];
  params: (number | string)[];
  layer: number;
  stage?: string;
  explanation?: string;
  kind?: string;
  source?: string;
  check?: string;
  syndrome?: string;
  correction?: string;
  display?: string;
  condition?: { register: string; value: number };
  body?: { name: string; qubits: string[] }[];
}

export interface CircuitMetrics {
  data_qubits: number;
  ancilla_qubits: number;
  total_qubits: number;
  total_gates: number;
  one_qubit_gates: number;
  two_qubit_gates: number;
  multi_qubit_gates: number;
  measurements: number;
  resets: number;
  conditional_blocks: number;
  by_name: Record<string, number>;
  depth: number;
}

export interface Transpiled {
  operations: Operation[];
  metrics: CircuitMetrics;
  compile_seconds: number;
  layout: Record<string, string>;
  physical_qubits: number;
  basis: string[];
  coupling: string;
  coupling_edges: number[][];
  optimization_level: number;
  seed_transpiler: number;
}

export interface DecisionSummary {
  correction: string;
  residual: string;
  outcome: Outcome;
  logical_classes: LogicalClasses;
  decode_time_us: number;
  label: string;
  evidence: Record<string, unknown>;
}

export interface LabTrial {
  input: {
    state: string;
    theta: number;
    phi: number;
    alpha: [number, number];
    beta: [number, number];
    p: number[];
    q: number[];
    model_p: number[];
    model_q: number[];
    seed: number;
    decoder: DecoderId;
    mode: "physical" | "pauli_frame";
    model_matches_simulation: boolean;
    injected: { qubit: number; pauli: string }[];
  };
  noise: { random_x: string; readout_flips: string; injected_x: string; injected_z: string; total_x: string };
  syndrome: { ideal: string; observed: string; stabilizer_values: number[]; observed_values: number[]; readout_corrupted: boolean };
  analysis: Analysis;
  decisions: Record<DecoderId, DecisionSummary>;
  decision_table: Record<string, string>;
  explanation: Explanation;
  sensitivity: Sensitivity;
  verification: {
    actual_error: string;
    z_errors: string;
    correction: string;
    residual: string;
    outcome: Outcome;
    z_parity: number;
    logical_operator: string;
    logical_preserved: boolean;
    codeword_restored: boolean;
    convention: string;
    circuit_check: Record<string, any>;
  };
  circuit: { mode: string; operations: Operation[]; metrics: CircuitMetrics; qubits: string[]; clbits: string[]; stage_text: Record<string, string> };
  steps: Step[];
  stages: Record<string, { after_step: number; state: Amp[]; classical: Record<string, number>; reduced: { separable: boolean; ancilla?: string; data?: Amp[] } }>;
  provenance: { kind: string; seed: number; duration_ms: number };
}

export interface Sensitivity {
  readout: SensitivityAxis;
  data: SensitivityAxis;
}
export interface SensitivityAxis {
  regions: { choice: string; from_mean: number; to_mean: number }[];
  current_mean: number;
  current_choice: string;
  decision_changes: number;
}

export interface MessageResult {
  input: { message: string; p: number[]; q: number[]; decoder: DecoderId; seed: number; model_p: number[]; model_q: number[] };
  bytes: number[];
  bits: number[];
  trace: {
    flips: string[];
    readout: string[];
    ideal_syndrome: string[];
    observed_syndrome: string[];
    correction: string[];
    residual: string[];
    outcome: Outcome[];
    protected: number[];
    unprotected: number[];
  };
  chars: {
    char: string;
    index: number;
    byte_start: number;
    byte_end: number;
    bit_start: number;
    bit_end: number;
    unprotected: string;
    protected: string;
    unprotected_bit_errors: number;
    protected_bit_errors: number;
    physical_flips: number;
    readout_flips: number;
  }[];
  text: { original: string; unprotected: string; protected: string; unprotected_exact: boolean; protected_exact: boolean };
  stats: {
    bits: number;
    unprotected_bit_errors: Proportion;
    protected_bit_errors: Proportion;
    physical_flips: number;
    readout_flips: number;
    blocks_with_errors: number;
    restored: number;
    recoverable_residual: number;
    logical_failures: number;
    char_errors_unprotected: number;
    char_errors_protected: number;
  };
  decoder_table: Record<string, { correction: string; best: string; second: string | null; energy_gap: number | null; top: Candidate[]; occurrences: number }>;
  resources: {
    per_bit: Record<string, number>;
    message_bits: number;
    concurrent_physical_qubits: number;
    total_two_qubit_gates: number;
    total_measurements: number;
    overhead: string;
    circuit_mode: string;
  };
  scientific_boundary: string;
  provenance: { kind: string; pairing: string; duration_ms: number };
}

export interface CircuitResult {
  input: Record<string, any>;
  theta: number;
  phi: number;
  decision_table: Record<string, string>;
  observed_syndrome: string;
  correction: string;
  residual: string;
  operations: Operation[];
  metrics: CircuitMetrics;
  steps: Step[];
  qubits: string[];
  clbits: string[];
  stage_text: Record<string, string>;
  transpiled: Transpiled;
  aer_cross_check: { shots: number; seed: number; counts: Record<string, number>; key_format: string };
  frame_note: string;
  provenance: { duration_ms: number; versions: Record<string, string> };
}

export interface OptCandidateRow {
  id: string;
  family: string;
  Q: number;
  G2: number;
  D: number;
  G1: number;
  pL: number;
  pL_ci95: Interval;
  duration_ns: number;
  compile_ms: number;
  equivalent_settings: number;
  is_baseline: boolean;
  spacetime_proxy: number;
  settings: Record<string, string | number>;
  feasible: boolean;
  violations: string[];
  cost_terms: Record<string, number>;
  J: number;
  p_used: number;
  pareto: boolean;
  rank?: number;
}

export interface Ranking {
  evaluation: Record<string, any>;
  candidates_detail: Record<string, { settings: Record<string, any>[]; verification: { passed: boolean; checks: { case: string; passed: boolean; syndrome?: string[] }[]; method: string }; ops: Record<string, number>; active_physical_qubits: number[]; measurements: number; resets: number; family_text: string }>;
  references: Record<string, number>;
  reference_source: string;
  weights: Record<string, number>;
  limits: Record<string, number | null>;
  conservative_pL: boolean;
  candidates: OptCandidateRow[];
  feasible_count: number;
  selected: OptCandidateRow | null;
  baseline: OptCandidateRow;
  comparison: Record<string, any> | null;
  status: "selected" | "no_feasible_candidate";
  message: string;
  objective: string;
  weight_sensitivity: { weight: "Q" | "G2" | "D"; direction: "raise" | "lower"; threshold: number;
    switches_to: { id: string; family: string; Q: number; G2: number; D: number; pL: number } }[];
}

export interface ExperimentSummary {
  id: string;
  code: string;
  basis: "X" | "Z";
  distance: number;
  rounds: number;
  center: [number, number];
  shots: number;
  detectors: number;
  physical_qubits: number;
  data_qubits: number;
  measure_qubits: number;
  detection_shots_available: number;
  layout: string;
  google_decoders: string[];
  results?: Record<string, Proportion> | null;
}

export interface Geometry {
  detectors: { id: number; x: number; y: number; t: number; basis: string }[];
  qubits: { id: number; x: number; y: number; role: "data" | "measure"; basis: string | null }[];
  time_steps: number;
  note: string;
}

export interface ShotDecoder {
  label: string;
  source: string;
  dem: string;
  prediction: boolean | null;
  correct: boolean | null;
  total_weight?: number;
  edges?: { detectors: number[]; boundary: boolean; weight: number; probability: number; flips_observable: boolean; coordinates: number[][] }[];
  decode_us?: number;
  status?: string;
  objective?: number | null;
  solve_ms?: number;
  mechanisms?: Mechanism[];
}

export interface Mechanism {
  mechanism: number;
  detectors: number[];
  observables: number[];
  probability: number;
  weight: number;
  hyperedge: boolean;
  coordinates: number[][] | null;
}

export interface ShotEvidence {
  experiment: ExperimentSummary;
  shot: number;
  partition: "even" | "odd";
  measured: { detection_events: number[]; detector_count: number; actual_observable_flip: boolean; events_per_round: number[]; source: string };
  decoders: Record<string, ShotDecoder>;
  ising: {
    tractable: boolean;
    mechanisms: number;
    dem: string;
    gap?: number | null;
    relative_likelihood?: number;
    complement?: { status: string; objective: number | null; prediction: boolean | null; mechanisms: Mechanism[] } | null;
    recorded?: Record<string, any>;
    reason?: string;
  };
  narrative: string[];
  language_note: string;
}
