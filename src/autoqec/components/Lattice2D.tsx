import type { Geometry, Mechanism, ShotDecoder } from "../lib/types";

export interface Overlay {
  pymatching?: ShotDecoder["edges"];
  ising?: Mechanism[];
  complement?: Mechanism[];
}

export const BASIS_COLOR: Record<string, string> = { X: "#f3b867", Z: "#a58bff" };

/** Accessible 2D fallback: one small map per time step. */
export function Lattice2D({ geo, fired, round, onRound, overlay, show }: {
  geo: Geometry; fired: number[]; round: number | null; onRound: (t: number | null) => void; overlay: Overlay; show: { pm: boolean; ising: boolean; comp: boolean };
}) {
  const firedSet = new Set(fired);
  // (row, column) coordinates: column horizontal, row vertical, matching Google's layout diagrams.
  const xs = geo.qubits.map((q) => q.y);
  const ys = geo.qubits.map((q) => q.x);
  const x0 = Math.min(...xs) - 0.8, x1 = Math.max(...xs) + 0.8, y0 = Math.min(...ys) - 0.8, y1 = Math.max(...ys) + 0.8;
  const size = 132;
  const sx = (row: number, col: number) => ((col - x0) / (x1 - x0)) * size;
  const sy = (row: number) => ((row - y0) / (y1 - y0)) * size;
  const matchedBy = new Map<number, string>();
  if (show.pm) (overlay.pymatching ?? []).forEach((e) => e.detectors.forEach((d) => matchedBy.set(d, "pm")));
  if (show.ising) (overlay.ising ?? []).forEach((m) => m.detectors.forEach((d) => matchedBy.set(d, matchedBy.get(d) === "pm" ? "both" : "ising")));
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${size + 16}px, 1fr))`, gap: 10 }}>
      {Array.from({ length: geo.time_steps }, (_, t) => {
        const dets = geo.detectors.filter((d) => d.t === t);
        const n = dets.filter((d) => firedSet.has(d.id)).length;
        return (
          <button key={t} onClick={() => onRound(round === t ? null : t)} aria-pressed={round === t}
            style={{ padding: 8, borderRadius: 10, border: `1px solid ${round === t ? "var(--cyan)" : "var(--line)"}`, background: "rgba(4,8,15,0.45)", textAlign: "left" }}
            aria-label={`Round ${t}: ${n} detection events`}>
            <div className="spread" style={{ marginBottom: 4 }}>
              <span className="num" style={{ fontSize: 11, color: "var(--text-2)" }}>round {t}</span>
              <span className="num" style={{ fontSize: 11, color: n ? "var(--violet)" : "var(--faint)" }}>{n} event{n === 1 ? "" : "s"}</span>
            </div>
            <svg width={size} height={size} className="chart">
              {geo.qubits.filter((q) => q.role === "data").map((q) => <circle key={q.id} cx={sx(q.x, q.y)} cy={sy(q.x)} r={2.4} fill="#5ad8ef" opacity={0.35} />)}
              {dets.map((d) => {
                const on = firedSet.has(d.id);
                const tag = matchedBy.get(d.id);
                return (
                  <g key={d.id}>
                    <rect x={sx(d.x, d.y) - (on ? 6 : 3.5)} y={sy(d.x) - (on ? 6 : 3.5)} width={on ? 12 : 7} height={on ? 12 : 7} rx={2}
                      transform={`rotate(45 ${sx(d.x, d.y)} ${sy(d.x)})`} fill={on ? BASIS_COLOR[d.basis] : "transparent"} stroke={BASIS_COLOR[d.basis]} strokeOpacity={on ? 1 : 0.3} />
                    {on && tag && <circle cx={sx(d.x, d.y)} cy={sy(d.x)} r={9} fill="none" stroke={tag === "pm" ? "#3fd0b0" : tag === "ising" ? "#c7b8ff" : "#fff"} strokeWidth={1.3} />}
                    <title>{`D${d.id} (${d.x}, ${d.y}) round ${t} ${d.basis}-type${on ? " — FIRED" : ""}`}</title>
                  </g>
                );
              })}
            </svg>
          </button>
        );
      })}
    </div>
  );
}
