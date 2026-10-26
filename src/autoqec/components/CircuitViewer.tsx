import { useMemo } from "react";
import type { Operation } from "../lib/types";

const STAGE_COLORS: Record<string, string> = {
  prepare: "rgba(122,167,255,0.07)",
  encode: "rgba(90,216,239,0.07)",
  inject: "rgba(244,124,128,0.08)",
  extract: "rgba(165,139,255,0.08)",
  measure: "rgba(165,139,255,0.11)",
  correct: "rgba(99,214,151,0.08)",
  verify: "rgba(243,184,103,0.07)",
  transpiled: "rgba(255,255,255,0.0)",
};

function gateColor(op: Operation): { fill: string; stroke: string; text: string } {
  if (op.kind === "error") return { fill: "rgba(244,124,128,0.22)", stroke: "#f47c80", text: "#ffd6d7" };
  if (op.kind === "readout_error") return { fill: "rgba(243,184,103,0.2)", stroke: "#f3b867", text: "#ffe7c4" };
  if (op.name === "measure") return { fill: "rgba(165,139,255,0.18)", stroke: "#a58bff", text: "#e6defe" };
  if (op.name === "if_else") return { fill: "rgba(99,214,151,0.12)", stroke: "#63d697", text: "#d8f7e6" };
  if (op.name === "reset") return { fill: "rgba(122,167,255,0.18)", stroke: "#7aa7ff", text: "#dbe7ff" };
  if (op.name === "id") return { fill: "rgba(255,255,255,0.04)", stroke: "#3a4a6c", text: "#8191ab" };
  return { fill: "rgba(90,216,239,0.14)", stroke: "#5ad8ef", text: "#dff8fd" };
}

function label(op: Operation): string {
  if (op.display) return op.display;
  const n = op.name;
  if (n === "u") return "U";
  if (n === "rz") {
    const p = Number(op.params[0]);
    const frac = p / Math.PI;
    const nice = [0.25, 0.5, 0.75, 1, -0.25, -0.5, -0.75, -1].find((f) => Math.abs(frac - f) < 1e-6);
    return nice !== undefined ? `Rz(${nice === 1 ? "" : nice === -1 ? "−" : nice.toString().replace("0.", ".")}π)` : `Rz(${p.toFixed(2)})`;
  }
  if (n === "sx") return "√X";
  if (n === "reset") return "|0⟩";
  if (n === "id") return "idle";
  return n.toUpperCase();
}

