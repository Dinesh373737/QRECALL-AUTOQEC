import { useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleX, Cpu, Download, FileSpreadsheet, Gauge, Play, SlidersHorizontal, Target } from "lucide-react";
import { downloadJson, downloadText, toCsv, useApi, useJob } from "../lib/api";
import { fix, int, pct, signedPct } from "../lib/format";
import type { OptCandidateRow, Ranking } from "../lib/types";
import { Scatter } from "../charts/charts";
import { Callout, Card, Drawer, ErrorBox, Field, JobProgress, Loading, PageHead, ProvenanceBadge, Seg, Slider, Status, Tech, Toggle, useDebounced, Eq } from "../components/ui";

const FAMILY_COLORS: Record<string, string> = {
  two_ancilla_sequential: "#5ad8ef",
  two_ancilla_interleaved: "#a58bff",
  one_ancilla_reuse: "#3fd0b0",
};
const FAMILY_LABEL: Record<string, string> = {
  two_ancilla_sequential: "2 ancillas · sequential",
  two_ancilla_interleaved: "2 ancillas · interleaved",
  one_ancilla_reuse: "1 ancilla · reuse",
};

function Limit({ label, on, setOn, value, setValue, min, max, step, fmt }: {
  label: string; on: boolean; setOn: (v: boolean) => void; value: number; setValue: (v: number) => void; min: number; max: number; step: number; fmt: (v: number) => string;
}) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <Toggle on={on} onChange={setOn} label={label} />
      {on && <Slider label="" value={value} min={min} max={max} step={step} onChange={setValue} format={fmt} />}
    </div>
  );
}

