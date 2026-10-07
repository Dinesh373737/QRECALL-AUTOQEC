import { useMemo, useEffect, useRef, useState, useId } from "react";
import katex from "katex";
import { LockKeyhole, Plus, Minus, Maximize2, X } from "lucide-react";
import type { RefObject } from "react";
import type { Spin, Result, QuantumEvent, ClassicalEvent } from "./types";
import {
  activeCircuitGateIndices,
  activeCircuitStage,
  buildCircuitLayout,
  circuitMetrics,
} from "./circuitLayout";
import { formulaPresentation } from "./formulas";
import "./formulas.css";
export { formulas } from "./formulas";

export function Equation({ tex, label }: { tex: string; label?: string }) {
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const details = useMemo(() => formulaPresentation(tex), [tex]);
  const title = label || details.title;
  const html = useMemo(
    () =>
      katex.renderToString(details.tex, {
        throwOnError: true,
        displayMode: true,
        output: "htmlAndMathml",
      }),
    [details.tex],
  );
  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      expandButton.current?.focus({ preventScroll: true });
    };
  }, [expanded]);
  const close = () => {
    dialog.current?.close();
    setExpanded(false);
  };
  return (
    <>
      <div className="equation equation-card">
        <div className="equation-heading">
          <span className="equation-title">{title}</span>
          <button
            ref={expandButton}
            type="button"
            className="equation-expand"
            aria-label={`Expand formula: ${title}`}
            aria-haspopup="dialog"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 size={12} aria-hidden="true" />
            <span>Expand</span>
          </button>
        </div>
        <div
          className="equation-math"
          role="math"
          aria-label={title}
          tabIndex={0}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      {expanded && (
        <dialog
          ref={dialog}
          className="formula-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={details.description ? descriptionId : undefined}
          onClose={() => setExpanded(false)}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onKeyDown={(event) => {
            // Keep playback and presenter shortcuts behind the modal.
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              close();
          }}
        >
          <div className="formula-dialog-heading">
            <div>
              <span className="formula-dialog-kicker">MATHEMATICAL MODEL</span>
              <h2 id={titleId}>{title}</h2>
            </div>
            <button
              type="button"
              className="formula-dialog-close"
              onClick={close}
              aria-label="Close formula"
              autoFocus
            >
              <X size={19} aria-hidden="true" />
            </button>
          </div>
          {details.description && (
            <p className="formula-description" id={descriptionId}>
              {details.description}
            </p>
          )}
          <div
            className="formula-dialog-equation"
            role="math"
            aria-label={title}
            tabIndex={0}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {details.symbols && (
            <div className="formula-symbols">
              <h3>Reading the symbols</h3>
              <dl>
                {details.symbols.map(({ symbol, meaning }) => (
                  <div key={symbol}>
                    <dt
                      dangerouslySetInnerHTML={{
                        __html: katex.renderToString(symbol, {
                          throwOnError: true,
                          output: "htmlAndMathml",
                        }),
                      }}
                    />
                    <dd>{meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <p className="formula-dialog-hint">
            Press Escape or click outside to return.
          </p>
        </dialog>
      )}
    </>
  );
}
export const num = (v: number | null | undefined, d = 3) =>
  Number.isFinite(v) ? Number(v).toFixed(d) : "—";
export function Pattern({
  values,
  cols,
  onCell,
  selected,
  clamped = [],
  large = false,
  aria = "Pattern",
}: {
  values: (Spin | null)[];
  cols: number;
  onCell?: (i: number) => void;
  selected?: number;
  clamped?: number[];
  large?: boolean;
  aria?: string;
}) {
  return (
    <div
      className={`pattern ${large ? "large" : ""}`}
      style={{ gridTemplateColumns: `repeat(${cols},1fr)` }}
      role="group"
      aria-label={aria}
    >
      {values.map((s, i) => {
        const title = `Pixel ${i}: ${s === null ? "unknown" : s === 1 ? "filled · spin +1 · bit 0" : "hollow · spin −1 · bit 1"}${clamped.includes(i) ? " · trusted" : ""}`;
        const contents = (
          <>
            {s === null ? (
              <span className="unknown-mark">?</span>
            ) : clamped.includes(i) && large ? (
              <LockKeyhole size={10} />
            ) : null}
            <span className="sr-only">{title}</span>
          </>
        );
        return onCell ? (
          <button
            key={i}
            className={`pixel ${s === 1 ? "filled" : s === null ? "unknown" : "hollow"} ${selected === i ? "selected" : ""} ${clamped.includes(i) ? "clamped" : ""}`}
            title={title}
            aria-label={title}
            onClick={() => onCell(i)}
          >
            {contents}
          </button>
        ) : (
          <div
            key={i}
            className={`pixel ${s === 1 ? "filled" : s === null ? "unknown" : "hollow"} ${selected === i ? "selected" : ""} ${clamped.includes(i) ? "clamped" : ""}`}
            title={title}
          >
            {contents}
          </div>
        );
      })}
    </div>
  );
}
export function WeightMatrix({
  result,
  pair,
  onPair,
  memory,
}: {
  result: Result;
  pair: [number, number];
  onPair: (p: [number, number]) => void;
  memory: number;
}) {
  const n = result.model.n;
  return (
    <div className="matrix-wrap">
      <div className="section-label">
        <span>HEBBIAN WEIGHT MATRIX</span>
        <span className="mono">
          {n} × {n}
        </span>
      </div>
      <div
        className="weight-matrix"
        style={{ gridTemplateColumns: `repeat(${n},1fr)` }}
        role="group"
        aria-label="Weight matrix. Select a pair to inspect its connection."
      >
        {result.model.weights.flatMap((row, i) =>
          row.map((w, j) => (
            <button
              key={`${i}-${j}`}
              onFocus={() => onPair([i, j])}
              onMouseEnter={() => onPair([i, j])}
              onClick={() => onPair([i, j])}
              aria-label={`Connection ${i} to ${j}, weight ${num(w)}`}
              style={{
                background:
                  i === j
                    ? "#111722"
                    : w >= 0
                      ? `rgba(105,222,203,${0.08 + Math.abs(w) * 2})`
                      : `rgba(229,163,102,${0.08 + Math.abs(w) * 2})`,
              }}
              className={pair[0] === i && pair[1] === j ? "active" : ""}
            />
          )),
        )}
      </div>
      <div className="matrix-detail mono">
        W
        <sub>
          {pair[0]},{pair[1]}
        </sub>{" "}
        = <span>{num(result.model.weights[pair[0]][pair[1]])}</span>
        {result.model.memory_contributions && (
          <small>
            {" "}
            Memory {memory + 1}:{" "}
            {num(result.model.memory_contributions[memory][pair[0]][pair[1]])}
          </small>
        )}
      </div>
    </div>
  );
}
export function EnergyChart({
  events,
  index,
}: {
  events: ClassicalEvent[];
  index: number;
}) {
  const data = events.map((e) => e.energy_after);
  if (!data.length) return null;
  const min = Math.min(...data),
    max = Math.max(...data),
    span = max - min || 1;
  const x = (i: number) => 35 + (i / Math.max(1, data.length - 1)) * 320,
    y = (v: number) => 83 - ((v - min) / span) * 60;
  const path = data.map((v, i) => `${i ? "L" : "M"} ${x(i)} ${y(v)}`).join(" ");
  return (
    <div className="energy-chart">
      <div className="section-label">
        <span>ENERGY / UPDATE</span>
        <span>normalized units</span>
      </div>
      <svg
        viewBox="0 0 370 105"
        role="img"
        aria-label="Energy at each actual update"
      >
        <line x1="35" y1="83" x2="355" y2="83" stroke="#29313e" />
        <line x1="35" y1="23" x2="35" y2="83" stroke="#29313e" />
        <text x="3" y="28">
          {num(max, 1)}
        </text>
        <text x="3" y="85">
          {num(min, 1)}
        </text>
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
        <circle
          cx={x(index)}
          cy={y(data[index] ?? data[0])}
          r="4"
          fill="var(--accent)"
        />
        <text x="35" y="101">
          0
        </text>
        <text x="328" y="101">
          {data.length}
        </text>
      </svg>
    </div>
  );
}
export function Circuit({
  result,
  event,
}: {
  result: Result;
  event?: QuantumEvent;
}) {
  const q = result.model.free_indices.length;
  const scroll = useRef<HTMLDivElement>(null);
  const layout = useMemo(
    () =>
      buildCircuitLayout(
        result.quantum.gates,
        result.model.free_indices,
        result.quantum.gammas,
        result.quantum.betas,
      ),
    [
      result.quantum.gates,
      result.model.free_indices,
      result.quantum.gammas,
      result.quantum.betas,
    ],
  );
  const activeIndices = activeCircuitGateIndices(result.quantum.gates, event);
  const activeStage = activeCircuitStage(event);
  useEffect(() => {
    const viewport = scroll.current;
    if (!event || !viewport) return;
    const indices = activeCircuitGateIndices(result.quantum.gates, event);
    const column = layout.columns.find((column) =>
      column.gateIndices.some((index) => indices.includes(index)),
    );
    const stage = layout.stages.find(
      (stage) => stage.id === activeCircuitStage(event),
    );
    const x =
      column?.x ??
      (stage ? stage.x + Math.min(stage.width / 2, 60) : undefined);
    if (x === undefined) return;
    const margin = 32;
    if (
      x - margin < viewport.scrollLeft ||
      x + margin > viewport.scrollLeft + viewport.clientWidth
    )
      viewport.scrollTo({
        left: Math.max(0, x - viewport.clientWidth / 2),
        behavior: "auto",
      });
    // Only a newly selected computed event moves the viewport. Parent renders
    // and selection in the state-space lesson leave manual circuit scrolling alone.
  }, [event]);
  if (!q)
    return (
      <div className="circuit-empty">
        All pixels observed · 0 qubits · no quantum circuit is executed.
      </div>
    );
  const operation = event?.gate
    ? `${event.gate.toUpperCase()}(${num(event.angle, 4)} rad)`
    : event?.event === "initialization"
      ? "H · initialize the free qubits"
      : event?.event === "cost_layer"
        ? `Cost ${event.layer} complete`
        : event?.event === "mixer_layer"
          ? `Mixer ${event.layer} complete`
          : "Actual operation order: H, cost, mixer";
  const mapping = event?.gate
    ? event.qubits
        .map(
          (qubit, index) => `q${qubit} → pixel ${event.global_qubits[index]}`,
        )
        .join(" · ")
    : event?.event === "initialization"
      ? result.model.free_indices
          .map((pixel, qubit) => `q${qubit} → pixel ${pixel}`)
          .join(" · ")
      : event
        ? `Layer ${event.layer} · expected energy ${num(event.expected_energy)}`
        : `${q} free pixels · each exported rotation has its own column`;
  return (
    <div className="circuit-diagram">
      <div className="circuit-grid">
        <svg
          className="circuit-labels"
          width={circuitMetrics.labelWidth}
          height={layout.height}
          viewBox={`0 0 ${circuitMetrics.labelWidth} ${layout.height}`}
          aria-hidden="true"
          style={{
            width: circuitMetrics.labelWidth,
            minWidth: circuitMetrics.labelWidth,
            height: layout.height,
            maxHeight: "none",
            maxWidth: "none",
            flexShrink: 0,
          }}
        >
          <text x="8" y="23" fontSize="10" fill="#9eaec0">
            QUBIT / PIXEL
          </text>
          {result.model.free_indices.map((pixel, index) => (
            <g key={index}>
              <text
                x="8"
                y={layout.rowCenters[index] + 4}
                fontSize="12"
                fill="#d0dbe5"
              >
                q{index} · x{pixel}
              </text>
              <line
                x1="76"
                x2={circuitMetrics.labelWidth}
                y1={layout.rowCenters[index]}
                y2={layout.rowCenters[index]}
                stroke="#465064"
              />
            </g>
          ))}
        </svg>
        <div
          className="circuit-scroll"
          ref={scroll}
          tabIndex={0}
          role="region"
          aria-label="Circuit gates. Scroll horizontally to inspect every operation."
        >
          <svg
            className="circuit-gates"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width={layout.width}
            height={layout.height}
            style={{
              width: layout.width,
              minWidth: layout.width,
              height: layout.height,
              maxWidth: "none",
              maxHeight: "none",
              flexShrink: 0,
            }}
            role="img"
            aria-label="Actual Qiskit QAOA circuit. Qubit labels show global pixel indices."
          >
            {layout.stages.map((stage) => (
              <g
                className={`circuit-stage ${stage.kind}${stage.id === activeStage ? " active" : ""}`}
                key={stage.id}
              >
                <title>
                  {stage.kind === "initial"
                    ? "Initial Hadamard gates create the uniform superposition."
                    : `${stage.label} · ${stage.kind === "cost" ? "γ" : "β"} = ${num(stage.parameter, 4)} radians · ${stage.gateIndices.length} actual gates`}
                </title>
                <rect
                  x={stage.x}
                  y="0"
                  width={stage.width}
                  height={layout.height}
                  fill={
                    stage.id === activeStage
                      ? "#171d30"
                      : stage.layer % 2
                        ? "#0d1421"
                        : "#0b111c"
                  }
                />
                <line
                  x1={stage.x}
                  x2={stage.x}
                  y1="0"
                  y2={layout.height}
                  stroke="#2d3547"
                  strokeDasharray="3 3"
                />
                <text
                  x={stage.x + 10}
                  y="20"
                  fontSize="11"
                  fill={stage.kind === "mixer" ? "#8fe0d2" : "#c8baf4"}
                >
                  {stage.label}
                </text>
                <text x={stage.x + 10} y="36" fontSize="10" fill="#92a0b5">
                  {stage.kind === "initial"
                    ? "superposition"
                    : `${stage.kind === "cost" ? "γ" : "β"} ${num(stage.parameter, 3)}`}
                </text>
                {!stage.gateIndices.length && (
                  <text
                    x={stage.x + stage.width / 2}
                    y={layout.rowCenters[0] + 4}
                    textAnchor="middle"
                    fill="#8a97ab"
                    fontSize="10"
                  >
                    no rotations
                  </text>
                )}
              </g>
            ))}
            {layout.rowCenters.map((y, index) => (
              <line
                key={index}
                x1="0"
                x2={layout.width}
                y1={y}
                y2={y}
                stroke="#465064"
              />
            ))}
            {layout.columns.flatMap((column) =>
              column.gateIndices.map((index) => {
                const gate = result.quantum.gates[index];
                const active = activeIndices.includes(index);
                const color =
                  gate.gate === "rx"
                    ? "#75d6c2"
                    : gate.gate === "h"
                      ? "#92b4db"
                      : "#b5a2ff";
                const title = `${gate.gate.toUpperCase()}${gate.angle == null ? "" : `(${num(gate.angle, 4)} radians)`} · ${gate.qubits.map((qubit, i) => `q${qubit} → pixel ${gate.global_qubits[i]}`).join(" · ")} · ${gate.layer ? `layer ${gate.layer}` : "initialization"}`;
                return (
                  <g
                    key={index}
                    className={`circuit-gate${active ? " active" : ""}`}
                    data-gate-index={index}
                    opacity={active ? 1 : 0.82}
                  >
                    <title>{title}</title>
                    {gate.qubits.length > 1 && (
                      <line
                        x1={column.x}
                        x2={column.x}
                        y1={layout.rowCenters[Math.min(...gate.qubits)]}
                        y2={layout.rowCenters[Math.max(...gate.qubits)]}
                        stroke={active ? "#f0eaff" : color}
                        strokeWidth={active ? 2.5 : 1.5}
                      />
                    )}
                    {gate.qubits.map((qubit) => (
                      <g key={qubit}>
                        <rect
                          x={column.x - circuitMetrics.gateWidth / 2}
                          y={
                            layout.rowCenters[qubit] -
                            circuitMetrics.gateHeight / 2
                          }
                          width={circuitMetrics.gateWidth}
                          height={circuitMetrics.gateHeight}
                          rx="4"
                          fill={active ? "#7f66bf" : "#172337"}
                          stroke={active ? "#f0eaff" : color}
                          strokeWidth={active ? 2 : 1}
                        />
                        <text
                          x={column.x}
                          y={layout.rowCenters[qubit] + 4}
                          textAnchor="middle"
                          fontSize="11"
                          fill="#f0eaff"
                        >
                          {gate.gate.toUpperCase()}
                        </text>
                      </g>
                    ))}
                  </g>
                );
              }),
            )}
          </svg>
        </div>
      </div>
      <div className="circuit-active-readout" aria-live="polite">
        <strong className="circuit-active-title">{operation}</strong>
        <span className="circuit-active-mapping">{mapping}</span>
      </div>
      <p className="circuit-scroll-hint">
        Scroll gates left to right · qubit labels stay fixed · hover a gate for
        its actual angle.
      </p>
    </div>
  );
}
export function Distribution({
  result,
  probabilities,
  counts,
  reference,
  onState,
  selected,
}: {
  result: Result;
  probabilities?: number[];
  counts?: Record<string, number>;
  reference?: number[];
  onState: (i: number) => void;
  selected: number;
}) {
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  const probs = probabilities || result.quantum.probabilities;
  const top = probs
    .map((p, i) => ({ p, i }))
    .sort((a, b) =>
      counts ? (counts[b.i] || 0) - (counts[a.i] || 0) : b.p - a.p,
    )
    .slice(0, 6);
  const max = Math.max(
    ...top.map((s) => Math.max(s.p, (counts?.[s.i] || 0) / (total || 1))),
    0.05,
  );
  return (
    <div className="distribution">
      <div className="section-label">
        <span>TOP CONFIGURATIONS</span>
        <span>{counts ? "ideal / sampled" : "basis probability"}</span>
      </div>
      {top.map(({ p, i }) => (
        <button
          key={i}
          className={`distribution-row ${selected === i ? "active" : ""}`}
          onClick={() => onState(i)}
        >
          <span className="mono">
            {result.model.free_states[i]
              ?.map((s) => (s === 1 ? "0" : "1"))
              .join("") || "∅"}
          </span>
          <span className="bar-track">
            <span
              className="prob-bar"
              style={{ width: `${(p / max) * 100}%` }}
            />
            {counts && (
              <span
                className="sample-bar"
                style={{
                  width: `${((counts[i] || 0) / (total || 1) / max) * 100}%`,
                }}
              />
            )}
            {reference && (
              <span
                className="reference-marker"
                style={{ left: `${(reference[i] / max) * 100}%` }}
              />
            )}
          </span>
          <span className="mono">{(p * 100).toFixed(1)}%</span>
        </button>
      ))}
      <p className="fine-print">
        Logical free-pixel order · bar height is probability, not correctness
        confidence.
      </p>
    </div>
  );
}
export function FieldGraph({
  result,
  event,
  playing = false,
  progressRef,
}: {
  result: Result;
  event?: ClassicalEvent;
  playing?: boolean;
  progressRef?: RefObject<number>;
}) {
  const pulses = useRef<SVGCircleElement[]>([]);
  useEffect(() => {
    if (!event || !progressRef) return;
    let raf = 0;
    const n = result.model.n;
    const xy = (i: number) => ({
      x: 135 + 95 * Math.cos((i / n) * Math.PI * 2 - Math.PI / 2),
      y: 110 + 80 * Math.sin((i / n) * Math.PI * 2 - Math.PI / 2),
    });
    const to = xy(event.neuron);
    const frame = () => {
      const t = progressRef.current;
      event.contributions.forEach((c, k) => {
        const from = xy(c.neuron);
        const node = pulses.current[k];
        if (node) {
          node.setAttribute("cx", String(from.x + (to.x - from.x) * t));
          node.setAttribute("cy", String(from.y + (to.y - from.y) * t));
        }
      });
      if (playing) raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [event, playing, progressRef, result.model.n]);
  if (!event) return null;
  const n = result.model.n,
    selected = event.neuron;
  const coords = (i: number) => ({
    x: 135 + 95 * Math.cos((i / n) * Math.PI * 2 - Math.PI / 2),
    y: 110 + 80 * Math.sin((i / n) * Math.PI * 2 - Math.PI / 2),
  });
  const p = coords(selected);
  return (
    <svg
      className="field-graph"
      viewBox="0 0 270 220"
      role="img"
      aria-label={`Local field at pixel ${selected}: ${num(event.local_field)}`}
    >
      {(event.contributions || []).map((c, k) => {
        const other = c.neuron ?? (c as unknown as { index: number }).index;
        const v = coords(other);
        return (
          <g key={k}>
            <line
              x1={v.x}
              y1={v.y}
              x2={p.x}
              y2={p.y}
              stroke={c.value >= 0 ? "#70ddd0" : "#eac17d"}
              opacity=".7"
              strokeWidth={1 + Math.abs(c.value) * 2}
              strokeDasharray={c.value < 0 ? "3 3" : undefined}
            />
            {
              <circle
                ref={(node) => {
                  if (node) pulses.current[k] = node;
                }}
                cx={v.x + (p.x - v.x) * (progressRef?.current ?? 1)}
                cy={v.y + (p.y - v.y) * (progressRef?.current ?? 1)}
                r={2 + Math.abs(c.value) * 4}
                fill={c.value >= 0 ? "#b3efe0" : "#0c111a"}
                stroke={c.value >= 0 ? "#70ddd0" : "#eac17d"}
              />
            }
          </g>
        );
      })}
      {event.state_after.map((s, i) => {
        const v = coords(i);
        return (
          <g key={i}>
            <circle
              cx={v.x}
              cy={v.y}
              r={i === selected ? 14 : 9}
              fill={s === 1 ? "#91cfc4" : "#171e2a"}
              stroke={i === selected ? "white" : "#4d6470"}
              strokeWidth={i === selected ? 2 : 1}
            />
            <text
              x={v.x}
              y={v.y + 3.5}
              textAnchor="middle"
              fill={s === 1 ? "#0b181b" : "#b6c0ce"}
              fontSize="10"
            >
              {i}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
export function Legend() {
  return (
    <div className="pixel-legend">
      <span>
        <i className="filled" />
        +1 / filled
      </span>
      <span>
        <i className="hollow" />
        −1 / hollow
      </span>
      <span>
        <i className="unknown" />
        unknown
      </span>
    </div>
  );
}
export function SmallSign({ value }: { value: number }) {
  return value >= 0 ? <Plus size={12} /> : <Minus size={12} />;
}
