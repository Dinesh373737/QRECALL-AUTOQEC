import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MathLab } from "./MathLab";
import { defaultConfig } from "./types";
import type { Result, QuantumEvent, MeasurementEvent } from "./types";

const trace: QuantumEvent = {
  event: "cost",
  layer: 1,
  gate: "rz",
  qubits: [0],
  global_qubits: [1],
  probabilities: [0.5, 0.25, 0.25, 0],
  amplitudes: [
    { real: Math.SQRT1_2, imag: 0 },
    { real: 0.3, imag: 0.4 },
    { real: -0.5, imag: 0 },
    { real: 0, imag: 0 },
  ],
  phases: [0, 0.927295218, Math.PI, null],
  expected_energy: -0.1875,
};
const final: MeasurementEvent = {
  event: "measurement",
  shots: 8,
  counts: { "0": 4, "1": 4 },
  output: [1, 1, -1],
  state_integer: 0,
  ties: [0, 1],
};
const snapshot = {
  index: 0,
  amplitude_norm: 1,
  probability_sum: 1,
  expected_energy: -0.1875,
  energy_variance: 0.43359375,
  basis_entropy_bits: 1.5,
  effective_basis_states: 8 / 3,
};
const result: Result = {
  schema_version: "1.0",
  config_hash: "test",
  revision: 0,
  config: {
    ...defaultConfig(),
    rows: 1,
    cols: 3,
    memories: [[1, 1, -1]],
    cue: [1, null, null],
  },
  model: {
    n: 3,
    rows: 1,
    cols: 3,
    weights: [],
    biases: [0, 0, 0],
    free_indices: [1, 2],
    trusted_indices: [0],
    fields: [0.1, 0.2],
    constant: 0,
    states: [
      [1, 1, 1],
      [1, -1, 1],
      [1, 1, -1],
      [1, -1, -1],
    ],
    free_states: [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ],
    energies: [-1, 0.5, 0.75, 1],
    initial_state: [1, 1, 1],
    mapping: [
      { local: 0, global: 1 },
      { local: 1, global: 2 },
    ],
  },
  hopfield: { trace: [], output: [1, 1, 1], resources: {} },
  gibbs: { trace: [], output: [1, 1, 1], resources: {} },
  quantum: {
    measurement_trace: [final],
    trace: [trace],
    output: final.output,
    counts: final.counts,
    probabilities: trace.probabilities,
    expected_energy: -0.1875,
    sampled_energy: -0.25,
    gammas: [0.7],
    betas: [0.35],
    gates: [],
    ties: [0, 1],
    resources: { shots: 8 },
    execution_mode: "ideal",
  },
  diagnostics: {
    source: "ideal_statevector",
    quantum_trace: [snapshot],
    quantum_final: snapshot,
    basis_energy: [
      {
        state_integer: 0,
        constant_energy: 0.1,
        pair_energy: -0.7,
        field_energy: -0.4,
        total_energy: -1,
      },
      {
        state_integer: 1,
        constant_energy: 0.1,
        pair_energy: 0.2,
        field_energy: 0.2,
        total_energy: 0.5,
      },
    ],
    notes: [],
  },
  references: {
    exact_minimum: { energy: -1, final_state: [1, 1, 1], ties: [0] },
    exact_gibbs: { probabilities: [], expected_energy: -1 },
    nearest_memory: { final_state: [1, 1, -1], ties: [0] },
  },
  provenance: {
    seed: 42,
    versions: {},
    execution_mode: "test",
    warnings: [],
    duration_ms: 0,
  },
};

function render(
  chapter: number,
  selectedState = 1,
  overrides: Partial<Parameters<typeof MathLab>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(MathLab, {
      result,
      chapter,
      selectedState,
      onSelectState: () => {},
      ...overrides,
    }),
  );
}

describe("scientific mathematics workbench", () => {
  it("shows exported local/global mapping, backend energies and conditioning contributions", () => {
    const markup = render(0);
    expect(markup).toContain("Pixel F[a]");
    expect(markup).toContain("Logical bits");
    expect(markup).toContain("1 0");
    expect(markup).toContain("Qiskit string");
    expect(markup).toContain("01");
    expect(markup).toContain("0.50000");
    expect(markup).toContain("Free field contribution");
  });

  it("plots actual real and imaginary amplitudes and marks an undefined phase", () => {
    const markup = render(4, 1, { quantumEvent: trace });
    expect(markup).toContain("Basis 1: real 0.300000, imaginary 0.400000");
    expect(markup).toContain("0.250000");
    expect(markup).toContain("0.92730 rad");
    expect(render(4, 3, { quantumEvent: trace })).toContain("Undefined");
    expect(markup).toContain("first nonzero amplitude as reference");
  });

  it("uses the current measurement prefix and gives absent basis counts zero", () => {
    const prefix = { ...final, shots: 2, counts: { "0": 2 }, ties: [0] };
    const markup = render(5, 1, { measurementEvent: prefix });
    expect(markup).toContain("2 shots in this prefix");
    expect(markup).toContain("Count for j = 1</span><strong>0</strong>");
    expect(markup).toContain(
      "Actual frequency</span><strong>0.000000</strong>",
    );
    expect(markup).toContain("Largest-count ties: 0.");
    expect(render(5)).toContain("Largest-count ties: 0, 1.");
  });

  it("distinguishes ideal amplitudes from noisy counts and zero-free no-shot results", () => {
    const noisy = {
      ...result,
      config: {
        ...result.config,
        noise: { ...result.config.noise, enabled: true },
      },
    };
    expect(render(4, 1, { result: noisy })).toContain(
      "do not describe the noisy mixed state",
    );
    const trusted: Result = {
      ...result,
      model: {
        ...result.model,
        free_indices: [],
        free_states: [[]],
        states: [[1, 1, -1]],
        energies: [-1],
      },
      quantum: {
        ...result.quantum,
        measurement_trace: [],
        resources: { shots: 0 },
        counts: {},
      },
    };
    expect(render(0, 0, { result: trusted })).toContain(
      "no quantum circuit or shots are needed",
    );
    expect(render(5, 0, { result: trusted })).toContain(
      "No empirical histogram or sampled decision is fabricated",
    );
  });
});
