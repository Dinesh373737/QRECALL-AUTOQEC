import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWidth } from "../lib/hooks";

type Fmt = (v: number) => string;
const defaultFmt: Fmt = (v) => {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 1) return String(+v.toFixed(2));
  if (a >= 0.01) return String(+v.toFixed(3));
  return v.toExponential(0);
};

function scale(d0: number, d1: number, r0: number, r1: number, log = false) {
  if (log) {
    const l0 = Math.log10(Math.max(d0, 1e-12));
    const l1 = Math.log10(Math.max(d1, 1e-12));
    return (v: number) => r0 + ((Math.log10(Math.max(v, 1e-12)) - l0) / (l1 - l0 || 1)) * (r1 - r0);
  }
  return (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
}

function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

function logTicks(lo: number, hi: number): number[] {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
    }
  }
  return out.length > 8 ? out.filter((v) => Math.abs(Math.log10(v) % 1) < 1e-9) : out;
}

function extent(values: number[], log: boolean, pad = 0.06): [number, number] {
  const vs = values.filter((v) => Number.isFinite(v) && (!log || v > 0));
  if (!vs.length) return log ? [1e-3, 1] : [0, 1];
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (log) return [lo / 1.4, hi * 1.4];
  if (lo === hi) {
    lo -= Math.abs(lo) * 0.1 || 1;
    hi += Math.abs(hi) * 0.1 || 1;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

interface Frame {
  width: number;
  height: number;
  m: { l: number; r: number; t: number; b: number };
}

function Axes({ f, x, y, xt, yt, xFmt, yFmt, xLabel, yLabel }: {
  f: Frame; x: (v: number) => number; y: (v: number) => number; xt: number[]; yt: number[]; xFmt: Fmt; yFmt: Fmt; xLabel?: string; yLabel?: string;
}) {
  const { width, height, m } = f;
  return (
    <g>
      <g className="grid">
        {yt.map((t) => <line key={`gy${t}`} x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} />)}
      </g>
      <g className="axis">
        <line x1={m.l} x2={width - m.r} y1={height - m.b} y2={height - m.b} />
        {xt.map((t) => (
          <g key={`x${t}`} transform={`translate(${x(t)},${height - m.b})`}>
            <line y2={4} />
            <text className="tick-label" y={16} textAnchor="middle">{xFmt(t)}</text>
          </g>
        ))}
        {yt.map((t) => (
          <text key={`y${t}`} className="tick-label" x={m.l - 8} y={y(t) + 3.5} textAnchor="end">{yFmt(t)}</text>
        ))}
      </g>
      {xLabel && <text x={(m.l + width - m.r) / 2} y={height - 4} textAnchor="middle">{xLabel}</text>}
      {yLabel && <text transform={`translate(12,${(m.t + height - m.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>}
    </g>
  );
}

export interface SeriesPoint {
  x: number;
  y: number;
  lo?: number;
  hi?: number;
}
export interface Series {
  id: string;
  label: string;
  color: string;
  points: SeriesPoint[];
  dashed?: boolean;
  width?: number;
}

export function LineChart({ series, height = 300, xLabel, yLabel, xLog, yLog, xFmt = defaultFmt, yFmt = defaultFmt, yDomain, legend = true, onPointClick }: {
  series: Series[]; height?: number; xLabel?: string; yLabel?: string; xLog?: boolean; yLog?: boolean; xFmt?: Fmt; yFmt?: Fmt;
  yDomain?: [number, number]; legend?: boolean; onPointClick?: (s: Series, p: SeriesPoint) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; px: number; py: number } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const f: Frame = { width, height, m: { l: 58, r: 18, t: 14, b: 42 } };
  const visible = series.filter((s) => !hidden.has(s.id));
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const ys = visible.flatMap((s) => s.points.flatMap((p) => [p.y, p.lo ?? p.y, p.hi ?? p.y]));
  const [x0, x1] = extent(xs, !!xLog, 0.02);
  const [y0, y1] = yDomain ?? extent(ys, !!yLog);
  const x = scale(x0, x1, f.m.l, width - f.m.r, xLog);
  const y = scale(y0, y1, height - f.m.b, f.m.t, yLog);
  const xt = xLog ? logTicks(x0, x1) : niceTicks(x0, x1, Math.max(3, Math.floor(width / 110)));
  const yt = yLog ? logTicks(y0, y1) : niceTicks(y0, y1, 5);
  const allX = [...new Set(xs)].sort((a, b) => a - b);
  const hoverX = hover ? allX.reduce((best, v) => (Math.abs(x(v) - hover.px) < Math.abs(x(best) - hover.px) ? v : best), allX[0]) : null;
  return (
    <div className="chart-box" ref={ref}>
      <svg className="chart" width={width} height={height}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setHover({ x: 0, px: e.clientX - r.left, py: e.clientY - r.top });
        }}
        onMouseLeave={() => setHover(null)}>
        <Axes f={f} x={x} y={y} xt={xt} yt={yt} xFmt={xFmt} yFmt={yFmt} xLabel={xLabel} yLabel={yLabel} />
        {visible.map((s) => {
          const pts = s.points.filter((p) => Number.isFinite(p.y) && (!yLog || p.y > 0));
          const band = pts.filter((p) => p.lo !== undefined && p.hi !== undefined && (!yLog || (p.lo as number) > 0));
          const area = band.length > 1
            ? `M${band.map((p) => `${x(p.x)},${y(p.hi as number)}`).join("L")}L${[...band].reverse().map((p) => `${x(p.x)},${y(p.lo as number)}`).join("L")}Z`
            : "";
          return (
            <g key={s.id}>
              {area && <path d={area} fill={s.color} opacity={0.12} />}
              <path d={`M${pts.map((p) => `${x(p.x)},${y(p.y)}`).join("L")}`} fill="none" stroke={s.color} strokeWidth={s.width ?? 2}
                strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" />
              {pts.map((p, i) => (
                <circle key={i} cx={x(p.x)} cy={y(p.y)} r={hoverX === p.x ? 4.5 : 3} fill="var(--bg)" stroke={s.color} strokeWidth={2}
                  style={{ cursor: onPointClick ? "pointer" : undefined }} onClick={() => onPointClick?.(s, p)} />
              ))}
            </g>
          );
        })}
        {hoverX !== null && <line x1={x(hoverX)} x2={x(hoverX)} y1={f.m.t} y2={height - f.m.b} stroke="rgba(200,220,255,0.25)" strokeDasharray="3 3" />}
      </svg>
      {hover && hoverX !== null && (
        <div className="chart-tooltip" style={{ left: Math.min(width - 220, hover.px + 14), top: Math.max(0, hover.py - 20) }}>
          <div style={{ marginBottom: 4 }}><b>{xLabel ?? "x"} = {xFmt(hoverX)}</b></div>
          {visible.map((s) => {
            const p = s.points.find((q) => q.x === hoverX);
            if (!p) return null;
            return (
              <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <i style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />
                <span>{s.label}</span>
                <b className="num" style={{ marginLeft: "auto" }}>{yFmt(p.y)}</b>
                {p.lo !== undefined && <span className="num muted">[{yFmt(p.lo)}, {yFmt(p.hi as number)}]</span>}
              </div>
            );
          })}
        </div>
      )}
      {legend && (
        <div className="legend" style={{ marginTop: 6 }}>
          {series.map((s) => (
            <button key={s.id} type="button" onClick={() => {
              const n = new Set(hidden);
              n.has(s.id) ? n.delete(s.id) : n.add(s.id);
              setHidden(n);
            }} style={{ display: "inline-flex", gap: 6, alignItems: "center", opacity: hidden.has(s.id) ? 0.4 : 1 }}
              aria-pressed={!hidden.has(s.id)} title="Toggle series">
              <i style={{ background: s.color, height: s.dashed ? 2 : 10, borderRadius: s.dashed ? 0 : 3 }} />{s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface Bar {
  label: string;
  value: number;
  lo?: number;
  hi?: number;
  color?: string;
  note?: string;
  id?: string;
}

/** Horizontal bars with optional confidence whiskers (a forest-style comparison). */
export function BarList({ bars, fmt = defaultFmt, max, onClick, selected, labelWidth = 210 }: {
  bars: Bar[]; fmt?: Fmt; max?: number; onClick?: (b: Bar) => void; selected?: string; labelWidth?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const rowH = 30;
  const height = bars.length * rowH + 22;
  const l = Math.min(labelWidth, width * 0.42);
  const r = 86;
  const top = Math.max(max ?? 0, ...bars.map((b) => b.hi ?? b.value)) * 1.05 || 1;
  const x = scale(0, top, l, width - r);
  const ticks = niceTicks(0, top, Math.max(3, Math.floor((width - l - r) / 90)));
  return (
    <div className="chart-box" ref={ref}>
      <svg className="chart" width={width} height={height}>
        <g className="grid">{ticks.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={4} y2={height - 18} />)}</g>
        {ticks.map((t) => <text key={`t${t}`} className="tick-label" x={x(t)} y={height - 4} textAnchor="middle">{fmt(t)}</text>)}
        {bars.map((b, i) => {
          const cy = 4 + i * rowH + rowH / 2;
          const sel = selected !== undefined && (b.id ?? b.label) === selected;
          return (
            <g key={b.label + i} style={{ cursor: onClick ? "pointer" : undefined }} onClick={() => onClick?.(b)}>
              {sel && <rect x={0} y={cy - rowH / 2 + 1} width={width} height={rowH - 2} fill="rgba(90,216,239,0.06)" rx={6} />}
              <text x={l - 10} y={cy + 4} textAnchor="end" style={{ fill: "var(--text-2)", fontSize: 12 }}>{b.label}</text>
              <rect x={l} y={cy - 7} width={Math.max(1, x(b.value) - l)} height={14} rx={4} fill={b.color ?? "var(--cyan)"} opacity={0.85} />
              {b.lo !== undefined && b.hi !== undefined && (
                <g stroke="#e8eef8" strokeWidth={1.4} opacity={0.85}>
                  <line x1={x(b.lo)} x2={x(b.hi)} y1={cy} y2={cy} />
                  <line x1={x(b.lo)} x2={x(b.lo)} y1={cy - 5} y2={cy + 5} />
                  <line x1={x(b.hi)} x2={x(b.hi)} y1={cy - 5} y2={cy + 5} />
                </g>
              )}
              <text x={width - r + 8} y={cy + 4} className="num" style={{ fill: "var(--text)", fontSize: 11.5, fontFamily: "var(--font-mono)" }}>{fmt(b.value)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  ylo?: number;
  yhi?: number;
  color: string;
  shape?: "circle" | "square" | "diamond" | "ring";
  size?: number;
  faded?: boolean;
  label?: ReactNode;
}

export function Scatter({ points, height = 320, xLabel, yLabel, xLog, yLog, xFmt = defaultFmt, yFmt = defaultFmt, frontier, selected, onSelect }: {
  points: ScatterPoint[]; height?: number; xLabel?: string; yLabel?: string; xLog?: boolean; yLog?: boolean; xFmt?: Fmt; yFmt?: Fmt;
  frontier?: { x: number; y: number }[]; selected?: string | null; onSelect?: (id: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<ScatterPoint | null>(null);
  const f: Frame = { width, height, m: { l: 58, r: 18, t: 14, b: 42 } };
  const [x0, x1] = extent(points.map((p) => p.x), !!xLog, 0.08);
  const [y0, y1] = extent(points.flatMap((p) => [p.y, p.ylo ?? p.y, p.yhi ?? p.y]), !!yLog, 0.08);
  const x = scale(x0, x1, f.m.l, width - f.m.r, xLog);
  const y = scale(y0, y1, height - f.m.b, f.m.t, yLog);
  const xt = xLog ? logTicks(x0, x1) : niceTicks(x0, x1, Math.max(3, Math.floor(width / 110)));
  const yt = yLog ? logTicks(y0, y1) : niceTicks(y0, y1, 5);
  const sorted = [...points].sort((a, b) => Number(!!b.faded) - Number(!!a.faded));
  return (
    <div className="chart-box" ref={ref}>
      <svg className="chart" width={width} height={height}>
        <Axes f={f} x={x} y={y} xt={xt} yt={yt} xFmt={xFmt} yFmt={yFmt} xLabel={xLabel} yLabel={yLabel} />
        {frontier && frontier.length > 1 && (
          <path d={`M${frontier.map((p) => `${x(p.x)},${y(p.y)}`).join("L")}`} fill="none" stroke="var(--green)" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.8} />
        )}
        {sorted.map((p) => {
          const cx = x(p.x);
          const cy = y(p.y);
          const s = p.size ?? 5;
          const sel = selected === p.id;
          const common = {
            fill: p.shape === "ring" ? "var(--bg)" : p.color,
            stroke: sel ? "#fff" : p.color,
            strokeWidth: sel ? 2.4 : 1.5,
            opacity: p.faded ? 0.28 : 0.95,
            style: { cursor: onSelect ? "pointer" : undefined },
            onMouseEnter: () => setHover(p),
            onMouseLeave: () => setHover(null),
            onClick: () => onSelect?.(p.id),
          };
          return (
            <g key={p.id}>
              {p.ylo !== undefined && p.yhi !== undefined && (
                <line x1={cx} x2={cx} y1={y(p.ylo)} y2={y(p.yhi)} stroke={p.color} strokeWidth={1.2} opacity={p.faded ? 0.2 : 0.6} />
              )}
              {p.shape === "square" ? <rect x={cx - s} y={cy - s} width={2 * s} height={2 * s} rx={1.5} {...common} />
                : p.shape === "diamond" ? <path d={`M${cx},${cy - s * 1.3}L${cx + s * 1.3},${cy}L${cx},${cy + s * 1.3}L${cx - s * 1.3},${cy}Z`} {...common} />
                  : <circle cx={cx} cy={cy} r={s} {...common} />}
              {sel && <circle cx={cx} cy={cy} r={s + 6} fill="none" stroke="var(--cyan)" strokeWidth={1.4} opacity={0.8} />}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="chart-tooltip" style={{ left: Math.min(width - 240, x(hover.x) + 14), top: Math.max(0, y(hover.y) - 30) }}>
          {hover.label ?? <b>{hover.id}</b>}
          <div className="num muted">{xLabel}: {xFmt(hover.x)} · {yLabel}: {yFmt(hover.y)}</div>
        </div>
      )}
    </div>
  );
}

export function StackedHistogram({ edges, series, height = 220, xLabel, yLabel = "count", xFmt = defaultFmt }: {
  edges: number[]; series: { label: string; color: string; counts: number[] }[]; height?: number; xLabel?: string; yLabel?: string; xFmt?: Fmt;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const f: Frame = { width, height, m: { l: 52, r: 12, t: 10, b: 40 } };
  const totals = edges.slice(0, -1).map((_, i) => series.reduce((s, ser) => s + (ser.counts[i] ?? 0), 0));
  const top = Math.max(1, ...totals);
  const x = scale(edges[0], edges[edges.length - 1], f.m.l, width - f.m.r);
  const y = scale(0, top * 1.05, height - f.m.b, f.m.t);
  const xt = niceTicks(edges[0], edges[edges.length - 1], Math.max(3, Math.floor(width / 100)));
  const yt = niceTicks(0, top * 1.05, 4);
  return (
    <div className="chart-box" ref={ref}>
      <svg className="chart" width={width} height={height}>
        <Axes f={f} x={x} y={y} xt={xt} yt={yt} xFmt={xFmt} yFmt={defaultFmt} xLabel={xLabel} yLabel={yLabel} />
        {edges.slice(0, -1).map((e0, i) => {
          let acc = 0;
          return (
            <g key={i}>
              {series.map((s) => {
                const v = s.counts[i] ?? 0;
                const y0p = y(acc);
                acc += v;
                return <rect key={s.label} x={x(e0) + 1} width={Math.max(0, x(edges[i + 1]) - x(e0) - 2)} y={y(acc)} height={Math.max(0, y0p - y(acc))} fill={s.color} opacity={0.85} rx={1.5} />;
              })}
            </g>
          );
        })}
      </svg>
      <div className="legend" style={{ marginTop: 4 }}>{series.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}</div>
    </div>
  );
}

export function Reliability({ series, height = 260 }: {
  series: { label: string; color: string; bins: { mean_predicted: number; observed: number; ci95: number[]; count: number }[] }[]; height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const f: Frame = { width, height, m: { l: 52, r: 14, t: 10, b: 40 } };
  const lo = Math.min(0.5, ...series.flatMap((s) => s.bins.flatMap((b) => [b.mean_predicted, b.ci95[0]])));
  const d0 = Math.max(0, Math.floor(lo * 10) / 10);
  const x = scale(d0, 1, f.m.l, width - f.m.r);
  const y = scale(d0, 1, height - f.m.b, f.m.t);
  const t = niceTicks(d0, 1, 5);
  return (
    <div className="chart-box" ref={ref}>
      <svg className="chart" width={width} height={height}>
        <Axes f={f} x={x} y={y} xt={t} yt={t} xFmt={(v) => v.toFixed(1)} yFmt={(v) => v.toFixed(1)} xLabel="model-predicted P(logical preserved)" yLabel="observed success rate" />
        <line x1={x(d0)} y1={y(d0)} x2={x(1)} y2={y(1)} stroke="rgba(200,220,255,0.35)" strokeDasharray="4 4" />
        {series.map((s) => (
          <g key={s.label}>
            <path d={`M${s.bins.map((b) => `${x(b.mean_predicted)},${y(b.observed)}`).join("L")}`} fill="none" stroke={s.color} strokeWidth={1.8} />
            {s.bins.map((b, i) => (
              <g key={i}>
                <line x1={x(b.mean_predicted)} x2={x(b.mean_predicted)} y1={y(b.ci95[0])} y2={y(b.ci95[1])} stroke={s.color} opacity={0.6} />
                <circle cx={x(b.mean_predicted)} cy={y(b.observed)} r={Math.min(7, 2.5 + Math.log10(b.count + 1))} fill={s.color} opacity={0.9}>
                  <title>{`${s.label}: predicted ${b.mean_predicted.toFixed(3)}, observed ${b.observed.toFixed(3)} (n=${b.count})`}</title>
                </circle>
              </g>
            ))}
          </g>
        ))}
      </svg>
      <div className="legend" style={{ marginTop: 4 }}>
        {series.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}
        <span><i style={{ background: "transparent", borderTop: "1px dashed #9aa", borderRadius: 0, height: 1 }} />perfect calibration</span>
      </div>
    </div>
  );
}

export function Heatmap({ labels, values, fmt = (v: number) => v.toFixed(3), low = 0.9 }: { labels: string[]; values: number[][]; fmt?: Fmt; low?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = labels.length;
  const lab = Math.min(170, width * 0.32);
  const cell = Math.max(22, Math.min(54, (width - lab - 8) / n));
  const height = lab * 0.0 + n * cell + 120;
  const color = (v: number) => {
    const t = Math.max(0, Math.min(1, (v - low) / (1 - low)));
    return `rgba(90, 216, 239, ${0.08 + 0.75 * t})`;
  };
  return (
    <div className="chart-box" ref={ref}>
      <svg className="chart" width={width} height={height}>
        {labels.map((l, i) => (
          <text key={`r${l}`} x={lab - 6} y={i * cell + cell / 2 + 4} textAnchor="end" style={{ fontSize: 10.5, fill: "var(--text-2)" }}>{l}</text>
        ))}
        {labels.map((l, j) => (
          <text key={`c${l}`} transform={`translate(${lab + j * cell + cell / 2},${n * cell + 8}) rotate(50)`} style={{ fontSize: 10.5, fill: "var(--text-2)" }}>{l}</text>
        ))}
        {values.map((row, i) => row.map((v, j) => (
          <g key={`${i}-${j}`}>
            <rect x={lab + j * cell + 1} y={i * cell + 1} width={cell - 2} height={cell - 2} rx={3} fill={color(v)}><title>{`${labels[i]} vs ${labels[j]}: ${fmt(v)}`}</title></rect>
            {cell >= 40 && <text x={lab + j * cell + cell / 2} y={i * cell + cell / 2 + 3.5} textAnchor="middle" style={{ fontSize: 9.5, fill: "var(--text)", fontFamily: "var(--font-mono)" }}>{fmt(v)}</text>}
          </g>
        )))}
      </svg>
    </div>
  );
}

export function Sparkbars({ values, height = 44, color = "var(--teal)", highlight }: { values: number[]; height?: number; color?: string; highlight?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...values);
  const w = width / Math.max(1, values.length);
  return (
    <div ref={ref}>
      <svg width={width} height={height} className="chart">
        {values.map((v, i) => (
          <rect key={i} x={i * w + 1} width={Math.max(1, w - 2)} y={height - (v / max) * (height - 4)} height={(v / max) * (height - 4)} rx={2}
            fill={color} opacity={highlight === undefined || highlight === i ? 0.9 : 0.35}>
            <title>{`round ${i}: ${v} detection events`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

export const useStableSeries = (fn: () => Series[], deps: unknown[]) =>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(fn, deps);