export function CircuitViewer({ ops, qubits, clregs, current, selected, onSelect, colW = 56, physical, highlightQubits }: {
  ops: Operation[]; qubits: string[]; clregs: { name: string; size: number }[]; current?: number | null; selected?: number | null;
  onSelect?: (index: number) => void; colW?: number; physical?: boolean; highlightQubits?: string[];
}) {
  const visible = ops.filter((o) => o.name !== "barrier");
  // Drawing columns: an op occupies every wire between its extreme rows (including the classical register
  // it writes or reads), so vertically overlapping ops never share a column. Program order is preserved.
  const columns = useMemo(() => {
    const wireIndex = (w: string) => {
      const q = qubits.indexOf(w);
      if (q >= 0) return q;
      const reg = w.split("[")[0];
      const c = clregs.findIndex((r) => r.name === reg);
      return c >= 0 ? qubits.length + c : -1;
    };
    const next = new Map<number, number>();
    const out = new Map<number, number>();
    for (const op of visible) {
      const wires = [...op.qubits, ...(op.name === "measure" ? op.clbits : []), ...(op.name === "if_else" ? [op.condition?.register ?? "syn"] : [])]
        .map(wireIndex).filter((i) => i >= 0);
      if (!wires.length) continue;
      const lo = Math.min(...wires), hi = Math.max(...wires);
      let col = 0;
      for (let w = lo; w <= hi; w++) col = Math.max(col, next.get(w) ?? 0);
      for (let w = lo; w <= hi; w++) next.set(w, col + 1);
      out.set(op.index, col);
    }
    return out;
  }, [visible, qubits, clregs]);
  const nCols = Math.max(1, ...[...columns.values()].map((c) => c + 1));
  const rowH = 46;
  const top = 34;
  const left = physical ? 54 : 64;
  const nq = qubits.length;
  const width = left + nCols * colW + 40;
  const clTop = top + nq * rowH + 10;
  const height = clTop + clregs.length * 32 + 16;
  const qy = (q: string) => top + qubits.indexOf(q) * rowH + rowH / 2;
  const cy = (reg: string) => clTop + Math.max(0, clregs.findIndex((r) => r.name === reg)) * 32 + 16;
  const cx = (op: Operation) => left + (columns.get(op.index) ?? 0) * colW + colW / 2;
  // stage bands from layer ranges
  const bands: { stage: string; x0: number; x1: number }[] = [];
  for (const op of visible) {
    const stage = op.stage ?? "transpiled";
    const x = cx(op);
    const last = bands[bands.length - 1];
    if (last && last.stage === stage) last.x1 = Math.max(last.x1, x + colW / 2);
    else bands.push({ stage, x0: x - colW / 2, x1: x + colW / 2 });
  }
  const curOp = current === null || current === undefined ? null : ops.find((o) => o.index === current);
  return (
    <div style={{ overflowX: "auto", paddingBottom: 6 }}>
      <svg width={width} height={height} className="chart" role="img" aria-label="Quantum circuit diagram">
        {!physical && bands.map((b, i) => (
          <g key={i}>
            <rect x={b.x0 + 2} y={4} width={Math.max(4, b.x1 - b.x0 - 4)} height={height - 8} rx={8} fill={STAGE_COLORS[b.stage] ?? "transparent"} />
            <text x={b.x0 + 8} y={20} style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fill: "var(--muted)", fontWeight: 650 }}>{b.stage}</text>
          </g>
        ))}
        {qubits.map((q) => (
          <g key={q}>
            <text x={left - 12} y={qy(q) + 4} textAnchor="end" style={{ fontFamily: "var(--font-mono)", fontSize: 12, fill: highlightQubits?.includes(q) ? "var(--cyan)" : "var(--text-2)" }}>{q}</text>
            <line x1={left - 4} x2={width - 16} y1={qy(q)} y2={qy(q)} stroke="#2b3b60" strokeWidth={1.3} />
          </g>
        ))}
        {clregs.map((r) => (
          <g key={r.name}>
            <text x={left - 12} y={cy(r.name) + 4} textAnchor="end" style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fill: "var(--muted)" }}>{r.name}</text>
            <line x1={left - 4} x2={width - 16} y1={cy(r.name) - 2} y2={cy(r.name) - 2} stroke="#3a4a6c" />
            <line x1={left - 4} x2={width - 16} y1={cy(r.name) + 2} y2={cy(r.name) + 2} stroke="#3a4a6c" />
          </g>
        ))}
        {curOp && <line x1={cx(curOp)} x2={cx(curOp)} y1={top - 6} y2={height - 6} stroke="var(--cyan)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />}
        {visible.map((op) => {
          const x = cx(op);
          const dim = current !== null && current !== undefined && op.index > current;
          const sel = selected === op.index;
          const col = gateColor(op);
          const opacity = dim ? 0.28 : 1;
          const click = () => onSelect?.(op.index);
          const common = { style: { cursor: onSelect ? "pointer" : undefined, opacity, transition: "opacity .3s" }, onClick: click };
          if (op.name === "cx" || op.name === "ccx" || op.name === "cz") {
            const ctrls = op.qubits.slice(0, -1);
            const tgt = op.qubits[op.qubits.length - 1];
            const ys = op.qubits.map(qy);
            return (
              <g key={op.index} {...common}>
                <line x1={x} x2={x} y1={Math.min(...ys)} y2={Math.max(...ys)} stroke={sel ? "#fff" : col.stroke} strokeWidth={1.8} />
                {ctrls.map((c) => <circle key={c} cx={x} cy={qy(c)} r={5} fill={sel ? "#fff" : col.stroke} />)}
                {op.name === "cz" ? <circle cx={x} cy={qy(tgt)} r={5} fill={col.stroke} /> : (
                  <g>
                    <circle cx={x} cy={qy(tgt)} r={11} fill="#0c1424" stroke={sel ? "#fff" : col.stroke} strokeWidth={1.8} />
                    <line x1={x - 11} x2={x + 11} y1={qy(tgt)} y2={qy(tgt)} stroke={col.stroke} strokeWidth={1.6} />
                    <line x1={x} x2={x} y1={qy(tgt) - 11} y2={qy(tgt) + 11} stroke={col.stroke} strokeWidth={1.6} />
                  </g>
                )}
                <rect x={x - colW / 2} y={Math.min(...ys) - 18} width={colW} height={Math.max(...ys) - Math.min(...ys) + 36} fill="transparent" />
              </g>
            );
          }
          if (op.name === "measure") {
            const q = op.qubits[0];
            const reg = op.clbits[0]?.split("[")[0] ?? "";
            const bit = op.clbits[0]?.match(/\[(\d+)\]/)?.[1];
            return (
              <g key={op.index} {...common}>
                <line x1={x - 1.5} x2={x - 1.5} y1={qy(q) + 14} y2={cy(reg) - 4} stroke={col.stroke} strokeWidth={1} />
                <line x1={x + 1.5} x2={x + 1.5} y1={qy(q) + 14} y2={cy(reg) - 4} stroke={col.stroke} strokeWidth={1} />
                <path d={`M${x - 5},${cy(reg) - 10} L${x},${cy(reg) - 3} L${x + 5},${cy(reg) - 10}`} fill={col.stroke} />
                <rect x={x - 16} y={qy(q) - 14} width={32} height={28} rx={6} fill={col.fill} stroke={sel ? "#fff" : col.stroke} strokeWidth={1.5} />
                <path d={`M${x - 9},${qy(q) + 6} A10,10 0 0 1 ${x + 9},${qy(q) + 6}`} fill="none" stroke={col.text} strokeWidth={1.4} />
                <line x1={x} x2={x + 7} y1={qy(q) + 6} y2={qy(q) - 6} stroke={col.text} strokeWidth={1.4} />
                {bit && <text x={x + 9} y={cy(reg) + 14} style={{ fontSize: 9.5, fill: "var(--muted)", fontFamily: "var(--font-mono)" }}>{bit}</text>}
              </g>
            );
          }
          if (op.name === "if_else") {
            const qs = (op.body ?? []).flatMap((b) => b.qubits);
            const ys = qs.length ? qs.map(qy) : [top + rowH / 2];
            const reg = op.condition?.register ?? "syn";
            const y0 = Math.min(...ys) - 18;
            const y1 = Math.max(...ys) + 18;
            return (
              <g key={op.index} {...common}>
                <line x1={x - 1.5} x2={x - 1.5} y1={y1} y2={cy(reg) - 3} stroke={col.stroke} strokeWidth={1} strokeDasharray="3 2" />
                <line x1={x + 1.5} x2={x + 1.5} y1={y1} y2={cy(reg) - 3} stroke={col.stroke} strokeWidth={1} strokeDasharray="3 2" />
                <circle cx={x} cy={cy(reg)} r={4.5} fill={col.stroke} />
                <rect x={x - colW / 2 + 5} y={y0} width={colW - 10} height={y1 - y0} rx={8} fill="rgba(99,214,151,0.05)" stroke={sel ? "#fff" : col.stroke} strokeDasharray="4 3" />
                {(op.body ?? []).map((b, i) => (
                  <g key={i}>
                    <rect x={x - 13} y={qy(b.qubits[0]) - 13} width={26} height={26} rx={6} fill={col.fill} stroke={col.stroke} />
                    <text x={x} y={qy(b.qubits[0]) + 4.5} textAnchor="middle" style={{ fill: col.text, fontSize: 12, fontWeight: 700 }}>{b.name.toUpperCase()}</text>
                  </g>
                ))}
                <text x={x} y={y0 - 4} textAnchor="middle" style={{ fontSize: 9.5, fill: "var(--green)", fontFamily: "var(--font-mono)" }}>
                  {`=${op.syndrome ?? op.condition?.value}`}
                </text>
              </g>
            );
          }
          const q = op.qubits[0];
          const text = label(op);
          const w = Math.max(30, Math.min(colW - 6, text.length * 7.5 + 12));
          return (
            <g key={op.index} {...common}>
              <rect x={x - w / 2} y={qy(q) - 14} width={w} height={28} rx={6} fill={col.fill} stroke={sel ? "#fff" : col.stroke} strokeWidth={1.5} />
              <text x={x} y={qy(q) + 4.5} textAnchor="middle" style={{ fill: col.text, fontSize: text.length > 4 ? 10 : 12.5, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{text}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function opSummary(op: Operation): string {
  if (op.name === "if_else") return `Feed-forward block: if the syndrome register reads ${op.syndrome ?? op.condition?.value}, apply ${(op.body ?? []).map((b) => `${b.name.toUpperCase()} on ${b.qubits.join(", ")}`).join("; ")}.`;
  return `${label(op)} on ${op.qubits.join(", ")}${op.clbits.length ? ` → ${op.clbits.join(", ")}` : ""}`;
}
