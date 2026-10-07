export type Spin = -1 | 1;
export interface Config {
  observed_mask?: boolean[] | null;
  trusted_mask?: boolean[] | null;
  reliability?: number[] | null;
  biases?: number[] | null;
  schema_version: string;
  revision: number;
  rows: number;
  cols: number;
  memories: Spin[][];
  cue: (Spin | null)[];
  mode: "erasure" | "noisy";
  seed: number;
  temperature: number;
  cue_strength: number;
  depth: number;
  gammas: number[];
  betas: number[];
  shots: number;
  burn_in: number;
  samples: number;
  thinning: number;
  max_sweeps: number;
  update_order: "sequential" | "random";
  noise: { enabled: boolean; gate_error: number; readout_error: number };
}
export interface ClassicalEvent {
  event?: string;
  index?: number;
  neuron: number;
  state_before: Spin[];
  state_after: Spin[];
  local_field: number;
  contributions: { neuron: number; value: number }[];
  energy_before: number;
  energy_after: number;
  p_plus?: number;
  probability_plus?: number;
  draw?: number;
  random_draw?: number;
  temperature?: number;
  iteration?: number;
}
export interface QuantumEvent {
  event: string;
  layer: number;
  gate: string | null;
  angle?: number | null;
  qubits: number[];
  global_qubits: number[];
  probabilities: number[];
  amplitudes: { real: number; imag: number }[];
  phases: (number | null)[];
  expected_energy: number;
}
export interface SolverResult {
  trace: ClassicalEvent[];
  output: Spin[];
  counts?: Record<string, number>;
  ties?: number[];
  resources: Record<string, number | string>;
  status?: string;
  energy?: number;
  state_integer?: number;
  probabilities?: number[];
}
export interface MeasurementEvent {
  event: string;
  shots: number;
  counts: Record<string, number>;
  output: Spin[];
  state_integer: number;
  ties: number[];
}
export interface QuantumResult {
  measurement_trace: MeasurementEvent[];
  trace: QuantumEvent[];
  output: Spin[];
  counts: Record<string, number>;
  probabilities: number[];
  expected_energy: number;
  sampled_energy: number;
  gammas: number[];
  betas: number[];
  gates: Gate[];
  ties: number[];
  resources: Record<string, number | string>;
  execution_mode: string;
  state_integer?: number;
  empirical_probabilities?: number[];
  optimizer_history?: {
    evaluation: number;
    objective: number;
    best_objective: number;
  }[];
  optimization?: { stop_reason: string; best_objective: number };
}
export interface Gate {
  gate: string;
  qubits: number[];
  global_qubits: number[];
  angle?: number;
  layer: number;
  coefficient?: number;
}
export interface QuantumSnapshotDiagnostics {
  index: number;
  amplitude_norm: number;
  probability_sum: number;
  expected_energy: number;
  energy_variance: number | null;
  basis_entropy_bits: number;
  effective_basis_states: number;
}
export interface BasisEnergyBreakdown {
  state_integer: number;
  pair_energy: number;
  field_energy: number;
  constant_energy: number;
  total_energy: number;
}
export interface ExperimentDiagnostics {
  source: "ideal_statevector";
  quantum_trace: QuantumSnapshotDiagnostics[];
  quantum_final: QuantumSnapshotDiagnostics;
  basis_energy: BasisEnergyBreakdown[];
  notes: string[];
}
export interface Result {
  schema_version: string;
  config_hash: string;
  revision: number;
  config: Config;
  model: {
    n: number;
    rows: number;
    cols: number;
    weights: number[][];
    biases: number[];
    free_indices: number[];
    trusted_indices: number[];
    fields: number[];
    constant: number;
    states: Spin[][];
    free_states: Spin[][];
    energies: number[];
    initial_state: Spin[];
    mapping: { local: number; global: number }[];
    memory_contributions?: number[][][];
  };
  hopfield: SolverResult;
  gibbs: SolverResult;
  quantum: QuantumResult;
  references: {
    exact_minimum: { energy: number; final_state: Spin[]; ties: number[] };
    exact_gibbs: { probabilities: number[]; expected_energy: number };
    nearest_memory: { final_state: Spin[]; ties: number[] };
  };
  diagnostics?: ExperimentDiagnostics | null;
  provenance: {
    seed: number;
    versions: Record<string, string>;
    execution_mode: string;
    warnings: string[];
    duration_ms: number;
  };
}
export interface Metric {
  final_state: Spin[];
  energy: number;
  energy_gap: number | null;
  expected_energy: number;
  target_probability: number | null;
  empirical_target_probability?: number | null;
  recovery: boolean;
  bit_error_rate: number;
  free_bit_error_rate: number;
  unintended_memory: boolean;
  spurious_state: boolean;
  violations: number[];
  constraints_satisfied: boolean;
  ties: unknown[];
  resources: Record<string, number | string>;
  runtime_seconds: number;
}
export interface Evaluation {
  schema_version: string;
  target_index: number;
  bit_error_scope: string;
  decision_rule: string;
  methods: Record<string, Metric>;
  warnings: string[];
}
export interface Preset {
  id: string;
  label: string;
  description: string;
  config: Config;
  target_index: number;
  verified_claim?: string;
}
export const chapters = [
  {
    id: "store",
    label: "Store",
    title: "A memory is lost.\nIts energy remains.",
    sub: "Three stored patterns. One shared energy. Three ways to find your way back.",
    color: "#70ddd0",
  },
  {
    id: "damage",
    label: "Damage",
    title: "Give the system\nan incomplete clue.",
    sub: "Unknown pixels are free. Trusted observations become fixed constraints.",
    color: "#70ddd0",
  },
  {
    id: "hopfield",
    label: "Recall",
    title: "Follow the field.\nDescend the energy.",
    sub: "One neuron at a time follows its weighted neighbors. Every move is computed.",
    color: "#70ddd0",
  },
  {
    id: "thermal",
    label: "Thermal",
    title: "Sometimes, the way\nout is uphill.",
    sub: "A seeded Gibbs sampler explores the same energy at a chosen temperature.",
    color: "#eac17d",
  },
  {
    id: "quantum",
    label: "Quantum",
    title: "Same memory.\nA quantum language.",
    sub: "The conditioned graph becomes an Ising Hamiltonian and an actual QAOA circuit.",
    color: "#b5a2ff",
  },
  {
    id: "measure",
    label: "Measure",
    title: "From possibility\nto a recovered pattern.",
    sub: "Finite measurements become frequencies. The modal sample becomes the reconstruction.",
    color: "#b5a2ff",
  },
  {
    id: "compare",
    label: "Compare",
    title: "Let the evidence\nspeak for itself.",
    sub: "Compare the same cue, energy and evaluation target. A quantum win is never assumed.",
    color: "#70ddd0",
  },
  {
    id: "export",
    label: "Export",
    title: "A result you can\nreproduce. And explain.",
    sub: "Take the configuration, traces, circuit and evidence with you.",
    color: "#70ddd0",
  },
] as const;
export const demoMemories: Spin[][] = [
  [-1, 1, 1, -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, -1, -1, 1],
  [1, 1, 1, -1, 1, -1, -1, 1, 1, 1, 1, -1, 1, -1, -1, 1],
  [1, 1, 1, 1, 1, -1, -1, -1, 1, -1, -1, -1, 1, 1, 1, 1],
];
export function defaultConfig(): Config {
  return {
    schema_version: "1.0",
    revision: 0,
    rows: 4,
    cols: 4,
    memories: demoMemories.map((m) => [...m]),
    cue: demoMemories[0].map((s, i) =>
      [1, 4, 5, 6, 9, 10, 11, 14].includes(i) ? null : s,
    ),
    mode: "erasure",
    seed: 42,
    temperature: 0.65,
    cue_strength: 0.2,
    depth: 1,
    gammas: [0.7],
    betas: [0.35],
    shots: 1024,
    burn_in: 16,
    samples: 128,
    thinning: 1,
    max_sweeps: 32,
    update_order: "sequential",
    noise: { enabled: false, gate_error: 0.005, readout_error: 0.01 },
  };
}
