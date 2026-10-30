import { useMemo, useState } from "react";
import { ChartColumn, Download, FileSpreadsheet, Gauge, Scale, Sigma, Timer } from "lucide-react";
import { downloadJson, useApi } from "../lib/api";
import { href, qStr } from "../lib/router";
import { ci, expLabel, fix, int, methodColor, methodLabel, pct, shortExp, us } from "../lib/format";
import { BarList, Heatmap, LineChart, Scatter, StackedHistogram } from "../charts/charts";
import type { Series } from "../charts/charts";
import { Callout, Card, ErrorBox, Loading, Metric, PageHead, ProvenanceBadge, Seg, Tabs, Tech, Eq } from "../components/ui";

const ORDER = ["pymatching_circuit", "pymatching_pij", "pymatching_correlated", "google_pymatching", "google_correlated_matching", "google_belief_matching", "google_tensor_network_contraction"];
const ISING_ORDER = ["ising_noise_aware", "ising_uniform", "pymatching_pij", "pymatching_circuit", "pymatching_correlated", "google_correlated_matching", "google_belief_matching", "google_tensor_network_contraction"];

function VerdictBadge({ v }: { v: string }) {
  if (v === "fewer failures") return <span className="badge pass">fewer failures</span>;
  if (v === "more failures") return <span className="badge fail">more failures</span>;
  return <span className="badge neutral">not resolved</span>;
}