function front(points: { x: number; y: number }[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const out: { x: number; y: number }[] = [];
  let best = Infinity;
  for (const p of sorted) if (p.y < best) { out.push(p); best = p.y; }
  return out;
}

export default function ResourceOptimizer() {
  const [target, setTarget] = useState<"h7" | "line">("h7");
  const [w, setW] = useState({ Q: 1, G2: 1, D: 1 });
  const [lim, setLim] = useState({ Q: 5, G2: 14, D: 14, pL: 0.03 });
  const [on, setOn] = useState({ Q: false, G2: false, D: false, pL: true });
  const [conservative, setConservative] = useState(true);
  const [xAxis, setXAxis] = useState<"G2" | "D" | "Q" | "duration_ns">("G2");
  const [detail, setDetail] = useState<string | null>(null);
  const [noise, setNoise] = useState({ p1: 0.001, p2: 0.01, p_meas: 0.02, p_idle: 0.002 });
  const [shots, setShots] = useState(4000);
  const job = useJob<{ evaluation_id: string }>();
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  useEffect(() => {
    if (job.result?.evaluation_id) setEvaluationId(job.result.evaluation_id);
  }, [job.result]);
  const limits = useMemo(() => Object.fromEntries((["Q", "G2", "D", "pL"] as const).map((k) => [k, on[k] ? lim[k] : null])), [on, lim]);
  const body = useMemo(() => ({ recorded: target, evaluation_id: evaluationId, weights: w, limits, conservative }), [target, evaluationId, w, limits, conservative]);
  const deb = useDebounced(body, 150);
  const { data, error, reload } = useApi<Ranking>("/qec/optimizer/rank", deb);
  const rows = data?.candidates ?? [];
  const sel = data?.selected;
  const det = detail && data ? { row: rows.find((r) => r.id === detail)!, info: data.candidates_detail[detail] } : null;
  const xOf = (r: OptCandidateRow) => (xAxis === "duration_ns" ? r.duration_ns : r[xAxis]);
  const points = rows.map((r) => ({
    id: r.id, x: xOf(r), y: r.pL, ylo: r.pL_ci95[0], yhi: r.pL_ci95[1], color: FAMILY_COLORS[r.family] ?? "#fff",
    shape: (r.is_baseline ? "square" : r.feasible ? "circle" : "ring") as "square" | "circle" | "ring", faded: !r.feasible, size: r.id === sel?.id ? 7 : 5,
    label: <div><b>{FAMILY_LABEL[r.family]}</b> · {r.id}<div className="num muted">Q {r.Q} · G2 {r.G2} · D {r.D} · pL {pct(r.pL, 2)} {r.feasible ? "· feasible" : "· infeasible"}</div></div>,
  }));
  const pf = front(rows.map((r) => ({ x: xOf(r), y: r.pL })));
  const sorted = [...rows].sort((a, b) => Number(b.feasible) - Number(a.feasible) || (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.J - b.J);

  return (
    <div className="fade-in">
      <PageHead kicker="Module 1 · Interactive Studio" title="Resource-Aware Circuit Optimizer"
        lede="Many compilations of the SAME logical task — one QEC cycle of the three-qubit memory — are verified, simulated under one declared noise model, filtered by hard constraints and ranked by the normalized cost J. This selects an implementation; it is a different problem from decoding."
        right={<>
          <ProvenanceBadge kind="simulation" /><ProvenanceBadge kind={evaluationId ? "live" : "recorded"} label={evaluationId ? "Custom evaluation" : "Recorded evaluation"} />
          <button className="btn sm" disabled={!data} onClick={() => data && downloadText("autoqec-optimizer-candidates.csv", toCsv(data.candidates.map((c) => ({
            id: c.id, family: c.family, Q: c.Q, G2: c.G2, D: c.D, pL: c.pL, pL_low: c.pL_ci95[0], pL_high: c.pL_ci95[1], duration_ns: c.duration_ns,
            J: c.J, feasible: c.feasible, violations: c.violations.join("; "), pareto: c.pareto, rank: c.rank ?? "", baseline: c.is_baseline, settings: c.settings,
          }))), "text/csv")}><FileSpreadsheet />CSV</button>
          <button className="btn sm" disabled={!data} onClick={() => data && downloadJson("autoqec-optimizer-ranking.json", data)}><Download />JSON</button>
        </>} />
      <div className="two-pane">
        <div className="col sticky">
          <Card title="Target device" icon={<Cpu />}>
            <Seg full value={target} onChange={(v) => { setTarget(v); setEvaluationId(null); }} options={[{ value: "h7", label: "7-qubit H graph" }, { value: "line", label: "5-qubit line" }]} />
            <div className="field-help" style={{ marginTop: 8 }}>Basis rz, sx, x, cx. Families × optimization levels 0–3 × layouts (trivial, dense, sabre) × routing (basic, sabre) × 2 seeds; identical outputs merged.</div>
          </Card>
          <Card title="Objective weights" icon={<SlidersHorizontal />}>
            <div className="col">
              <Slider label="w_Q · physical qubits" value={w.Q} min={0} max={5} step={0.1} onChange={(v) => setW({ ...w, Q: v })} format={(v) => v.toFixed(1)} />
              <Slider label="w_G · two-qubit gates" value={w.G2} min={0} max={5} step={0.1} onChange={(v) => setW({ ...w, G2: v })} format={(v) => v.toFixed(1)} tone="violet" />
              <Slider label="w_D · circuit depth" value={w.D} min={0} max={5} step={0.1} onChange={(v) => setW({ ...w, D: v })} format={(v) => v.toFixed(1)} tone="teal" />
            </div>
          </Card>
          <Card title="Hard constraints" icon={<Target />}>
            <div className="col">
              <Limit label="Q ≤ Q_max" on={on.Q} setOn={(v) => setOn({ ...on, Q: v })} value={lim.Q} setValue={(v) => setLim({ ...lim, Q: v })} min={3} max={8} step={1} fmt={(v) => String(v)} />
              <Limit label="G₂ ≤ G₂,max" on={on.G2} setOn={(v) => setOn({ ...on, G2: v })} value={lim.G2} setValue={(v) => setLim({ ...lim, G2: v })} min={4} max={40} step={1} fmt={(v) => String(v)} />
              <Limit label="D ≤ D_max" on={on.D} setOn={(v) => setOn({ ...on, D: v })} value={lim.D} setValue={(v) => setLim({ ...lim, D: v })} min={4} max={50} step={1} fmt={(v) => String(v)} />
              <Limit label="p_L ≤ p_L,max" on={on.pL} setOn={(v) => setOn({ ...on, pL: v })} value={lim.pL} setValue={(v) => setLim({ ...lim, pL: v })} min={0.005} max={0.1} step={0.001} fmt={(v) => pct(v, 1)} />
              <Toggle on={conservative} onChange={setConservative} label="Use the 95% upper bound of p_L" />
            </div>
          </Card>
          <Card title="Re-evaluate under custom noise" icon={<Gauge />} sub="Runs Aer for every unique candidate (≈30 s)">
            <div className="col">
              <Slider label="p₁ (1-qubit depolarizing)" value={noise.p1} min={0} max={0.01} step={0.0005} onChange={(v) => setNoise({ ...noise, p1: v })} format={(v) => v.toFixed(4)} />
              <Slider label="p₂ (CX depolarizing)" value={noise.p2} min={0} max={0.05} step={0.001} onChange={(v) => setNoise({ ...noise, p2: v })} format={(v) => v.toFixed(3)} />
              <Slider label="p_meas (readout)" value={noise.p_meas} min={0} max={0.05} step={0.001} onChange={(v) => setNoise({ ...noise, p_meas: v })} format={(v) => v.toFixed(3)} />
              <Slider label="p_idle (per idle layer)" value={noise.p_idle} min={0} max={0.01} step={0.0005} onChange={(v) => setNoise({ ...noise, p_idle: v })} format={(v) => v.toFixed(4)} />
              <Field label="Shots per logical input"><Seg full value={shots} onChange={setShots} options={[{ value: 1000, label: "1k" }, { value: 4000, label: "4k" }, { value: 10000, label: "10k" }]} /></Field>
              <button className="btn violet" disabled={job.running} onClick={() => job.start("/qec/optimizer/evaluate", { coupling: target, noise, shots, seed: 1234 })}><Play />Evaluate candidates</button>
              <JobProgress job={job.job} error={job.error} onCancel={job.cancel} />
              {evaluationId && <div className="field-help">Showing the custom evaluation. Change the target to return to the recorded run.</div>}
            </div>
          </Card>
        </div>
        <div className="col">
          {error && <Card><ErrorBox message={error} onRetry={reload} /></Card>}
          {!data && !error && <Card><Loading label="Ranking verified candidates…" /></Card>}
          {data && (
            <>
              {sel ? (
                <Card tone="green" title={<><CircleCheck style={{ color: "var(--green)" }} />Selected implementation · {FAMILY_LABEL[sel.family]}</>}
                  sub={data.message} right={<button className="btn sm" onClick={() => setDetail(sel.id)}>Details</button>}>
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>Metric</th><th className="num">Baseline</th><th className="num">Selected</th><th className="num">Change</th></tr></thead>
                      <tbody>
                        {(["Q", "G2", "D", "pL", "duration_ns"] as const).map((k) => {
                          const c = data.comparison?.[k];
                          if (!c) return null;
                          const f = (v: number) => (k === "pL" ? pct(v, 2) : k === "duration_ns" ? `${int(v)} ns` : String(v));
                          return (
                            <tr key={k}>
                              <td>{{ Q: "Physical qubits Q", G2: "Two-qubit gates G₂", D: "Depth D", pL: "Logical failure p_L (point estimate)", duration_ns: "Estimated duration (declared gate times)" }[k]}</td>
                              <td className="num">{f(c.baseline)}</td><td className="num" style={{ color: "var(--text)" }}>{f(c.selected)}</td>
                              <td className="num" style={{ color: c.change_percent < 0 ? "var(--green)" : c.change_percent > 0 ? "var(--red)" : "var(--muted)" }}>{signedPct(c.change_percent)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="field-help" style={{ marginTop: 8 }}>
                    p_L baseline {pct(data.baseline.pL, 2)} [{pct(data.baseline.pL_ci95[0], 2)}, {pct(data.baseline.pL_ci95[1], 2)}] vs selected {pct(sel.pL, 2)} [{pct(sel.pL_ci95[0], 2)}, {pct(sel.pL_ci95[1], 2)}]. {data.comparison?.pL_note}
                  </div>
                </Card>
              ) : (
                <Card tone="red" title={<><CircleX style={{ color: "var(--red)" }} />No feasible candidate</>}>
                  <p>{data.message} Relax a constraint to see the trade-off. Most frequent violations:</p>
                  <div className="row wrap" style={{ marginTop: 8 }}>
                    {Object.entries(rows.flatMap((r) => r.violations.map((v) => v.split(" ")[0])).reduce((m: Record<string, number>, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}))
                      .map(([k, n]) => <span key={k} className="badge fail">{k}: {n} candidates</span>)}
                  </div>
                </Card>
              )}
              <Card title="Trade-off map" sub={`${rows.length} unique verified candidates · ${data.feasible_count} feasible · error bars = 95% Wilson interval`}
                right={<Seg value={xAxis} onChange={setXAxis} options={[{ value: "G2", label: "G₂" }, { value: "D", label: "Depth" }, { value: "Q", label: "Qubits" }, { value: "duration_ns", label: "Duration" }]} />}>
                <Scatter points={points} xLabel={{ G2: "two-qubit gates G₂", D: "depth D", Q: "physical qubits Q", duration_ns: "estimated duration (ns)" }[xAxis]} yLabel="logical failure p_L"
                  yFmt={(v) => pct(v, 1)} frontier={pf} selected={sel?.id ?? null} onSelect={setDetail} />
                <div className="legend">
                  {Object.entries(FAMILY_LABEL).map(([k, v]) => <span key={k}><i style={{ background: FAMILY_COLORS[k] }} />{v}</span>)}
                  <span>■ baseline · ● feasible · ○ infeasible · dashed = 2-D Pareto front for these axes</span>
                </div>
              </Card>
              <Card title="All candidates" sub={`references: Q_ref ${data.references.Q}, G₂,ref ${data.references.G2}, D_ref ${data.references.D} — ${data.reference_source}`}>
                <div className="table-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
                  <table className="data">
                    <thead><tr><th>Rank</th><th>Family</th><th className="num">Q</th><th className="num">G₂</th><th className="num">D</th><th className="num">p_L</th><th className="num">J</th><th>Status</th><th>Pareto</th><th className="num">≡ settings</th></tr></thead>
                    <tbody>
                      {sorted.map((r) => (
                        <tr key={r.id} className={`clickable ${r.id === sel?.id ? "best" : ""}`} onClick={() => setDetail(r.id)}>
                          <td className="num">{r.rank ?? "—"}</td>
                          <td><span style={{ color: FAMILY_COLORS[r.family] }}>●</span> {FAMILY_LABEL[r.family]}{r.is_baseline && <span className="badge neutral" style={{ marginLeft: 6 }}>baseline</span>}</td>
                          <td className="num">{r.Q}</td><td className="num">{r.G2}</td><td className="num">{r.D}</td>
                          <td className="num">{pct(r.pL, 2)}</td><td className="num">{fix(r.J, 3)}</td>
                          <td>{r.feasible ? <span className="badge pass">Feasible</span> : <span className="badge fail" title={r.violations.join("; ")}>Infeasible</span>}</td>
                          <td>{r.pareto ? "✓" : ""}</td><td className="num">{r.equivalent_settings}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="grid g2">
                <Callout tone="warn"><b>Fewer gates ≠ lower logical error.</b> p_L is measured by Monte-Carlo simulation under the declared model (depolarizing gates, idle noise per layer, readout error) rather than assumed from gate counts; candidates with similar G₂ can differ because of idle exposure and where errors land.</Callout>
                <Callout tone="info"><b>Depth vs time.</b> Depth counts gate layers. The duration column uses declared gate times (1q 35 ns, CX 300 ns, measure 800 ns, reset 400 ns) on the critical path — a model estimate, not a hardware measurement.</Callout>
              </div>
              <Tech title="Objective, references and boundaries">
                <Eq tex={String.raw`J(c) = w_Q\frac{Q}{Q_{\mathrm{ref}}} + w_G\frac{G_2}{G_{2,\mathrm{ref}}} + w_D\frac{D}{D_{\mathrm{ref}}},\quad \text{subject to } Q\le Q_{\max},\ G_2\le G_{2,\max},\ D\le D_{\max},\ p_L\le p_{L,\max}`} />
                <p>References are the metrics of the documented baseline compilation (two ancillas, sequential schedule, optimization level 0, trivial layout, basic routing, seed 11). Hard constraints are applied before ranking; ties break on p_L then candidate id. Every candidate passed noiseless functional checks for |0_L⟩, |1_L⟩ and each single-X injection before being eligible.</p>
                <p>This normalized score is the project's own multi-objective proxy. It is <b>not</b> Google's FLASQ cost model (arXiv:2511.08508, implemented in Qualtran), which estimates lattice-surgery spacetime volume for fault-tolerant algorithms — a different regime from choosing compilations of a small physical circuit. The “spacetime proxy” Q × duration shown in details is likewise our simplified proxy.</p>
              </Tech>
            </>
          )}
        </div>
      </div>
      <Drawer open={!!det} onClose={() => setDetail(null)} title={det ? `Candidate ${det.row.id}` : ""}>
        {det && (
          <>
            <div className="row wrap">
              <span className="badge neutral">{FAMILY_LABEL[det.row.family]}</span>
              {det.row.feasible ? <span className="badge pass">Feasible</span> : <span className="badge fail">Infeasible</span>}
              {det.row.pareto && <span className="badge live">Pareto-optimal (Q, G₂, D, p_L)</span>}
              {det.row.is_baseline && <span className="badge neutral">Baseline</span>}
            </div>
            <p>{det.info.family_text}</p>
            {det.row.violations.length > 0 && <Callout tone="err">{det.row.violations.join(" · ")}</Callout>}
            <div className="kv">
              <dt>Q / G₂ / G₁ / D</dt><dd>{det.row.Q} / {det.row.G2} / {det.row.G1} / {det.row.D}</dd>
              <dt>measurements / resets</dt><dd>{det.info.measurements} / {det.info.resets}</dd>
              <dt>p_L</dt><dd>{pct(det.row.pL, 3)} [{pct(det.row.pL_ci95[0], 3)}, {pct(det.row.pL_ci95[1], 3)}]</dd>
              <dt>estimated duration</dt><dd>{int(det.row.duration_ns)} ns</dd>
              <dt>spacetime proxy Q×t</dt><dd>{int(det.row.spacetime_proxy)} qubit·ns (our proxy)</dd>
              <dt>J and terms</dt><dd>{fix(det.row.J, 3)} = {Object.entries(det.row.cost_terms).map(([k, v]) => `${k} ${fix(v, 3)}`).join(" + ")}</dd>
              <dt>physical qubits used</dt><dd>{det.info.active_physical_qubits.map((q) => `q${q}`).join(", ")}</dd>
              <dt>gate counts</dt><dd>{Object.entries(det.info.ops).map(([k, v]) => `${k}:${v}`).join("  ")}</dd>
              <dt>compile time</dt><dd>{fix(det.row.compile_ms, 1)} ms (median)</dd>
            </div>
            <Card title="Independent functional verification" sub={det.info.verification.method}>
              <div className="col" style={{ gap: 6 }}>
                {det.info.verification.checks.map((c) => (
                  <div key={c.case} className="spread"><span>{c.case}{c.syndrome ? <span className="muted num"> · syndrome {c.syndrome.join(",")}</span> : null}</span><Status ok={c.passed} /></div>
                ))}
              </div>
            </Card>
            <Card title={`Equivalent transpiler settings (${det.row.equivalent_settings})`}>
              <div className="col" style={{ gap: 4, maxHeight: 240, overflowY: "auto" }}>
                {det.info.settings.map((s, i) => <span key={i} className="num muted" style={{ fontSize: 11.5 }}>opt {s.optimization_level} · layout {s.layout_method} · routing {s.routing_method} · seed {s.seed}</span>)}
              </div>
            </Card>
          </>
        )}
      </Drawer>
    </div>
  );
}
