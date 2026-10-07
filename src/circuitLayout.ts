import type { Gate, QuantumEvent } from "./types";

export const circuitMetrics = {
  labelWidth: 94,
  headerHeight: 48,
  rowHeight: 36,
  gateWidth: 34,
  gateHeight: 26,
  columnWidth: 48,
  stagePadding: 12,
};

export type CircuitStageKind = "initial" | "cost" | "mixer";
export interface CircuitColumn {
  gateIndices: number[];
  stageId: string;
  x: number;
}
export interface CircuitStage {
  id: string;
  kind: CircuitStageKind;
  label: string;
  layer: number;
  parameter?: number;
  x: number;
  width: number;
  gateIndices: number[];
}
export interface CircuitLayout {
  width: number;
  height: number;
  rowCenters: number[];
  columns: CircuitColumn[];
  stages: CircuitStage[];
}

function stageId(gate: Gate) {
  return gate.gate.toLowerCase() === "h"
    ? "initial"
    : `${gate.gate.toLowerCase() === "rx" ? "mixer" : "cost"}-${gate.layer}`;
}

/** Layout the exported operation order; only the initial independent H gates share a column. */
export function buildCircuitLayout(
  gates: Gate[],
  freeIndices: number[],
  gammas: number[],
  betas: number[],
): CircuitLayout {
  if (!freeIndices.length)
    return { width: 0, height: 0, rowCenters: [], columns: [], stages: [] };
  const grouped: Omit<CircuitColumn, "x">[] = [];
  for (const [index, gate] of gates.entries()) {
    const previous = grouped.at(-1);
    const initialHadamard = gate.gate.toLowerCase() === "h" && gate.layer === 0;
    if (
      initialHadamard &&
      previous?.stageId === "initial" &&
      grouped.length === 1
    )
      previous.gateIndices.push(index);
    else grouped.push({ gateIndices: [index], stageId: stageId(gate) });
  }
  const definitions: Omit<CircuitStage, "x" | "width" | "gateIndices">[] = [
    { id: "initial", kind: "initial", label: "H", layer: 0 },
  ];
  for (let layer = 1; layer <= Math.max(gammas.length, betas.length); layer++) {
    definitions.push(
      {
        id: `cost-${layer}`,
        kind: "cost",
        label: `Cost ${layer}`,
        layer,
        parameter: gammas[layer - 1],
      },
      {
        id: `mixer-${layer}`,
        kind: "mixer",
        label: `Mixer ${layer}`,
        layer,
        parameter: betas[layer - 1],
      },
    );
  }
  const columns: CircuitColumn[] = [];
  const stages: CircuitStage[] = [];
  let x = 0;
  for (const definition of definitions) {
    const stageColumns = grouped.filter(
      (column) => column.stageId === definition.id,
    );
    const width = Math.max(
      definition.kind === "initial" ? 110 : 100,
      stageColumns.length * circuitMetrics.columnWidth +
        2 * circuitMetrics.stagePadding,
    );
    stages.push({
      ...definition,
      x,
      width,
      gateIndices: stageColumns.flatMap((column) => column.gateIndices),
    });
    stageColumns.forEach((column, index) =>
      columns.push({
        ...column,
        x:
          x +
          width / 2 +
          (index - (stageColumns.length - 1) / 2) * circuitMetrics.columnWidth,
      }),
    );
    x += width;
  }
  return {
    width: x,
    height:
      circuitMetrics.headerHeight +
      freeIndices.length * circuitMetrics.rowHeight +
      12,
    rowCenters: freeIndices.map(
      (_, index) =>
        circuitMetrics.headerHeight + (index + 0.5) * circuitMetrics.rowHeight,
    ),
    columns,
    stages,
  };
}

/** Layer summaries have no gate; an initialization snapshot represents the actual H prefix. */
export function activeCircuitGateIndices(gates: Gate[], event?: QuantumEvent) {
  if (!event) return [];
  if (event.event === "initialization") {
    const indices: number[] = [];
    for (const [index, gate] of gates.entries()) {
      if (gate.gate.toLowerCase() !== "h" || gate.layer !== 0) break;
      indices.push(index);
    }
    return indices;
  }
  if (!event.gate) return [];
  const index = gates.findIndex(
    (gate) =>
      gate.gate.toLowerCase() === event.gate?.toLowerCase() &&
      gate.layer === event.layer &&
      gate.qubits.length === event.qubits.length &&
      gate.qubits.every((qubit, index) => qubit === event.qubits[index]) &&
      (event.angle == null ||
        gate.angle == null ||
        Math.abs(gate.angle - event.angle) < 1e-12),
  );
  return index < 0 ? [] : [index];
}

export function activeCircuitStage(event?: QuantumEvent) {
  if (!event) return undefined;
  if (event.event === "initialization") return "initial";
  if (event.event.startsWith("cost")) return `cost-${event.layer}`;
  if (event.event.startsWith("mixer")) return `mixer-${event.layer}`;
  return undefined;
}
