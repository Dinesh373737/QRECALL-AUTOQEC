import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Equation, Pattern, num } from "./components";
import { formulas } from "./formulas";
import type {
  ClassicalEvent,
  MeasurementEvent,
  QuantumEvent,
  Result,
} from "./types";
import "./MathLab.css";

export interface MathLabProps {
  result: Result;
  chapter: number;
  quantumEvent?: QuantumEvent;
  event?: ClassicalEvent;
  measurementEvent?: MeasurementEvent;
  selectedState: number;
  onSelectState: (state: number) => void;
  onClose?: () => void;
}

const tabs = [
  "State & energy",
  "Complex amplitude",
  "Expectation",
  "Measurement",
];

/** This workbench reads exported arrays and diagnostics; it does not run a solver. */
export function MathLab({
  result,
  chapter,
  quantumEvent,
  event,
  measurementEvent,
  selectedState,
  onSelectState,
  onClose,
}: MathLabProps) {
  const [tab, setTab] = useState(chapter === 4 ? 1 : chapter === 5 ? 3 : 0);
  const id = useId();
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => setTab(chapter === 4 ? 1 : chapter === 5 ? 3 : 0), [chapter]);
  const stateCount = result.model.states.length;
  const selected = Math.max(0, Math.min(stateCount - 1, selectedState));
  const freeSpins = result.model.free_states[selected] || [];
  const logicalBits = freeSpins.map((spin) => (spin === 1 ? 0 : 1));
  const state = result.model.states[selected];
  const snapshot = quantumEvent || result.quantum.trace.at(-1);
  const snapshotIndex = snapshot ? result.quantum.trace.indexOf(snapshot) : -1;
  const diagnostics =
    snapshotIndex >= 0
      ? result.diagnostics?.quantum_trace[snapshotIndex]
      : !snapshot
        ? result.diagnostics?.quantum_final
        : undefined;
  const energyBreakdown = result.diagnostics?.basis_energy[selected];
  const amplitude = snapshot?.amplitudes[selected];
  const probability =
    snapshot?.probabilities[selected] ?? result.quantum.probabilities[selected];
  const relativePhase = snapshot?.phases[selected];
  const prefix = measurementEvent || result.quantum.measurement_trace.at(-1);
  const count = prefix
    ? prefix.counts[String(selected)] || 0
    : result.quantum.counts[String(selected)] || 0;
  const shots = prefix?.shots ?? Number(result.quantum.resources.shots || 0);
  const modal = prefix?.state_integer;
  const ties = prefix?.ties || result.quantum.ties;
  const noisy = result.config.noise.enabled;
  const choose = (next: number) =>
    onSelectState(Math.max(0, Math.min(stateCount - 1, next)));
  const snapshotLabel = snapshot
    ? `${snapshot.gate?.toUpperCase() || snapshot.event} · layer ${snapshot.layer}`
    : "No circuit executed";
  return (
    <section
      className="math-lab"
      aria-label="Interactive mathematics workbench"
      onKeyDown={(key) => key.stopPropagation()}
    >
      <header className="math-lab-header">
        <div>
          <span className="math-lab-kicker">THE MATHEMATICS / LIVE DATA</span>
          <h2>Inspect the state behind the picture.</h2>
          <p>
            Choose a basis state. Follow its encoding, amplitude, energy and
            actual measured count.
          </p>
        </div>
        <div className="math-lab-basis-picker">
          <label htmlFor={`${id}-basis`}>Selected basis integer</label>
          <div>
            <button
              type="button"
              aria-label="Previous math basis state"
              disabled={selected === 0}
              onClick={() => choose(selected - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <select
              id={`${id}-basis`}
              value={selected}
              onChange={(change) => choose(Number(change.target.value))}
            >
              {result.model.states.map((_, index) => (
                <option value={index} key={index}>
                  j = {index} · E = {num(result.model.energies[index])}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Next math basis state"
              disabled={selected >= stateCount - 1}
              onClick={() => choose(selected + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            className="math-lab-close"
            aria-label="Close math lab"
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
            <span>Close</span>
          </button>
        )}
      </header>
      <div
        className="math-lab-tabs"
        role="tablist"
        aria-label="Mathematical views"
      >
        {tabs.map((label, index) => (
          <button
            key={label}
            type="button"
            ref={(button) => {
              tabButtons.current[index] = button;
            }}
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={tab === index}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={tab === index ? 0 : -1}
            onClick={() => setTab(index)}
            onKeyDown={(key) => {
              const next =
                key.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : key.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : key.key === "Home"
                      ? 0
                      : key.key === "End"
                        ? tabs.length - 1
                        : null;
              if (next === null) return;
              key.preventDefault();
              setTab(next);
              tabButtons.current[next]?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="math-lab-panel"
        role="tabpanel"
        id={`${id}-panel-${tab}`}
        aria-labelledby={`${id}-tab-${tab}`}
      >
        {tab === 0 && (
          <div className="math-lab-columns">
            <div>
              <div className="math-lab-state-heading">
                <Pattern
                  values={state}
                  cols={result.model.cols}
                  aria={`Full reconstruction of basis state ${selected}`}
                />
                <div>
                  <span className="math-lab-kicker">
                    BASIS STATE {selected}
                  </span>
                  <h3>Bits become spins.</h3>
                  <p>
                    Trusted pixels in this full pattern remain fixed. Only the{" "}
                    {freeSpins.length} free pixels appear in the basis encoding.
                  </p>
                </div>
              </div>
              <div className="math-lab-table-scroll">
                <table className="math-lab-mapping">
                  <caption>
                    Logical order starts with local qubit zero. Qiskit strings
                    show the highest qubit first.
                  </caption>
                  <thead>
                    <tr>
                      <th>Local qubit a</th>
                      <th>Pixel F[a]</th>
                      <th>Bit xₐ</th>
                      <th>Spin / Z</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.model.free_indices.map((pixel, local) => (
                      <tr key={pixel}>
                        <td>{local}</td>
                        <td>{pixel}</td>
                        <td>{logicalBits[local]}</td>
                        <td
                          className={
                            freeSpins[local] === 1 ? "positive" : "negative"
                          }
                        >
                          {freeSpins[local] > 0 ? "+1" : "−1"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!freeSpins.length && (
                <p className="math-lab-note">
                  All pixels are trusted. The cue returns directly; no quantum
                  circuit or shots are needed.
                </p>
              )}
              {freeSpins.length > 0 && (
                <p className="math-lab-bit-order">
                  <span>Logical bits</span>
                  <strong>{logicalBits.join(" ")}</strong>
                  <span>Qiskit string</span>
                  <strong>{[...logicalBits].reverse().join("")}</strong>
                </p>
              )}
            </div>
            <div>
              <Equation tex={formulas.export} />
              <Equation tex={formulas.pauli} />
              <details className="math-lab-more">
                <summary>How this state enters the Hamiltonian</summary>
                <Equation tex={formulas.hamiltonian} />
                <p className="math-lab-note">
                  Each displayed Z eigenvalue is the corresponding free spin.
                  The backend evaluates its pair and field terms, then adds the
                  trusted-pixel constant.
                </p>
              </details>
              <div className="math-lab-energy">
                <span>Backend energy E({selected})</span>
                <strong>{num(result.model.energies[selected], 5)}</strong>
              </div>
              {energyBreakdown && (
                <dl className="math-lab-breakdown">
                  <div>
                    <dt>Trusted-pixel constant</dt>
                    <dd>{num(energyBreakdown.constant_energy, 5)}</dd>
                  </div>
                  <div>
                    <dt>Free pair contribution</dt>
                    <dd>{num(energyBreakdown.pair_energy, 5)}</dd>
                  </div>
                  <div>
                    <dt>Free field contribution</dt>
                    <dd>{num(energyBreakdown.field_energy, 5)}</dd>
                  </div>
                  <div>
                    <dt>Total conditioned energy</dt>
                    <dd>{num(energyBreakdown.total_energy, 5)}</dd>
                  </div>
                </dl>
              )}
              {event && (
                <p className="math-lab-note">
                  Current classical update: pixel {event.neuron}, local field{" "}
                  {num(event.local_field)}, energy {num(event.energy_before)} →{" "}
                  {num(event.energy_after)}. The selected basis above is a
                  separate inspection.
                </p>
              )}
            </div>
          </div>
        )}
        {tab === 1 && (
          <div className="math-lab-columns">
            <div>
              <div className="math-lab-view-heading">
                <h3>The complex plane.</h3>
                <span>{snapshotLabel}</span>
              </div>
              {amplitude ? (
                <ArgandPlot
                  amplitudes={snapshot!.amplitudes}
                  selected={selected}
                  onSelect={choose}
                />
              ) : (
                <div className="math-lab-empty">
                  No statevector snapshot is available for this cue.
                </div>
              )}
              <p className="math-lab-note">
                Each point is an exported basis amplitude. The highlighted
                vector shows the raw real and imaginary components for j ={" "}
                {selected}. Overlapping points represent equal amplitudes; use
                the selector to inspect them.
              </p>
            </div>
            <div>
              <Equation tex={formulas.amplitude} />
              <div className="math-lab-stat-grid">
                <Stat
                  label="Real component"
                  value={amplitude ? num(amplitude.real, 6) : "—"}
                />
                <Stat
                  label="Imaginary component"
                  value={amplitude ? num(amplitude.imag, 6) : "—"}
                />
                <Stat
                  label="Squared magnitude / Pⱼ"
                  value={amplitude ? num(probability, 6) : "—"}
                />
                <Stat
                  label="Relative phase"
                  value={
                    relativePhase == null
                      ? "Undefined"
                      : `${num(relativePhase, 5)} rad`
                  }
                />
              </div>
              <p className="math-lab-note">
                Relative phase uses the first nonzero amplitude as reference.
                Near-zero amplitudes have undefined phase. The plane retains the
                raw global phase from the backend.
              </p>
              {noisy && (
                <p className="math-lab-caution">
                  This is the ideal pure-state lesson. Device noise affects
                  measured counts; these amplitudes do not describe the noisy
                  mixed state.
                </p>
              )}
            </div>
          </div>
        )}
        {tab === 2 && (
          <>
            <div className="math-lab-view-heading">
              <h3>A distribution over the same energy.</h3>
              <span>{snapshotLabel} · IDEAL</span>
            </div>
            <div className="math-lab-columns">
              <div>
                <Equation tex={formulas.expectation} />
                <Equation tex={formulas.normalization} />
                <BasisDistribution
                  result={result}
                  probabilities={
                    snapshot?.probabilities || result.quantum.probabilities
                  }
                  selected={selected}
                  onSelect={choose}
                />
                <p className="math-lab-note">
                  The bar height is exported probability. Select any bar or use
                  the basis selector; the inspected state has E ={" "}
                  {num(result.model.energies[selected])} and P ={" "}
                  {num(probability, 6)}.
                </p>
              </div>
              <div>
                <div className="math-lab-stat-grid">
                  <Stat
                    label="Expected energy"
                    value={num(
                      diagnostics?.expected_energy ??
                        snapshot?.expected_energy ??
                        result.quantum.expected_energy,
                      6,
                    )}
                  />
                  <Stat
                    label="Amplitude norm"
                    value={num(diagnostics?.amplitude_norm, 9)}
                  />
                  <Stat
                    label="Probability sum"
                    value={num(diagnostics?.probability_sum, 9)}
                  />
                  <Stat
                    label="Energy variance"
                    value={num(diagnostics?.energy_variance, 6)}
                  />
                  <Stat
                    label="Basis entropy"
                    value={
                      diagnostics
                        ? `${num(diagnostics.basis_entropy_bits, 4)} bits`
                        : "—"
                    }
                  />
                  <Stat
                    label="Effective basis states"
                    value={num(diagnostics?.effective_basis_states, 3)}
                  />
                </div>
                <details className="math-lab-more">
                  <summary>How the spread is measured</summary>
                  <Equation tex={formulas.variance} />
                  <Equation tex={formulas.entropy} />
                  <Equation tex={formulas.participation} />
                </details>
                <p className="math-lab-note">
                  These diagnostics describe the computational basis
                  distribution. Basis entropy and effective state count measure
                  spread, not entanglement or memory-recovery confidence.
                </p>
                {!diagnostics && (
                  <p className="math-lab-note">
                    Recompute this experiment to load the expanded backend
                    diagnostics.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
        {tab === 3 && (
          <div className="math-lab-columns">
            <div>
              <div className="math-lab-view-heading">
                <h3>Actual finite measurements.</h3>
                <span>
                  {shots} shots {measurementEvent ? "in this prefix" : "total"}
                </span>
              </div>
              <BasisDistribution
                result={result}
                probabilities={result.quantum.probabilities}
                counts={prefix?.counts || result.quantum.counts}
                shots={shots}
                selected={selected}
                onSelect={choose}
              />
              <p className="math-lab-chart-key">
                <span className="ideal">Ideal probability</span>
                <span className="measured">Actual shot frequency</span>
              </p>
              <p className="math-lab-note">
                Measurements come from actual Aer shot memory. Prefix playback
                uses the true counts accumulated so far.
              </p>
              {noisy && (
                <p className="math-lab-caution">
                  Noise is enabled. Ideal probabilities and noisy measured
                  frequencies are intentionally shown separately.
                </p>
              )}
            </div>
            <div>
              <Equation tex={formulas.measure} />
              <div className="math-lab-stat-grid">
                <Stat
                  label={`Count for j = ${selected}`}
                  value={String(count)}
                />
                <Stat
                  label="Actual frequency"
                  value={shots > 0 ? num(count / shots, 6) : "No shots"}
                />
                <Stat
                  label="Final ideal probability"
                  value={num(result.quantum.probabilities[selected], 6)}
                />
                <Stat
                  label="Modal basis state"
                  value={modal == null ? "No shots" : String(modal)}
                />
              </div>
              <div className="math-lab-decision">
                <h4>What decides the reconstruction?</h4>
                <p>
                  {shots > 0
                    ? `Largest count wins. Largest-count ties: ${ties.join(", ") || "none"}. Equal counts choose the lowest basis integer.`
                    : "All pixels are trusted. No empirical histogram or sampled decision is fabricated."}
                </p>
                {prefix && (
                  <Pattern
                    values={prefix.output}
                    cols={result.model.cols}
                    aria={`Measured modal reconstruction, basis ${prefix.state_integer}`}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="math-lab-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ArgandPlot({
  amplitudes,
  selected,
  onSelect,
}: {
  amplitudes: QuantumEvent["amplitudes"];
  selected: number;
  onSelect: (state: number) => void;
}) {
  const markerId = useId();
  const amplitude = amplitudes[selected];
  const cx = 170,
    cy = 160,
    radius = 115;
  const x = cx + amplitude.real * radius,
    y = cy - amplitude.imag * radius;
  return (
    <svg
      className="math-lab-argand"
      viewBox="0 0 340 320"
      role="group"
      aria-label={`Complex amplitude plane. Basis ${selected}: real ${num(amplitude.real, 6)}, imaginary ${num(amplitude.imag, 6)}.`}
    >
      <defs>
        <marker
          id={`${markerId}-vector-arrow`}
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6" fill="#d1b7ff" />
        </marker>
      </defs>
      <circle cx={cx} cy={cy} r={radius} className="unit-circle" />
      <circle cx={cx} cy={cy} r={radius / 2} className="half-circle" />
      <line x1="26" x2="314" y1={cy} y2={cy} className="axis" />
      <line x1={cx} x2={cx} y1="18" y2="302" className="axis" />
      <text x="312" y="181" textAnchor="end">
        Real
      </text>
      <text x="180" y="26">
        Imaginary
      </text>
      <text x="292" y="150">
        +1
      </text>
      <text x="36" y="150">
        −1
      </text>
      <text x="178" y="48">
        +1
      </text>
      <text x="178" y="283">
        −1
      </text>
      <text x="152" y="178">
        0
      </text>
      {amplitudes.map(
        (point, index) =>
          index !== selected && (
            <circle
              key={index}
              cx={cx + point.real * radius}
              cy={cy - point.imag * radius}
              r="3"
              className="amplitude-point"
              onClick={() => onSelect(index)}
            >
              <title>{`Basis ${index} · real ${num(point.real, 5)} · imaginary ${num(point.imag, 5)}`}</title>
            </circle>
          ),
      )}
      <line
        x1={cx}
        y1={cy}
        x2={x}
        y2={y}
        className="selected-vector"
        markerEnd={`url(#${markerId}-vector-arrow)`}
      />
      <line x1={x} x2={x} y1={y} y2={cy} className="component-guide" />
      <line x1={x} x2={cx} y1={y} y2={y} className="component-guide" />
      <circle cx={x} cy={y} r="7" className="selected-amplitude" />
      <text
        x={x + (x > 275 ? -12 : 12)}
        y={y - 13}
        textAnchor={x > 275 ? "end" : "start"}
        className="selected-label"
      >
        α{selected}
      </text>
    </svg>
  );
}

function BasisDistribution({
  result,
  probabilities,
  counts,
  shots = 0,
  selected,
  onSelect,
}: {
  result: Result;
  probabilities: number[];
  counts?: Record<string, number>;
  shots?: number;
  selected: number;
  onSelect: (state: number) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scroll.current;
    const bar = container?.querySelector<SVGGElement>(
      `[data-basis="${selected}"]`,
    );
    if (!container || !bar) return;
    const region = container.getBoundingClientRect();
    const bounds = bar.getBoundingClientRect();
    if (bounds.left < region.left || bounds.right > region.right) {
      container.scrollLeft +=
        bounds.left - region.left - region.width / 2 + bounds.width / 2;
    }
  }, [selected]);
  const width = Math.max(420, probabilities.length * 13 + 44);
  const height = 168,
    baseline = 128,
    plotHeight = 105,
    cell = (width - 44) / probabilities.length;
  const peak = Math.max(
    ...probabilities,
    ...(counts && shots > 0
      ? Object.values(counts).map((count) => count / shots)
      : []),
    0.001,
  );
  return (
    <div className="math-lab-distribution-scroll" ref={scroll}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label="Basis probabilities. Select a bar to inspect its state. Vertical scale adapts to the largest shown probability."
      >
        <line
          x1="24"
          x2={width - 10}
          y1={baseline}
          y2={baseline}
          className="chart-axis"
        />
        <text x="5" y="18" className="chart-scale">
          {num(peak, 3)}
        </text>
        {probabilities.map((probability, index) => {
          const x = 28 + index * cell;
          const barWidth = Math.max(2, cell * (counts ? 0.4 : 0.68));
          return (
            <g
              key={index}
              data-basis={index}
              className={`math-lab-basis-bar ${index === selected ? "selected" : ""}`}
              role="button"
              tabIndex={index === selected ? 0 : -1}
              aria-label={`Basis ${index}, ideal probability ${num(probability, 6)}${counts ? `, measured count ${counts[String(index)] || 0}` : ""}, energy ${num(result.model.energies[index])}`}
              aria-pressed={index === selected}
              onClick={() => onSelect(index)}
              onKeyDown={(key) => {
                if (key.key === "Enter" || key.key === " ") {
                  key.preventDefault();
                  onSelect(index);
                }
                if (key.key === "ArrowLeft" || key.key === "ArrowRight") {
                  key.preventDefault();
                  const next = Math.max(
                    0,
                    Math.min(
                      probabilities.length - 1,
                      index + (key.key === "ArrowLeft" ? -1 : 1),
                    ),
                  );
                  onSelect(next);
                  scroll.current
                    ?.querySelector<SVGGElement>(`[data-basis="${next}"]`)
                    ?.focus();
                }
              }}
            >
              <rect
                x={x - 2}
                y="12"
                width={cell}
                height="135"
                fill="transparent"
              />
              <rect
                x={x}
                y={baseline - (probability / peak) * plotHeight}
                width={barWidth}
                height={(probability / peak) * plotHeight}
                className="ideal-bar"
              />
              {counts && (
                <rect
                  x={x + barWidth + 1}
                  y={
                    baseline -
                    (shots > 0
                      ? ((counts[String(index)] || 0) / shots / peak) *
                        plotHeight
                      : 0)
                  }
                  width={barWidth}
                  height={
                    shots > 0
                      ? ((counts[String(index)] || 0) / shots / peak) *
                        plotHeight
                      : 0
                  }
                  className="measured-bar"
                />
              )}
              {(index === selected ||
                probabilities.length <= 16 ||
                index % Math.ceil(probabilities.length / 16) === 0) && (
                <text x={x + cell / 3} y="149" textAnchor="middle">
                  {index}
                </text>
              )}
              <title>{`Basis ${index}: ideal P = ${num(probability, 6)}, E = ${num(result.model.energies[index])}`}</title>
            </g>
          );
        })}
        <text x={width - 10} y="165" textAnchor="end" className="chart-scale">
          basis integer j →
        </text>
      </svg>
    </div>
  );
}

export default MathLab;
