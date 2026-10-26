import { useEffect, useMemo, useState } from "react";
import { Microscope, Scale } from "lucide-react";
import { useApi } from "../lib/api";
import { qNum, qStr } from "../lib/router";
import { fix, pct, sci } from "../lib/format";
import type { Analysis, Explanation, LogicalClasses, SensitivityAxis } from "../lib/types";
import { Callout, Card, Eq, ErrorBox, Field, Loading, Metric, PageHead, ProvenanceBadge, Seg, Slider, Tech, Toggle, useDebounced } from "../components/ui";
import { EnergyRanking } from "../components/qec";

interface AnalyzeResult {
  analysis: Analysis & { logical_classes: LogicalClasses };
  decisions: Record<string, { correction: string; decode_time_us: number }>;
  explanation: Explanation;
  sensitivity: { readout: SensitivityAxis; data: SensitivityAxis } | null;
  code: { distance: number; stabilizers: { name: string; pauli: string }[] };
}

const PALETTE = ["#5ad8ef", "#a58bff", "#3fd0b0", "#f3b867", "#f47c80", "#7aa7ff", "#f08fc0", "#9db6e8"];

function DecisionBand({ axis, label }: { axis: SensitivityAxis; label: string }) {
  const lo = Math.log10(axis.regions[0].from_mean);
  const hi = Math.log10(axis.regions[axis.regions.length - 1].to_mean);
  const pos = (v: number) => ((Math.log10(v) - lo) / (hi - lo || 1)) * 100;
  const choices = [...new Set(axis.regions.map((r) => r.choice))];
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="spread"><span className="field-label">{label}</span><span className="num muted" style={{ fontSize: 11 }}>{axis.decision_changes} decision change{axis.decision_changes === 1 ? "" : "s"}</span></div>
      <div style={{ position: "relative", height: 34, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)" }}>
        {axis.regions.map((r, i) => {
          // boundaries sit halfway (in log space) between the last and first grid points of adjacent regions
          const start = i === 0 ? 0 : (pos(axis.regions[i - 1].to_mean) + pos(r.from_mean)) / 2;
          const end = i === axis.regions.length - 1 ? 100 : (pos(r.to_mean) + pos(axis.regions[i + 1].from_mean)) / 2;
          return (
          <div key={i} title={`${r.choice}: mean probability ${sci(r.from_mean)} – ${sci(r.to_mean)}`}
            style={{ position: "absolute", left: `${start}%`, width: `${Math.max(0.5, end - start)}%`, top: 0, bottom: 0,
              background: PALETTE[choices.indexOf(r.choice) % PALETTE.length], opacity: 0.32, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span className="bits" style={{ fontSize: 11.5, color: "var(--text)" }}>{r.choice}</span>
          </div>
          );
        })}
        <div style={{ position: "absolute", left: `${pos(axis.current_mean)}%`, top: -2, bottom: -2, width: 2, background: "#fff", boxShadow: "0 0 8px #fff" }} title="current setting" />
      </div>
      <div className="spread num muted" style={{ fontSize: 10.5 }}>
        <span>{sci(axis.regions[0].from_mean)}</span><span>current {sci(axis.current_mean)} → chooses {axis.current_choice}</span><span>{sci(axis.regions[axis.regions.length - 1].to_mean)}</span>
      </div>
    </div>
  );
}

export default function DecoderExplainer({ query }: { query: URLSearchParams }) {
  const [distance, setDistance] = useState<3 | 5 | 7>(3);
  const [syndrome, setSyndrome] = useState(qStr(query, "syndrome", "10"));
  const [perQubit, setPerQubit] = useState(false);
  const [p, setP] = useState<number[]>(() => Array(3).fill(qNum(query, "p", 0.1)));
  const [q, setQ] = useState<number[]>(() => Array(2).fill(qNum(query, "q", 0.08)));
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (query.get("syndrome")) setSyndrome(query.get("syndrome") as string);
    if (query.get("p")) setP(Array(3).fill(qNum(query, "p", 0.1)));
    if (query.get("q")) setQ(Array(2).fill(qNum(query, "q", 0.08)));
    setDistance(3);
  }, [query]);
  const changeDistance = (d: 3 | 5 | 7) => {
    setDistance(d);
    setSyndrome("0".repeat(d - 1).replace(/^0/, "1"));
    setP(Array(d).fill(p[0]));
    setQ(Array(d - 1).fill(q[0]));
  };
  const body = useMemo(() => ({ distance, syndrome, p, q }), [distance, syndrome, p, q]);
  const deb = useDebounced(body, 160);
  const ok = syndrome.length === distance - 1 && p.length === distance && q.length === distance - 1;
  const { data, error, reload } = useApi<AnalyzeResult>(ok ? "/qec/lab/analyze" : null, deb);
  const a = data?.analysis;
  const cls = a?.logical_classes;
  const sel = a?.candidates.find((c) => c.candidate === (selected ?? a.best));

  return (
    <div className="fade-in">
      <PageHead kicker="Module 1 · Interactive Studio" title="Decoder Explainer"
        lede="Choose any observed syndrome and any declared noise model. Every candidate error is enumerated exactly, scored by negative log-likelihood energy and ranked — so you can see why the decoder prefers one correction and how close the alternatives are."
        right={<><ProvenanceBadge kind="live" label="Exact enumeration" /></>} />
      <div className="two-pane">
        <div className="col sticky">
          <Card title="Observation" icon={<Microscope />}>
            <div className="col">
              <Field label="Code distance (data qubits)">
                <Seg full value={distance} onChange={changeDistance} options={[{ value: 3, label: "3" }, { value: 5, label: "5" }, { value: 7, label: "7" }]} />
              </Field>
              <Field label="Observed syndrome s₁…s₍ₙ₋₁₎" help="0 = stabilizer +1, 1 = stabilizer −1">
                <div className="row wrap" style={{ gap: 6 }}>
                  {syndrome.split("").map((b, i) => (
                    <button key={i} className={`btn sm ${b === "1" ? "active" : ""}`} aria-pressed={b === "1"}
                      onClick={() => setSyndrome(syndrome.split("").map((x, k) => (k === i ? (x === "1" ? "0" : "1") : x)).join(""))}>
                      S{i + 1}={b === "1" ? "−1" : "+1"}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Card>
          <Card title="Declared noise model" icon={<Scale />}>
            <div className="col">
              <Toggle on={perQubit} onChange={setPerQubit} label="Set probabilities per qubit / check" />
              {!perQubit ? (
                <>
                  <Slider label="Data-error probability p" value={p[0]} min={0.001} max={0.5} step={0.001} onChange={(v) => setP(Array(distance).fill(v))} format={(v) => v.toFixed(3)} />
                  <Slider label="Readout-error probability q" value={q[0]} min={0} max={0.5} step={0.001} onChange={(v) => setQ(Array(distance - 1).fill(v))} format={(v) => v.toFixed(3)} tone="violet" />
                </>
              ) : (
                <>
                  {p.map((v, i) => <Slider key={`p${i}`} label={`p for d${i}`} value={v} min={0.001} max={0.5} step={0.001} onChange={(x) => setP(p.map((y, k) => (k === i ? x : y)))} format={(x) => x.toFixed(3)} />)}
                  {q.map((v, i) => <Slider key={`q${i}`} label={`q for S${i + 1}`} value={v} min={0} max={0.5} step={0.001} onChange={(x) => setQ(q.map((y, k) => (k === i ? x : y)))} format={(x) => x.toFixed(3)} tone="violet" />)}
                </>
              )}
              <div className="field-help">Try q above p: the decoder starts blaming the measurement instead of the data.</div>
            </div>
          </Card>
        </div>
        <div className="col">
          {error && <Card><ErrorBox message={error} onRetry={reload} /></Card>}
          {!data && !error && <Card><Loading /></Card>}
          {data && a && cls && (
            <>
              <div className="grid g4">
                <Metric tone="green" label="Selected (minimum energy)" value={<span className="bits">{a.best}</span>} hint={`posterior ${pct(a.posterior_best, 1)} under the model`} />
                <Metric tone="cyan" label="Energy gap ΔE" value={fix(a.energy_gap, 3)} unit="nats" hint={a.energy_gap !== null ? `winner ${sci(Math.exp(Math.min(a.energy_gap, 700)))}× more probable than runner-up ${a.second}` : "no runner-up"} tip="E(second) − E(best). A model-based ambiguity indicator, not a calibrated probability of success." />
                <Metric tone="violet" label="Logical margin" value={fix(cls.logical_margin_nats, 2)} unit="nats" hint={`P(keep) ${pct(cls.p_logical_preserved, 2)} · P(flip) ${pct(cls.p_logical_flip, 2)}`} tip="ln P(logical survives) − ln P(logical flips), for the selected correction, under the declared model." />
                <Metric tone={a.best_vs_second_logically_equivalent ? "green" : "amber"} label="Runner-up equivalent?" value={a.best_vs_second_logically_equivalent ? "Yes" : "No"}
                  hint={a.best_vs_second_logically_equivalent ? "pattern ambiguity only: same logical outcome" : "logical ambiguity: they imply different outcomes"} />
              </div>
              <div className="grid g2">
                <Card title="Candidate energy ranking" sub={`${a.candidates.length} candidates enumerated exactly · click one for its terms`}>
                  <EnergyRanking candidates={a.candidates} selected={selected ?? a.best} onSelect={setSelected} limit={distance === 3 ? 8 : 14} />
                </Card>
                <div className="col">
                  {sel && (
                    <Card title={<>Candidate <span className="bits">{sel.candidate}</span></>} sub={`rank ${sel.rank} of ${a.candidates.length}`} tone={sel.rank === 1 ? "green" : undefined}>
                      <div className="kv">
                        <dt>predicted syndrome H·e</dt><dd>{sel.predicted_syndrome}</dd>
                        <dt>observed y</dt><dd>{a.observed_syndrome}</dd>
                        <dt>readout flips d = y ⊕ H·e</dt><dd>{sel.readout_flips}</dd>
                        <dt>data-error energy</dt><dd>{fix(sel.data_energy, 4)}</dd>
                        <dt>readout energy</dt><dd>{fix(sel.readout_energy, 4)}</dd>
                        <dt>total energy E(e|y)</dt><dd>{sel.energy === null ? "∞ (impossible under the model)" : fix(sel.energy, 4)}</dd>
                        <dt>Δ from best</dt><dd>{fix(sel.delta_from_best, 4)}</dd>
                        <dt>model posterior</dt><dd>{pct(sel.posterior, 3)}</dd>
                        <dt>logically equivalent to best</dt><dd>{sel.logically_equivalent_to_best ? "yes" : "no"}</dd>
                      </div>
                    </Card>
                  )}
                  <Card title="Logical-class comparison" sub={`for the selected correction ${cls.correction}`}>
                    <div className="col">
                      <div style={{ display: "flex", height: 26, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)" }}>
                        <div style={{ width: pct(cls.p_logical_preserved, 3), background: "rgba(99,214,151,0.55)", display: "flex", alignItems: "center", paddingLeft: 8, fontSize: 11.5 }}>keep {pct(cls.p_logical_preserved, 1)}</div>
                        <div style={{ flex: 1, background: "rgba(244,124,128,0.45)", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 8, fontSize: 11.5 }}>flip {pct(cls.p_logical_flip, 1)}</div>
                      </div>
                      <div className="kv">
                        <dt>best explanation keeping the logical</dt><dd>{cls.best_preserving_candidate ? `${cls.best_preserving_candidate.candidate} (E = ${fix(cls.best_preserving_candidate.energy)})` : "—"}</dd>
                        <dt>best explanation flipping it</dt><dd>{cls.best_flipping_candidate ? `${cls.best_flipping_candidate.candidate} (E = ${fix(cls.best_flipping_candidate.energy)})` : "—"}</dd>
                        <dt>logical energy gap</dt><dd>{fix(cls.logical_energy_gap, 4)}</dd>
                        <dt>P(exact restoration)</dt><dd>{pct(cls.p_exact_restoration, 2)}</dd>
                      </div>
                      <div className="field-help">{cls.meaning}</div>
                    </div>
                  </Card>
                  <Card title="Other decoders on this syndrome">
                    <div className="row wrap">
                      {Object.entries(data.decisions).map(([k, d]) => (
                        <span key={k} className="chip">{k}: <b className="bits">{d.correction}</b></span>
                      ))}
                    </div>
                    {data.decisions.exact && data.decisions.exact.correction !== a.best && (
                      <Callout tone="sim">The exact Bayes reference chooses <b className="bits">{data.decisions.exact.correction}</b> instead of the minimum-energy <b className="bits">{a.best}</b>: several less likely explanations share a logical outcome, and their combined probability outweighs the single best pattern.</Callout>
                    )}
                  </Card>
                </div>
              </div>
              <Card title="Why this decision? — computed answers" sub="Every sentence is filled in from the solver output above">
                <div className="grid g2">
                  {data.explanation.answers.map((x) => <div key={x.question} className="qa-item"><div className="qa-q">{x.question}</div><div className="qa-a">{x.answer}</div></div>)}
                </div>
              </Card>
              {data.sensitivity && (
                <Card title="Which assumptions drive the ranking?" sub="Rescale the declared probabilities (all qubits / checks together) and watch where the selected correction changes">
                  <div className="col gap-lg">
                    <DecisionBand axis={data.sensitivity.readout} label="Readout-error probability q (mean)" />
                    <DecisionBand axis={data.sensitivity.data} label="Data-error probability p (mean)" />
                  </div>
                </Card>
              )}
              <Tech title="Equations and conventions">
                <Eq tex={String.raw`s(e) = He \bmod 2,\qquad d = y \oplus s(e)`} />
                <Eq tex={String.raw`E(e\mid y) = -\sum_i\!\big[e_i\ln p_i + (1-e_i)\ln(1-p_i)\big] - \sum_j\!\big[d_j\ln q_j + (1-d_j)\ln(1-q_j)\big] = -\ln P(e, d)`} />
                <Eq tex={String.raw`P(e\mid y) = \frac{e^{-E(e\mid y)}}{\sum_{e'} e^{-E(e'\mid y)}},\qquad \Delta E = E_{(2)} - E_{(1)}`} />
                <p>{a.tie_breaking}. {a.energy_gap_meaning}</p>
              </Tech>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
