import { useMemo } from "react";
import { CircleCheck, CircleX, Cpu } from "lucide-react";
import { useApi } from "../lib/api";
import { fix, int, sci, us } from "../lib/format";
import type { ExperimentSummary, ShotEvidence } from "../lib/types";
import { Field, Seg } from "./ui";

export interface ExperimentList {
  layout: string;
  count: number;
  experiments: ExperimentSummary[];
  label: string;
  doi: string;
}

export function useExperiments() {
  return useApi<ExperimentList>("/google/experiments");
}

function parse(id: string) {
  const m = id.match(/^(surface_code|repetition_code)_b([XZ])_d(\d+)_r(\d+)_center_(\d+)_(\d+)$/);
  return m ? { code: m[1], basis: m[2], d: Number(m[3]), r: Number(m[4]), center: `${m[5]}_${m[6]}` } : null;
}

export function ExperimentSelector({ value, onChange, list, maxRounds }: { value: string; onChange: (id: string) => void; list: ExperimentSummary[]; maxRounds?: number }) {
  const cur = parse(value) ?? { code: "surface_code", basis: "Z", d: 3, r: 5, center: "3_5" };
  const ids = useMemo(() => list.map((e) => e.id).filter((id) => !maxRounds || (parse(id)?.r ?? 0) <= maxRounds), [list, maxRounds]);
  const pick = (patch: Partial<typeof cur>) => {
    const want = { ...cur, ...patch };
    const exact = `${want.code}_b${want.basis}_d${want.d}_r${String(want.r).padStart(2, "0")}_center_${want.center}`;
    if (ids.includes(exact)) return onChange(exact);
    // fall back to the closest available configuration
    const cands = ids.map((id) => ({ id, p: parse(id)! })).filter((x) => x.p.code === want.code && (patch.basis === undefined || x.p.basis === want.basis) && (patch.d === undefined || x.p.d === want.d));
    cands.sort((a, b) => Math.abs(a.p.r - want.r) - Math.abs(b.p.r - want.r) || Number(a.p.center !== want.center) - Number(b.p.center !== want.center) || Number(a.p.basis !== want.basis) - Number(b.p.basis !== want.basis));
    if (cands[0]) onChange(cands[0].id);
  };
  const forCode = ids.map(parse).filter((p) => p && p.code === cur.code) as NonNullable<ReturnType<typeof parse>>[];
  const distances = [...new Set(forCode.map((p) => p.d))].sort((a, b) => a - b);
  const centers = [...new Set(forCode.filter((p) => p.d === cur.d).map((p) => p.center))].sort();
  const rounds = [...new Set(forCode.filter((p) => p.d === cur.d).map((p) => p.r))].sort((a, b) => a - b);
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, alignItems: "end" }}>
      <Field label="Code">
        <Seg full value={cur.code} onChange={(v) => pick(v === "repetition_code" ? { code: v, d: 25, r: 50, center: "5_5", basis: "Z" } : { code: v, d: 3, r: 5, center: "3_5" })}
          options={[{ value: "surface_code", label: "Surface" }, { value: "repetition_code", label: "Repetition" }]} />
      </Field>
      <Field label="Distance"><Seg full value={cur.d} onChange={(v) => pick({ d: v, center: v === 5 ? "5_5" : v === 3 ? "3_5" : cur.center })} options={distances.map((d) => ({ value: d, label: `d=${d}` }))} /></Field>
      <Field label="Memory basis"><Seg full value={cur.basis} onChange={(v) => pick({ basis: v })} options={(cur.code === "repetition_code" ? ["Z"] : ["X", "Z"]).map((b) => ({ value: b, label: b }))} /></Field>
      <Field label="Patch center">
        <select className="input" value={cur.center} onChange={(e) => pick({ center: e.target.value })} aria-label="Patch center">
          {centers.map((c) => <option key={c} value={c}>({c.replace("_", ", ")})</option>)}
        </select>
      </Field>
      <Field label="Rounds">
        <select className="input" value={cur.r} onChange={(e) => pick({ r: Number(e.target.value) })} aria-label="Rounds">
          {rounds.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
    </div>
  );
}

export function DecoderVerdicts({ ev }: { ev: ShotEvidence }) {
  const order = ["pymatching_circuit", "pymatching_pij", "pymatching_correlated", "ising_noise_aware", "ising_uniform",
    "google_pymatching", "google_correlated_matching", "google_belief_matching", "google_tensor_network_contraction"];
  const rows = order.filter((k) => ev.decoders[k]).map((k) => [k, ev.decoders[k]] as const);
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>Decoder</th><th>Predicts</th><th>Verdict</th><th>Evidence</th></tr></thead>
        <tbody>
          {rows.map(([k, d]) => (
            <tr key={k}>
              <td>
                <div style={{ color: "var(--text)", fontWeight: 560 }}>{d.label}</div>
                <div className="field-help">{d.source}</div>
              </td>
              <td className="num">{d.prediction === null ? "—" : d.prediction ? "flip" : "no flip"}</td>
              <td>{d.correct === null ? <span className="badge neutral">{d.status ?? "n/a"}</span> : d.correct ? <span className="badge pass"><CircleCheck />Correct</span> : <span className="badge fail"><CircleX />Wrong</span>}</td>
              <td className="num" style={{ fontSize: 11.5 }}>
                {d.edges ? `${d.edges.length} matched edge(s), weight ${fix(d.total_weight, 2)}, ${us(d.decode_us)}` : null}
                {d.mechanisms ? `${d.mechanisms.length} mechanism(s), E = ${fix(d.objective, 2)}, ${fix(d.solve_ms, 0)} ms, ${d.status}` : null}
                {!d.edges && !d.mechanisms ? "prediction only" : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnswerKey({ ev }: { ev: ShotEvidence }) {
  return (
    <div className="card glow-teal" style={{ padding: 16 }}>
      <div className="spread">
        <div>
          <div className="page-kicker m2" style={{ marginBottom: 4 }}>Answer key · measured on hardware</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600 }}>
            Logical observable {ev.measured.actual_observable_flip ? "FLIPPED" : "not flipped"}
          </div>
        </div>
        <Cpu style={{ width: 28, height: 28, color: "var(--teal)" }} />
      </div>
      <div className="field-help" style={{ marginTop: 6 }}>
        Recorded in obs_flips_actual for shot {int(ev.shot)} ({ev.partition} partition). Decoders never see this value; it is only used to score them.
      </div>
    </div>
  );
}

export function MechanismTable({ rows, label }: { rows: { detectors: number[]; probability: number; weight: number; hyperedge?: boolean; observables?: number[]; boundary?: boolean; flips_observable?: boolean }[]; label: string }) {
  if (!rows.length) return <div className="field-help">No {label} — the decoder explained the shot with no faults.</div>;
  return (
    <div className="table-wrap" style={{ maxHeight: 260, overflowY: "auto" }}>
      <table className="data">
        <thead><tr><th>Detectors</th><th className="num">p (model)</th><th className="num">weight ln((1−p)/p)</th><th>Flags</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="num">{r.detectors.map((d) => `D${d}`).join(" · ")}{r.boundary ? " · boundary" : ""}</td>
              <td className="num">{sci(r.probability, 2)}</td>
              <td className="num">{fix(r.weight, 2)}</td>
              <td>
                {(r.observables?.length || r.flips_observable) ? <span className="badge warn">flips L0</span> : null}
                {r.hyperedge ? <span className="badge neutral" style={{ marginLeft: 4 }}>hyperedge</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