export default function HardwareBenchmarks({ query }: { query: URLSearchParams }) {
  const base = useApi<any>("/google/benchmarks/baseline");
  const summary = useApi<any>("/google/benchmarks/summary");
  const [tab, setTab] = useState<"rounds" | "ising" | "gap" | "agreement">("rounds");
  const [distance, setDistance] = useState(3);
  const [basis, setBasis] = useState<"X" | "Z">("Z");
  const [center, setCenter] = useState("3_5");
  const initialExp = qStr(query, "exp", "");
  const [isingExp, setIsingExp] = useState<string>(initialExp);
  const exps: any[] = base.data?.experiments ?? [];
  const groupKey = (e: any) => e.experiment.code === "surface_code" && e.experiment.distance === distance && e.experiment.basis === basis && `${e.experiment.center[0]}_${e.experiment.center[1]}` === (distance === 5 ? "5_5" : center);
  const group = exps.filter(groupKey).sort((a, b) => a.experiment.rounds - b.experiment.rounds);
  const series: Series[] = useMemo(() => ORDER.map((m) => ({
    id: m, label: methodLabel(m), color: methodColor(m), dashed: m.startsWith("google"),
    points: group.map((e) => ({ x: e.experiment.rounds, y: e.methods[m]?.rate, lo: e.methods[m]?.ci95[0], hi: e.methods[m]?.ci95[1] })).filter((p) => p.y !== undefined),
  })), [group]);
  const fits = (base.data?.per_round_fits ?? []).filter((f: any) => f.distance === distance && f.basis === basis && f.center === (distance === 5 ? "5_5" : center));
  const is = summary.data?.ising;
  const bs = summary.data?.baseline;
  const isRows: any[] = is?.experiments ?? [];
  const selIsing = isRows.find((r) => r.experiment === isingExp) ?? isRows.find((r) => r.distance === 3 && r.rounds === 5 && r.basis === "Z") ?? isRows[0];
  const gapRow = is?.gap?.find((g: any) => g.experiment === selIsing?.experiment);
  const agreeExp = exps.find((e) => e.experiment.id === (selIsing?.experiment ?? "surface_code_bZ_d3_r05_center_3_5"));

  return (
    <div className="fade-in">
      <PageHead module={2} kicker="Module 2 · Google Hardware Analyzer" title="Decoder Benchmarks on Real Hardware Shots"
        lede="Every method is scored against Google's recorded logical flips on the same shots, with 95% Wilson intervals and paired exact McNemar tests. Models are calibrated on one shot parity and tested on the other. PyMatching is a strong, highly optimized baseline; where it wins, this page says so."
        right={<>
          <ProvenanceBadge kind="hardware" /><ProvenanceBadge kind="recorded" />
          <a className="btn sm" href="/api/google/benchmarks/baseline/csv"><FileSpreadsheet />Baseline CSV</a>
          <a className="btn sm" href="/api/google/benchmarks/ising/csv"><FileSpreadsheet />Ising CSV</a>
          <button className="btn sm" disabled={!summary.data} onClick={() => downloadJson("autoqec-hardware-summary.json", summary.data)}><Download />JSON</button>
        </>} />
      {(base.error || summary.error) && <Card><ErrorBox message={base.error || summary.error} onRetry={() => { base.reload(); summary.reload(); }} /></Card>}
      {(!base.data || !summary.data) && !base.error && <Card><Loading label="Loading recorded real-data benchmarks…" /></Card>}
      {base.data && summary.data && (
        <div className="col gap-lg">
          <div className="grid g4">
            <Metric tone="teal" label="Experiments benchmarked" value={bs?.experiments ?? "—"} hint={`${int(exps.reduce((s, e) => s + e.shots_evaluated, 0))} real shots, all decoders`} />
            <Metric tone="green" label="Raw-data integrity" value={`${bs?.integrity_ok}/${bs?.experiments}`} hint="re-derived from measurements" />
            <Metric tone="cyan" label="PyMatching reproduction" value={`${bs?.reproduced_exactly}/${bs?.experiments}`} hint={`shot-exact; elsewhere ≤ ${int(bs?.max_disagreements)} near-degenerate shots differ`} />
            <Metric tone="violet" label="Ising experiments" value={is ? is.n : "running"} hint={is ? `${int(isRows.reduce((s, r) => s + r.shots, 0))} shots decoded exactly` : "benchmark not recorded yet"} />
          </div>
          {is && (
            <Card title="Verdicts computed from paired statistics" icon={<Scale />} tone="violet">
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.65, color: "var(--text-2)" }}>
                {is.sentences.map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ul>
            </Card>
          )}
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: "rounds", label: "Failure vs rounds (all shots)" },
            { value: "ising", label: "Ising/QUBO vs matching", count: is?.n },
            { value: "gap", label: "Held-out ambiguity test" },
            { value: "agreement", label: "Agreement & latency" },
          ]} />

          {tab === "rounds" && (
            <>
              <Card title="Logical failure probability vs number of rounds" sub="Per-shot failure over all 50,000 shots of each experiment · bands are 95% Wilson intervals"
                right={<div className="row wrap">
                  <Seg value={distance} onChange={setDistance} options={[{ value: 3, label: "d = 3" }, { value: 5, label: "d = 5" }]} />
                  <Seg value={basis} onChange={setBasis} options={[{ value: "X", label: "X basis" }, { value: "Z", label: "Z basis" }]} />
                  {distance === 3 && <Seg value={center} onChange={setCenter} options={["3_5", "5_3", "5_7", "7_5"].map((c) => ({ value: c, label: `(${c.replace("_", ",")})` }))} />}
                </div>}>
                <LineChart series={series} xLabel="QEC rounds" yLabel="logical failure per shot" yFmt={(v) => pct(v, 0)} height={340}
                  onPointClick={(s, p) => window.location.assign(href("/failures", { exp: `surface_code_b${basis}_d${distance}_r${String(p.x).padStart(2, "0")}_center_${distance === 5 ? "5_5" : center}` }))} />
                <div className="field-help">Click a point to investigate that experiment's failures. Dashed lines: Google's decoder predictions; solid lines: computed here.</div>
              </Card>
              {bs?.model_sensitivity && (
                <Card title="Noise-model sensitivity (all 131 experiments, all shots)" icon={<Scale />} sub={bs.model_sensitivity.meaning}>
                  <div className="grid g2">
                    {["pymatching_pij", "pymatching_correlated"].map((k) => {
                      const m = bs.model_sensitivity[k];
                      return (
                        <div key={k} className="col" style={{ gap: 6 }}>
                          <div style={{ fontWeight: 600, color: "var(--text)" }}>{methodLabel(k)} vs PyMatching · circuit DEM</div>
                          <div className="row wrap">
                            <span className="badge pass">fewer failures: {m.counts["fewer failures"] ?? 0}</span>
                            <span className="badge fail">more failures: {m.counts["more failures"] ?? 0}</span>
                            <span className="badge neutral">not resolved: {m.counts["not resolved"] ?? 0}</span>
                          </div>
                          <div className="field-help">median paired difference {pct(m.median_difference, 2)} over {m.experiments} experiments (exact McNemar, p &lt; 0.05){k === "pymatching_correlated" ? " — this row also changes the algorithm (two-pass correlated matching), not only the model." : " — model change only."}</div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
              <div className="grid g2">
                <Card title="Logical error per round (fitted)" icon={<Sigma />} sub="1 − 2P_L(r) = A(1 − 2ε)^r over tested rounds r ≥ 3">
                  <BarList fmt={(v) => pct(v, 2)} bars={fits.filter((f: any) => f.fit).sort((a: any, b: any) => a.fit.epsilon - b.fit.epsilon).map((f: any) => ({
                    label: methodLabel(f.method), value: f.fit.epsilon, lo: f.fit.ci95[0], hi: f.fit.ci95[1], color: methodColor(f.method),
                  }))} labelWidth={200} />
                  <div className="field-help">Per-round ε and per-shot failure are different metrics; they are never compared directly.</div>
                </Card>
                <Card title="Distance comparison (averaged over patches)" sub="ε averaged over the four d = 3 patches vs the single d = 5 patch">
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>Decoder</th><th className="num">d = 3 ε</th><th className="num">d = 5 ε</th><th>d = 5 better?</th></tr></thead>
                      <tbody>
                        {ORDER.map((m) => {
                          const e3 = bs?.epsilon_by_distance.find((r: any) => r.distance === 3 && r.basis === basis && r.method === m);
                          const e5 = bs?.epsilon_by_distance.find((r: any) => r.distance === 5 && r.basis === basis && r.method === m);
                          if (!e3 || !e5) return null;
                          return <tr key={m}><td>{methodLabel(m)}</td><td className="num">{pct(e3.epsilon_mean, 3)}</td><td className="num">{pct(e5.epsilon_mean, 3)}</td><td>{e5.epsilon_mean < e3.epsilon_mean ? <span className="badge pass">yes</span> : <span className="badge fail">no</span>}</td></tr>;
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Callout tone="info">Published reference ({bs?.published.source}): d = 5 ε = {pct(bs?.published.distance_5_epsilon.value, 3)} ± {pct(bs?.published.distance_5_epsilon.uncertainty, 3)} vs d = 3 average {pct(bs?.published.distance_3_epsilon_average.value, 3)} ± {pct(bs?.published.distance_3_epsilon_average.uncertainty, 3)}. {bs?.published.note}</Callout>
                  {bs?.published_reproduction?.distance_5 && (
                    <Callout tone="hw"><b>Reproduced from the raw data:</b> applying our fit to Google's tensor-network predictions and averaging over patches and both bases gives d = 5 ε = <b>{pct(bs.published_reproduction.distance_5, 3)}</b> and d = 3 ε = <b>{pct(bs.published_reproduction.distance_3, 3)}</b> — matching the published values. {bs.published_reproduction.method}</Callout>
                  )}
                </Card>
              </div>
            </>
          )}

          {tab === "ising" && (!is ? <Card><Callout tone="warn">The exact Ising benchmark has not been recorded yet. Run <code>python -m backend.hardware.pipeline ising</code>.</Callout></Card> : (
            <>
              <Card title="Pooled over every Ising experiment (identical real shots)" icon={<ChartColumn />}
                sub={`${int(is.pooled.ising_noise_aware?.trials ?? 0)} shots from ${is.n} experiments · each bar counts failures on exactly the same shots · Wilson 95%`}>
                <BarList fmt={(v) => pct(v, 2)} labelWidth={230} bars={ISING_ORDER.filter((m) => is.pooled[m]).sort((a, b) => is.pooled[a].rate - is.pooled[b].rate).map((m) => {
                  const v = is.pooled[m];
                  return { label: methodLabel(m), value: v.rate, lo: v.ci95[0], hi: v.ci95[1], color: methodColor(m) };
                })} />
                <div className="field-help">The tensor-network decoder approximates maximum-likelihood decoding over logical classes, while our Ising decoder finds the single most likely error — the same distinction as Module 1's exact Bayes reference vs the energy decoder.</div>
              </Card>
              <Card title="Every method on identical real shots" sub="First 5,000 (d = 3) or 2,000 (d = 5) shots of each surface-code experiment with ≤ 5 rounds · click a row">
                <div className="table-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
                  <table className="data">
                    <thead><tr><th>Experiment</th><th className="num">Shots</th>{ISING_ORDER.map((m) => <th key={m} className="num" title={methodLabel(m)}>{methodLabel(m).replace("Google · ", "G·").replace("PyMatching", "PM")}</th>)}<th>vs PM (pij)</th></tr></thead>
                    <tbody>
                      {isRows.map((r) => {
                        const best = Math.min(...ISING_ORDER.filter((m) => !m.startsWith("google")).map((m) => r.methods[m]?.count ?? Infinity));
                        return (
                          <tr key={r.experiment} className={`clickable ${r.experiment === selIsing?.experiment ? "selected" : ""}`} onClick={() => setIsingExp(r.experiment)}>
                            <td className="num" style={{ whiteSpace: "nowrap" }}>{shortExp(r.experiment)}</td>
                            <td className="num">{int(r.shots)}</td>
                            {ISING_ORDER.map((m) => <td key={m} className="num" style={{ color: r.methods[m]?.count === best && !m.startsWith("google") ? "var(--green)" : undefined }}>{r.methods[m] ? r.methods[m].count : "—"}</td>)}
                            <td><VerdictBadge v={r.vs_pymatching_pij.verdict} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="field-help" style={{ marginTop: 8 }}>Cells are logical failures. Green = lowest among methods computed in this pipeline. Unsolved MILP shots would count as failures (none timed out unless shown in the solver status).</div>
              </Card>
              {selIsing && (
                <div className="grid g2">
                  <Card title={`Paired comparison · ${shortExp(selIsing.experiment)}`} sub={`${int(selIsing.shots)} identical shots · exact McNemar`}>
                    <BarList fmt={(v) => pct(v, 2)} bars={ISING_ORDER.filter((m) => selIsing.methods[m]).map((m) => ({
                      label: methodLabel(m), value: selIsing.methods[m].rate, lo: selIsing.methods[m].ci95[0], hi: selIsing.methods[m].ci95[1], color: methodColor(m),
                    }))} labelWidth={200} />
                    <div className="table-wrap" style={{ marginTop: 10 }}>
                      <table className="data">
                        <thead><tr><th>Comparison</th><th className="num">only A wrong</th><th className="num">only B wrong</th><th className="num">Δ rate [95% CI]</th><th className="num">p</th><th>Verdict</th></tr></thead>
                        <tbody>
                          {[["Ising (noise-aware) vs PM pij", selIsing.vs_pymatching_pij], ["Ising (noise-aware) vs PM circuit", selIsing.vs_pymatching_circuit], ["Ising (uniform) vs PM pij", selIsing.uniform_vs_pymatching_pij], ["noise-aware vs uniform", selIsing.noise_aware_vs_uniform]].map(([label, t]: any) => (
                            <tr key={label}><td>{label}</td><td className="num">{t.only_a_wrong}</td><td className="num">{t.only_b_wrong}</td>
                              <td className="num">{pct(t.difference, 2)} [{pct(t.ci95[0], 2)}, {pct(t.ci95[1], 2)}]</td><td className="num">{t.p_value < 1e-4 ? t.p_value.toExponential(1) : fix(t.p_value, 4)}</td><td><VerdictBadge v={t.verdict} /></td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="row" style={{ marginTop: 10 }}><a className="btn sm teal" href={href("/failures", { exp: selIsing.experiment, category: "ising_only_correct" })}>Shots only Ising got right</a><a className="btn sm" href={href("/failures", { exp: selIsing.experiment, category: "disagreement" })}>All disagreements</a></div>
                  </Card>
                  <Card title="Accuracy vs latency" icon={<Timer />} sub="Median per-shot decode time on this machine (log scale) · Google's internal decoders have no published timing">
                    <Scatter xLog points={ISING_ORDER.filter((m) => selIsing.methods[m]?.median_us || is.median_latency_us?.[m] || (agreeExp?.methods[m]?.per_shot_us)).map((m) => ({
                      id: m, x: selIsing.methods[m].median_us ?? agreeExp?.methods[m]?.per_shot_us, y: selIsing.methods[m].rate, ylo: selIsing.methods[m].ci95[0], yhi: selIsing.methods[m].ci95[1],
                      color: methodColor(m), label: <b>{methodLabel(m)}</b>,
                    })).filter((p) => p.x)} xLabel="decode time per shot (µs)" yLabel="logical failure" yFmt={(v) => pct(v, 1)} xFmt={(v) => (v >= 1000 ? `${v / 1000}ms` : `${v}µs`)} height={280} />
                    <div className="field-help">PyMatching batch timings exclude setup ({us(agreeExp?.methods?.pymatching_circuit?.setup_seconds * 1e6)} for the circuit DEM). MILP timings are single-shot solves with HiGHS.</div>
                  </Card>
                </div>
              )}
              {is.versus && Object.keys(is.versus).length > 0 && (
                <Card title="Noise-aware Ising/QUBO vs every other method" sub="Verdict counts over experiments (exact McNemar, p < 0.05, identical shots); net = failures of Ising minus failures of the other method, summed">
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>Compared with</th><th className="num">Ising fewer</th><th className="num">Ising more</th><th className="num">not resolved</th><th className="num">net failures</th></tr></thead>
                      <tbody>
                        {Object.entries(is.versus as Record<string, any>).sort((a, b) => a[1].net - b[1].net).map(([k, v]) => (
                          <tr key={k}><td>{methodLabel(k)}</td><td className="num" style={{ color: "var(--green)" }}>{v["fewer failures"]}</td><td className="num" style={{ color: v["more failures"] ? "var(--red)" : undefined }}>{v["more failures"]}</td>
                            <td className="num">{v["not resolved"]}</td><td className="num" style={{ color: v.net < 0 ? "var(--green)" : v.net > 0 ? "var(--red)" : undefined }}>{v.net > 0 ? "+" : ""}{v.net}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
              <Card title="Noise-aware vs uniform weights across experiments" sub="Difference in failure rate (noise-aware − uniform) with paired bootstrap 95% CI">
                <BarList fmt={(v) => pct(v, 2)} bars={isRows.map((r) => ({ label: shortExp(r.experiment), value: Math.abs(r.noise_aware_vs_uniform.difference), color: r.noise_aware_vs_uniform.difference < 0 ? "var(--green)" : "var(--red)", id: r.experiment }))}
                  onClick={(b) => setIsingExp(b.id!)} selected={selIsing?.experiment} labelWidth={170} />
                <div className="field-help">Bar length = |Δ|; green means noise-aware had fewer failures. Uniform weights ignore the experimentally estimated mechanism probabilities.</div>
              </Card>
            </>
          ))}

          {tab === "gap" && (!is ? <Card><Callout tone="warn">Run the Ising benchmark to enable the held-out ambiguity test.</Callout></Card> : (
            <div className="grid g2">
              <Card title="Does the complementary gap predict failures?" icon={<Gauge />} sub="Threshold chosen on EVEN shots (odd-calibrated model), tested on ODD shots (even-calibrated model)">
                <div className="table-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
                  <table className="data">
                    <thead><tr><th>Experiment</th><th className="num">AUROC val</th><th className="num">AUROC held-out</th><th className="num">Flagged fail</th><th className="num">Unflagged fail</th></tr></thead>
                    <tbody>
                      {is.gap.map((g: any) => (
                        <tr key={g.experiment} className={`clickable ${g.experiment === selIsing?.experiment ? "selected" : ""}`} onClick={() => setIsingExp(g.experiment)}>
                          <td className="num">{shortExp(g.experiment)}</td><td className="num">{fix(g.auroc_validation, 3)}</td><td className="num">{fix(g.auroc_held_out, 3)}</td>
                          <td className="num">{pct(g.held_out_flagged.rate, 1)}</td><td className="num">{pct(g.held_out_unflagged.rate, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              {gapRow && (
                <Card title={`Gap distribution · ${shortExp(gapRow.experiment)}`} sub={`threshold ${fix(gapRow.threshold, 2)} nats (10th percentile of validation gaps)`}>
                  {gapRow.histogram && <StackedHistogram edges={gapRow.histogram.edges} xLabel="complementary gap (nats)"
                    series={[{ label: "correct", color: "rgba(99,214,151,0.75)", counts: gapRow.histogram.correct }, { label: "logical failure", color: "rgba(244,124,128,0.9)", counts: gapRow.histogram.failed }]} />}
                  <div className="field-label" style={{ marginTop: 12 }}>Held-out failure rate by gap quintile</div>
                  <BarList fmt={(v) => pct(v, 1)} bars={(gapRow.quintiles ?? []).map((q: any, i: number) => ({ label: `Q${i + 1}: ${q.gap_range[0].toFixed(1)}–${q.gap_range[1].toFixed(1)}`, value: q.rate, lo: q.ci95[0], hi: q.ci95[1], color: i === 0 ? "var(--red)" : "var(--teal)" }))} labelWidth={150} />
                  <Callout tone="hw">Held-out flagged shots failed {pct(gapRow.held_out_flagged.rate, 1)} {ci(gapRow.held_out_flagged.ci95, 1)} vs {pct(gapRow.held_out_unflagged.rate, 1)} {ci(gapRow.held_out_unflagged.ci95, 1)} for the rest (AUROC {fix(gapRow.auroc_held_out, 3)}). The gap is an ambiguity indicator from one model; it is not a calibrated probability.</Callout>
                </Card>
              )}
            </div>
          ))}

          {tab === "agreement" && agreeExp && (
            <div className="grid g2">
              <Card title={`Decoder agreement · ${shortExp(agreeExp.experiment.id)}`} icon={<ChartColumn />} sub="Fraction of all shots on which two decoders predict the same observable flip">
                <Heatmap labels={Object.keys(agreeExp.agreement_matrix).map(methodLabel)} values={Object.keys(agreeExp.agreement_matrix).map((a) => Object.keys(agreeExp.agreement_matrix).map((b) => agreeExp.agreement_matrix[a][b]))} low={0.85} />
              </Card>
              <Card title="Timing (setup vs per-shot decoding)" icon={<Timer />} sub={expLabel(agreeExp.experiment.id)}>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Method</th><th className="num">setup</th><th className="num">per shot</th><th className="num">throughput</th></tr></thead>
                    <tbody>
                      {["pymatching_circuit", "pymatching_pij", "pymatching_correlated"].map((m) => (
                        <tr key={m}><td>{methodLabel(m)}</td><td className="num">{us(agreeExp.methods[m].setup_seconds * 1e6)}</td><td className="num">{us(agreeExp.methods[m].per_shot_us)}</td><td className="num">{int(1e6 / agreeExp.methods[m].per_shot_us)} shots/s</td></tr>
                      ))}
                      {is && selIsing && ["ising_noise_aware", "ising_uniform"].map((m) => selIsing.methods[m]?.median_us && (
                        <tr key={m}><td>{methodLabel(m)}</td><td className="num">model build</td><td className="num">{us(selIsing.methods[m].median_us)}</td><td className="num">{int(1e6 / selIsing.methods[m].median_us)} shots/s/core</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Callout tone="warn">Software timings on a laptop CPU; not comparable to real-time FPGA/ASIC decoders and not a hardware claim.</Callout>
              </Card>
            </div>
          )}
          <Tech title="Statistics and fitting">
            <Eq tex={String.raw`\text{Wilson: } \frac{\hat p + \frac{z^2}{2n} \pm z\sqrt{\frac{\hat p(1-\hat p)}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}},\qquad \text{McNemar: } b \sim \mathrm{Bin}(b + c, \tfrac12)`} />
            <Eq tex={String.raw`1 - 2P_L(r) = A\,(1 - 2\varepsilon)^r \;\Rightarrow\; \ln(1 - 2P_L) = \ln A + r\ln(1 - 2\varepsilon)\ \text{(weighted least squares)}`} />
            <p>b and c count shots where only one of the two decoders failed. Differences use a seeded paired multinomial bootstrap. The Ising benchmark decodes each shot exactly (HiGHS MILP, 10 s limit per solve) with the pij model of the complementary parity.</p>
          </Tech>
        </div>
      )}
    </div>
  );
}
