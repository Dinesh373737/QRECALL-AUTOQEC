import type { ReactNode } from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import type { Amp, Candidate, DecisionSummary, DecoderId } from "../lib/types";
import { fix, pct } from "../lib/format";
import { OutcomeBadge, Status } from "./ui";

export type Pauli = "I" | "X" | "Y" | "Z";

/** Three data qubits with the two Z-parity checks drawn between them. */
export function StabilizerDiagram({ errors, randomFlips = "000", ideal, observed, readout = "00", correction, onQubitClick, showChecks = true, compact }: {
  errors?: Pauli[]; randomFlips?: string; ideal?: string; observed?: string; readout?: string; correction?: string | null;
  onQubitClick?: (q: number) => void; showChecks?: boolean; compact?: boolean;
}) {
  const xs = [90, 260, 430];
  const checks = [{ x: 175, name: "S1", pauli: "Z0 Z1" }, { x: 345, name: "S2", pauli: "Z1 Z2" }];
  const qy = compact ? 104 : 120;
  const cy = 40;
  const h = compact ? 160 : 196;
  return (
    <svg viewBox={`0 0 520 ${h}`} className="chart" role="img" aria-label="Three data qubits and two parity checks">
      <defs>
        <radialGradient id="qglow" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#5ad8ef" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#5ad8ef" stopOpacity="0.02" />
        </radialGradient>
        <radialGradient id="eglow" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#f47c80" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#f47c80" stopOpacity="0.04" />
        </radialGradient>
      </defs>
      <line x1={xs[0]} x2={xs[2]} y1={qy} y2={qy} stroke="#1f2c48" strokeWidth={2} />
      {showChecks && checks.map((c, j) => {
        const idealBit = ideal?.[j];
        const obsBit = observed?.[j];
        const flipped = readout[j] === "1";
        const lit = obsBit === "1";
        return (
          <g key={c.name}>
            <line x1={c.x} y1={cy + 18} x2={xs[j]} y2={qy - 30} stroke={lit ? "#a58bff" : "#26365a"} strokeWidth={1.6} strokeDasharray={lit ? undefined : "3 4"} />
            <line x1={c.x} y1={cy + 18} x2={xs[j + 1]} y2={qy - 30} stroke={lit ? "#a58bff" : "#26365a"} strokeWidth={1.6} strokeDasharray={lit ? undefined : "3 4"} />
            <rect x={c.x - 17} y={cy - 17} width={34} height={34} rx={6} transform={`rotate(45 ${c.x} ${cy})`}
              fill={lit ? "rgba(165,139,255,0.28)" : "rgba(255,255,255,0.03)"} stroke={lit ? "#a58bff" : "#33476f"} strokeWidth={1.6}>
              {lit && <animate attributeName="opacity" values="1;0.65;1" dur="1.6s" repeatCount="indefinite" />}
            </rect>
            <text x={c.x} y={cy + 4} textAnchor="middle" style={{ fill: lit ? "#e9e2ff" : "var(--text-2)", fontSize: 12.5, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
              {obsBit === undefined ? c.name : obsBit === "1" ? "−1" : "+1"}
            </text>
            <text x={c.x + (j === 0 ? -34 : 34)} y={cy - 8} textAnchor={j === 0 ? "end" : "start"} style={{ fontSize: 11, fill: "var(--muted)" }}>
              {c.name} = {c.pauli}
            </text>
            {idealBit !== undefined && (
              <text x={c.x + (j === 0 ? -34 : 34)} y={cy + 8} textAnchor={j === 0 ? "end" : "start"} style={{ fontSize: 10.5, fill: flipped ? "var(--amber)" : "var(--faint)", fontFamily: "var(--font-mono)" }}>
                {flipped ? `readout flip: ideal ${idealBit} → read ${obsBit}` : `syndrome bit ${obsBit}`}
              </text>
            )}
          </g>
        );
      })}
      {xs.map((x, q) => {
        const e = errors?.[q] ?? "I";
        const random = randomFlips[q] === "1";
        const hasX = e === "X" || e === "Y" || random;
        const corr = correction?.[q] === "1";
        return (
          <g key={q} style={{ cursor: onQubitClick ? "pointer" : undefined }} onClick={() => onQubitClick?.(q)}
            role={onQubitClick ? "button" : undefined} tabIndex={onQubitClick ? 0 : undefined}
            aria-label={onQubitClick ? `Qubit d${q}: ${e === "I" ? "no injected error" : `${e} error`}. Activate to change.` : undefined}
            onKeyDown={(ev) => { if (onQubitClick && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); onQubitClick(q); } }}>
            <circle cx={x} cy={qy} r={40} fill={hasX || e === "Z" ? "url(#eglow)" : "url(#qglow)"} />
            <circle cx={x} cy={qy} r={27} fill="#0c1424" stroke={hasX ? "#f47c80" : e === "Z" ? "#f3b867" : "#5ad8ef"} strokeWidth={2.2}
              strokeDasharray={random && e === "I" ? "4 3" : undefined} />
            <text x={x} y={qy + 5} textAnchor="middle" style={{ fill: "var(--text)", fontSize: 15, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
              {e !== "I" ? e : random ? "X" : `d${q}`}
            </text>
            <text x={x} y={qy + 46} textAnchor="middle" style={{ fontSize: 11, fill: "var(--muted)" }}>
              d{q}{e !== "I" ? ` · injected ${e}` : random ? " · random X" : ""}
            </text>
            {corr && (
              <g>
                <rect x={x + 16} y={qy - 40} width={36} height={20} rx={6} fill="rgba(99,214,151,0.18)" stroke="#63d697" />
                <text x={x + 34} y={qy - 26} textAnchor="middle" style={{ fill: "#63d697", fontSize: 11, fontWeight: 700 }}>+X</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export const STAGES = ["Encode", "Inject error", "Measure syndrome", "Decode", "Correct", "Verify"];

export function Timeline({ index, onSelect, stages = STAGES }: { index: number; onSelect: (i: number) => void; stages?: string[] }) {
  return (
    <div className="stepper" role="tablist" aria-label="Experiment stages">
      {stages.map((s, i) => (
        <button key={s} role="tab" aria-selected={i === index} className={`step ${i < index ? "done" : ""} ${i === index ? "current" : ""}`} onClick={() => onSelect(i)}>
          <div className="n">0{i + 1}</div>
          <div className="t">{s}</div>
          <div className="bar" />
        </button>
      ))}
    </div>
  );
}

export function PlayerControls({ player, count, label }: { player: { index: number; playing: boolean; toggle: () => void; next: () => void; prev: () => void; reset: () => void; end: () => void }; count: number; label?: ReactNode }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <button className="btn icon" onClick={player.reset} aria-label="Reset to start" title="Reset"><RotateCcw /></button>
      <button className="btn icon" onClick={player.prev} aria-label="Previous step" title="Step back (←)"><StepBack /></button>
      <button className="btn primary" onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"} title="Play / pause (Space)">
        {player.playing ? <Pause /> : <Play />}{player.playing ? "Pause" : "Play"}
      </button>
      <button className="btn icon" onClick={player.next} aria-label="Next step" title="Step forward (→)"><StepForward /></button>
      <button className="btn icon" onClick={player.end} aria-label="Jump to end" title="End"><SkipForward /></button>
      <span className="num muted" style={{ fontSize: 12, marginLeft: 6 }}>{label ?? `${player.index + 1} / ${count}`}</span>
      <span className="sr-only"><SkipBack /></span>
    </div>
  );
}

function phaseColor(re: number, im: number) {
  const hue = ((Math.atan2(im, re) * 180) / Math.PI + 360) % 360;
  return `hsl(${(190 + hue) % 360} 80% 62%)`;
}

/** Probability bars with phase hue for the data register (or any register width). */
export function StateBars({ amps, width = 3, label }: { amps: Amp[]; width?: number; label?: ReactNode }) {
  const all = Array.from({ length: 2 ** width }, (_, k) => {
    const basis = Array.from({ length: width }, (_, q) => String((k >> (width - 1 - q)) & 1)).join("");
    return amps.find((a) => a.basis === basis) ?? { basis, re: 0, im: 0, prob: 0 };
  });
  return (
    <div>
      {label && <div className="field-help" style={{ marginBottom: 6 }}>{label}</div>}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${all.length}, minmax(0,1fr))`, gap: 6, alignItems: "end", height: 120 }}>
        {all.map((a) => (
          <div key={a.basis} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}
            title={`|${a.basis}⟩  amplitude ${a.re.toFixed(3)} ${a.im >= 0 ? "+" : "−"} ${Math.abs(a.im).toFixed(3)}i  probability ${a.prob.toFixed(3)}`}>
            <span className="num" style={{ fontSize: 10, color: a.prob > 1e-9 ? "var(--text-2)" : "var(--faint)" }}>{a.prob > 1e-9 ? a.prob.toFixed(2) : ""}</span>
            <div style={{ width: "100%", maxWidth: 34, height: `${Math.max(2, a.prob * 92)}px`, borderRadius: 5, background: a.prob > 1e-9 ? phaseColor(a.re, a.im) : "#16213a", transition: "height 0.5s var(--ease)", boxShadow: a.prob > 1e-9 ? "0 0 18px -6px currentColor" : undefined }} />
            <span className="num" style={{ fontSize: 10.5, color: a.prob > 1e-9 ? "var(--text)" : "var(--faint)" }}>|{a.basis}⟩</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ketString(amps: Amp[]): string {
  const terms = amps.filter((a) => a.prob > 1e-9).map((a) => {
    const mag = Math.sqrt(a.prob);
    const re = a.re, im = a.im;
    let coef: string;
    if (Math.abs(im) < 1e-9) coef = (re < 0 ? "−" : "") + mag.toFixed(3);
    else if (Math.abs(re) < 1e-9) coef = `${im < 0 ? "−" : ""}${mag.toFixed(3)}i`;
    else coef = `(${re.toFixed(2)}${im < 0 ? "−" : "+"}${Math.abs(im).toFixed(2)}i)`;
    return `${coef}|${a.basis}⟩`;
  });
  return terms.join(" + ").replace(/\+ −/g, "− ") || "0";
}

/** Candidate energies as stacked data + readout bars, minimum energy first. */
export function EnergyRanking({ candidates, selected, onSelect, actual, limit }: {
  candidates: Candidate[]; selected?: string | null; onSelect?: (c: string) => void; actual?: string; limit?: number;
}) {
  const rows = limit ? candidates.slice(0, limit) : candidates;
  const finite = rows.filter((c) => c.energy !== null);
  const max = Math.max(1e-9, ...finite.map((c) => c.energy as number));
  const best = candidates[0];
  return (
    <div className="col" style={{ gap: 6 }}>
      {rows.map((c, i) => {
        const imp = c.energy === null;
        const dw = imp ? 0 : ((c.data_energy ?? 0) / max) * 100;
        const rw = imp ? 0 : ((c.readout_energy ?? 0) / max) * 100;
        const sel = selected === c.candidate;
        return (
          <button key={c.candidate} type="button" onClick={() => onSelect?.(c.candidate)}
            style={{ display: "grid", gridTemplateColumns: "28px 62px minmax(0,1fr) 92px", gap: 10, alignItems: "center", padding: "6px 8px", borderRadius: 9,
              border: `1px solid ${sel ? "rgba(90,216,239,0.55)" : i === 0 ? "rgba(99,214,151,0.35)" : "var(--line)"}`,
              background: sel ? "var(--cyan-dim)" : i === 0 ? "rgba(99,214,151,0.05)" : "rgba(4,8,15,0.35)", textAlign: "left", opacity: imp ? 0.55 : 1 }}
            aria-label={`Candidate ${c.candidate}, rank ${c.rank}, energy ${imp ? "infinite" : fix(c.energy)}`}>
            <span className="num" style={{ fontSize: 11, color: i === 0 ? "var(--green)" : "var(--muted)" }}>#{c.rank}</span>
            <span className="bits" style={{ fontSize: 13, color: "var(--text)" }}>
              {c.candidate}{actual === c.candidate && <span title="actual simulated error" style={{ color: "var(--amber)", marginLeft: 4 }}>★</span>}
            </span>
            <span style={{ display: "flex", height: 14, borderRadius: 4, overflow: "hidden", background: "#121b2f" }}>
              <span style={{ width: `${dw}%`, background: "linear-gradient(90deg,#2fb8d4,#5ad8ef)", transition: "width .5s var(--ease)" }} title={`data energy ${fix(c.data_energy)}`} />
              <span style={{ width: `${rw}%`, background: "linear-gradient(90deg,#8f72f5,#a58bff)", transition: "width .5s var(--ease)" }} title={`readout energy ${fix(c.readout_energy)}`} />
            </span>
            <span className="num" style={{ fontSize: 12, textAlign: "right", color: "var(--text)" }}>
              {imp ? "∞ impossible" : fix(c.energy, 3)}
              {!imp && i > 0 && best.energy !== null && <span className="muted" style={{ display: "block", fontSize: 10.5 }}>+{fix((c.energy as number) - (best.energy as number), 2)}</span>}
            </span>
          </button>
        );
      })}
      <div className="legend">
        <span><i style={{ background: "#5ad8ef" }} />data-error energy</span>
        <span><i style={{ background: "#a58bff" }} />readout-error energy</span>
        {actual && <span><b style={{ color: "var(--amber)" }}>★</b> actual simulated error (ground truth, hidden from decoder)</span>}
      </div>
    </div>
  );
}

export function DecoderTable({ decisions, active, onPick }: { decisions: Record<DecoderId, DecisionSummary>; active: DecoderId; onPick?: (d: DecoderId) => void }) {
  const order: DecoderId[] = ["none", "lookup", "energy", "exact"];
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr><th>Decoder</th><th>Correction</th><th>Residual</th><th>Outcome</th><th className="num">P(keep | model)</th></tr>
        </thead>
        <tbody>
          {order.map((d) => {
            const x = decisions[d];
            return (
              <tr key={d} className={`${d === active ? "selected" : ""} ${onPick ? "clickable" : ""}`} onClick={() => onPick?.(d)}>
                <td style={{ color: "var(--text)", fontWeight: 560 }}>{x.label}</td>
                <td className="bits">{x.correction}</td>
                <td className="bits">{x.residual}</td>
                <td><OutcomeBadge outcome={x.outcome} /></td>
                <td className="num">{pct(x.logical_classes.p_logical_preserved, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LogicalOutcome({ v }: { v: { actual_error: string; correction: string; residual: string; outcome: string; logical_operator: string; logical_preserved: boolean; codeword_restored: boolean; z_parity: number; circuit_check: Record<string, any> } }) {
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 18 }}>
        <div className="col" style={{ gap: 4 }}><span className="field-help">actual X error</span><span className="bits" style={{ fontSize: 16 }}>{v.actual_error}</span></div>
        <span className="muted" style={{ fontSize: 18 }}>⊕</span>
        <div className="col" style={{ gap: 4 }}><span className="field-help">correction</span><span className="bits" style={{ fontSize: 16, color: "var(--green)" }}>{v.correction}</span></div>
        <span className="muted" style={{ fontSize: 18 }}>=</span>
        <div className="col" style={{ gap: 4 }}><span className="field-help">residual</span><span className="bits" style={{ fontSize: 16, color: v.residual === "000" ? "var(--green)" : "var(--amber)" }}>{v.residual}</span></div>
      </div>
      <div className="row wrap">
        <OutcomeBadge outcome={v.outcome} />
        <Status ok={v.logical_preserved} pass="Logical info preserved" fail="Logical info lost" />
        <span className="chip">logical operator applied: <b className="num">{v.logical_operator}</b></span>
        {v.z_parity === 1 && <span className="badge warn">Z error undetectable by this code</span>}
      </div>
      {"logical_fidelity" in v.circuit_check && (
        <div className="callout info">
          <div>
            <b>Circuit check:</b> after the coherent majority decoder and U†, the verification qubit reads 0 with probability{" "}
            <b className="num">{pct(v.circuit_check.logical_fidelity, 2)}</b> (Qiskit statevector). {v.circuit_check.state_dependent_note}
          </div>
        </div>
      )}
      {"corrected_readout" in v.circuit_check && (
        <div className="callout info">
          <div>
            <b>Pauli-frame readout:</b> raw <span className="bits">{v.circuit_check.raw_readout}</span> ⊕ frame <span className="bits">{v.circuit_check.frame}</span> = <span className="bits">{v.circuit_check.corrected_readout}</span> → logical bit <b>{v.circuit_check.decoded_logical_bit}</b>. {v.circuit_check.note}
          </div>
        </div>
      )}
    </div>
  );
}
