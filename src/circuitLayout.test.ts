import { describe, expect, it } from "vitest";
import {
  activeCircuitGateIndices,
  activeCircuitStage,
  buildCircuitLayout,
  circuitMetrics,
} from "./circuitLayout";
import type { Gate, QuantumEvent } from "./types";

const free = [1, 5, 9];
const gates: Gate[] = [
  ...free.map((pixel, qubit) => ({
    gate: "h",
    layer: 0,
    qubits: [qubit],
    global_qubits: [pixel],
  })),
  { gate: "rzz", layer: 1, qubits: [0, 2], global_qubits: [1, 9], angle: -0.7 },
  { gate: "rz", layer: 1, qubits: [1], global_qubits: [5], angle: 0.14 },
  ...free.map((pixel, qubit) => ({
    gate: "rx",
    layer: 1,
    qubits: [qubit],
    global_qubits: [pixel],
    angle: 0.4,
  })),
  { gate: "rz", layer: 2, qubits: [1], global_qubits: [5], angle: -0.28 },
  ...free.map((pixel, qubit) => ({
    gate: "rx",
    layer: 2,
    qubits: [qubit],
    global_qubits: [pixel],
    angle: -0.2,
  })),
];
function event(properties: Partial<QuantumEvent>): QuantumEvent {
  return {
    event: "cost",
    layer: 1,
    gate: null,
    qubits: [],
    global_qubits: [],
    probabilities: [],
    amplitudes: [],
    phases: [],
    expected_energy: 0,
    ...properties,
  };
}

describe("actual circuit layout", () => {
  it("preserves every operation in order and groups only the initial H prefix", () => {
    const layout = buildCircuitLayout(gates, free, [0.7, 1.4], [0.2, -0.1]);
    expect(layout.columns.flatMap((column) => column.gateIndices)).toEqual(
      gates.map((_, index) => index),
    );
    expect(layout.columns).toHaveLength(gates.length - free.length + 1);
    expect(layout.columns[0].gateIndices).toEqual([0, 1, 2]);
    expect(
      layout.columns
        .slice(1)
        .every((column) => column.gateIndices.length === 1),
    ).toBe(true);
    expect(layout.stages.map((stage) => stage.label)).toEqual([
      "H",
      "Cost 1",
      "Mixer 1",
      "Cost 2",
      "Mixer 2",
    ]);
    expect(layout.stages.map((stage) => stage.gateIndices.length)).toEqual([
      3, 2, 3, 1, 3,
    ]);
    expect(layout.stages[1].parameter).toBe(0.7);
    expect(layout.stages[4].parameter).toBe(-0.1);
  });
  it("aligns qubit rows and keeps native gate sizes apart across stage boundaries", () => {
    const layout = buildCircuitLayout(gates, free, [0.7, 1.4], [0.2, -0.1]);
    expect(layout.rowCenters).toEqual([66, 102, 138]);
    expect(layout.height).toBe(168);
    expect(
      layout.columns.every(
        (column) =>
          column.x >= circuitMetrics.gateWidth / 2 &&
          column.x <= layout.width - circuitMetrics.gateWidth / 2,
      ),
    ).toBe(true);
    for (let index = 1; index < layout.columns.length; index++)
      expect(
        layout.columns[index].x - layout.columns[index - 1].x,
      ).toBeGreaterThanOrEqual(circuitMetrics.columnWidth);
  });
  it("shows an empty cost section without inventing a rotation gate", () => {
    const noCost = gates.filter(
      (gate) => gate.layer === 0 || (gate.layer === 1 && gate.gate === "rx"),
    );
    const layout = buildCircuitLayout(noCost, free, [0.7], [0.2]);
    expect(layout.stages[1]).toMatchObject({
      label: "Cost 1",
      gateIndices: [],
    });
    expect(layout.columns.flatMap((column) => column.gateIndices)).toEqual(
      noCost.map((_, index) => index),
    );
    expect(layout.columns).toHaveLength(4);
  });
  it("distinguishes the same qubit rotation in successive layers", () => {
    expect(
      activeCircuitGateIndices(
        gates,
        event({
          event: "mixer",
          gate: "rx",
          layer: 2,
          qubits: [1],
          angle: -0.2,
        }),
      ),
    ).toEqual([10]);
    expect(
      activeCircuitGateIndices(
        gates,
        event({
          event: "mixer",
          gate: "rx",
          layer: 1,
          qubits: [1],
          angle: 0.4,
        }),
      ),
    ).toEqual([6]);
    expect(
      activeCircuitGateIndices(
        gates,
        event({ gate: "rzz", qubits: [0, 2], angle: -0.7 }),
      ),
    ).toEqual([3]);
    expect(
      activeCircuitGateIndices(
        gates,
        event({ gate: "rzz", qubits: [0, 2], angle: 1.7 }),
      ),
    ).toEqual([]);
  });
  it("highlights the real initialization but gives layer summaries no active gate", () => {
    expect(
      activeCircuitGateIndices(
        gates,
        event({ event: "initialization", layer: 0 }),
      ),
    ).toEqual([0, 1, 2]);
    expect(
      activeCircuitGateIndices(gates, event({ event: "cost_layer" })),
    ).toEqual([]);
    expect(activeCircuitStage(event({ event: "cost_layer" }))).toBe("cost-1");
    expect(activeCircuitStage(event({ event: "mixer_layer", layer: 2 }))).toBe(
      "mixer-2",
    );
    expect(activeCircuitGateIndices(gates)).toEqual([]);
  });
  it("has no circuit geometry or made-up gates for a zero-qubit model", () => {
    expect(buildCircuitLayout([], [], [0.7], [0.2])).toEqual({
      width: 0,
      height: 0,
      rowCenters: [],
      columns: [],
      stages: [],
    });
  });
});
