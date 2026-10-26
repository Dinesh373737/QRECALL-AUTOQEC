import { useMemo, useState } from "react";
import { CircleCheck, Download, FileSpreadsheet, Play, Timer } from "lucide-react";
import { downloadJson, useApi, useJob } from "../lib/api";
import { ci, fix, int, methodColor, methodLabel, pct, us } from "../lib/format";
import { BarList, LineChart, Reliability, StackedHistogram } from "../charts/charts";
import type { Series } from "../charts/charts";
import { Callout, Card, ErrorBox, Field, JobProgress, Loading, Metric, PageHead, ProvenanceBadge, Seg, Tech, Toggle } from "../components/ui";

const DECODERS = ["unprotected", "lookup", "energy", "exact"];

function sweepSeries(points: any[], xKey: (pt: any) => number, filter: (pt: any) => boolean = () => true): Series[] {
  return DECODERS.map((d) => ({
    id: d,
    label: methodLabel(d),
    color: methodColor(d),
    dashed: d === "unprotected",
    points: points.filter(filter).map((pt) => {
      const r = pt.results[d];
      return { x: xKey(pt), y: Math.max(r.rate, 1e-6), lo: Math.max(r.ci95[0], 1e-6), hi: Math.max(r.ci95[1], 1e-6) };
    }),
  }));
}

export default function SimBenchmarks() {
  const recorded = useApi<any>("/qec/benchmarks/recorded");
  const job = useJob<any>();
  const [useRun, setUseRun] = useState(false);
  const data = useRun && job.result ? job.result : recorded.data;
  const [distance, setDistance] = useState(3);
  const [withReadout, setWithReadout] = useState(false);
  const [shots, setShots] = useState(20000);
  const [seed, setSeed] = useState(20261026);
  const lvp = withReadout ? data?.logical_vs_p_readout : data?.logical_vs_p;
  const series = useMemo(() => (lvp ? sweepSeries(lvp.points, (pt) => pt.p, (pt) => pt.distance === distance) : []), [lvp, distance]);
  const readout = useMemo(() => (data ? sweepSeries(data.readout_sweep.points, (pt) => pt.q) : []), [data]);
  const asym = useMemo(() => (data ? sweepSeries(data.asymmetric_sweep.points, (pt) => pt.bad_qubit_p) : []), [data]);
  const ms = data?.margin_study;
  const mm = data?.margin_study_mismatched;

  return (
    <div className="fade-in">
      <PageHead kicker="Module 1 · Interactive Studio" title="Simulation Benchmarks"
        lede="Seeded, reproducible simulations that test the decoders and — separately — whether the explanation indicators actually predict failures on held-out trials. Everything here is simulated; Module 2 holds the real-hardware evidence."
        right={<>
          <ProvenanceBadge kind="simulation" />
          {useRun && job.result ? <ProvenanceBadge kind="live" label="Fresh run" /> : <ProvenanceBadge kind="recorded" />}
          <a className="btn sm" href="/api/qec/benchmarks/recorded/csv"><FileSpreadsheet />CSV</a>
          <button className="btn sm" disabled={!data} onClick={() => downloadJson("autoqec-simulation-benchmark.json", data)}><Download />JSON</button>
        </>} />
      {recorded.error && !data && <Card><ErrorBox message={recorded.error} onRetry={recorded.reload} /></Card>}
      {!data && !recorded.error && <Card><Loading label="Loading recorded benchmark…" /></Card>}
      {data && (
        <div className="col gap-lg">
          <div className="grid g5">
            <Metric label="Shots per point" value={int(data.config.shots)} hint={`base seed ${data.config.seed}`} />
            <Metric tone={data.reproducibility.identical ? "green" : "red"} label="Reproducibility" value={data.reproducibility.identical ? "Identical" : "Mismatch"} hint={`digest ${data.reproducibility.first_digest} twice from the same seed`} />
            <Metric tone={data.agreement.all_tables_match_reference ? "green" : "red"} label="Oracle agreement" value={data.agreement.all_tables_match_reference ? "Exact" : "Mismatch"} hint={`max |E + ln P| = ${data.agreement.max_abs_energy_minus_neg_log_joint.toExponential(1)}`} />
            <Metric tone="cyan" label="Gap AUROC (held-out)" value={fix(ms.auroc_gap_held_out, 3)} hint={`logical margin: ${fix(ms.auroc_logical_margin_held_out, 3)}`} tip="Probability that a failed trial has a smaller energy gap than a successful one (0.5 = no signal)." />
            <Metric tone="violet" label="Calibration error (ECE)" value={fix(ms.calibration.ece, 4)} hint={`mismatched model: ${fix(mm.calibration.ece, 4)}`} />
          </div>

          <Card title="Logical failure vs physical error rate" sub="Failure = logical bit flipped after an ideal final round · bands are 95% Wilson intervals"
            right={<div className="row wrap"><Seg value={distance} onChange={setDistance} options={[3, 5, 7].map((d) => ({ value: d, label: `d = ${d}` }))} /><Toggle on={withReadout} onChange={setWithReadout} label={`readout noise q = ${data.config.q}`} /></div>}>
            <LineChart series={series} xLog yLog xLabel="data-flip probability p" yLabel="logical failure rate" xFmt={(v) => String(+v.toPrecision(2))} yFmt={(v) => pct(v, v >= 0.01 ? 0 : v >= 0.001 ? 1 : 2)} height={330} />
            <div className="field-help">Below threshold the repetition code suppresses errors (≈3p² for d = 3); higher distance suppresses faster. {withReadout
              ? "With readout noise the lookup decoder trusts corrupted syndromes and degrades first."
              : "With a perfect syndrome the lookup, energy and exact decoders choose identical corrections, so their curves coincide (toggle readout noise to separate them)."}</div>
          </Card>

          <div className="grid g2">
            <Card title="Readout-error robustness" sub={`d = 3, p = ${data.config.p}`}>
              <LineChart series={readout} xLabel="syndrome readout error q" yLabel="logical failure" yFmt={(v) => pct(v, 1)} height={260} />
            </Card>
            <Card title="Asymmetric noise: one bad qubit" sub={`d = 3, other qubits p = ${data.config.p}, q = ${data.config.q}`}>
              <LineChart series={asym} xLabel="error probability of qubit d0" yLabel="logical failure" yFmt={(v) => pct(v, 1)} height={260} />
            </Card>
          </div>

          <Card title="Do energy gaps predict failures? — held-out test" sub={`${int(ms.shots_each)} validation + ${int(ms.shots_each)} held-out trials, each with its own calibrated noise parameters`}
            right={<span className="badge sim">threshold frozen before testing</span>}>
            <div className="grid g2">
              <div className="col">
                <StackedHistogram edges={ms.held_out_histogram.edges} xLabel="energy gap ΔE (nats), held-out trials"
                  series={[{ label: "recovered", color: "rgba(99,214,151,0.75)", counts: ms.held_out_histogram.correct }, { label: "logical failure", color: "rgba(244,124,128,0.9)", counts: ms.held_out_histogram.failed }]} />
              </div>
              <div className="col">
                <div className="field-label">Held-out failure rate by gap quintile</div>
                <BarList fmt={(v) => pct(v, 1)} bars={ms.held_out_by_gap_quintile.map((b: any, i: number) => ({
                  label: `Q${i + 1}: ΔE ${b.gap_range[0].toFixed(2)}–${b.gap_range[1].toFixed(2)}`, value: b.rate, lo: b.ci95[0], hi: b.ci95[1], color: i === 0 ? "var(--red)" : "var(--cyan)",
                }))} labelWidth={180} />
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Set</th><th>Flagged (ΔE ≤ {fix(ms.threshold, 2)})</th><th>Not flagged</th></tr></thead>
                    <tbody>
                      <tr><td>Validation (threshold chosen)</td><td className="num">{pct(ms.validation_flagged.rate, 1)} of {int(ms.validation_flagged.trials)}</td><td className="num">{pct(ms.validation_unflagged.rate, 1)} of {int(ms.validation_unflagged.trials)}</td></tr>
                      <tr><td><b>Held-out (tested)</b></td><td className="num">{pct(ms.held_out_flagged.rate, 1)} {ci(ms.held_out_flagged.ci95, 1)}</td><td className="num">{pct(ms.held_out_unflagged.rate, 1)} {ci(ms.held_out_unflagged.ci95, 1)}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <Callout tone="info">
              Rule: <b>{ms.threshold_rule}</b> (seed {ms.validation_seed}); evaluated once on seed {ms.held_out_seed}. On held-out trials, flagged decisions fail{" "}
              <b>{fix(ms.held_out_flagged.rate / ms.held_out_unflagged.rate, 1)}×</b> as often as unflagged ones and the gap separates failures with AUROC {fix(ms.auroc_gap_held_out, 3)}.
              Under a mismatched model (decoder assumes p = 0.05, q = 0.02) the AUROC drops to {fix(mm.auroc_gap_held_out, 3)}: the indicator is only as good as the model.
            </Callout>
          </Card>

          <div className="grid g2">
            <Card title="Is the model posterior calibrated?" sub="Reliability diagram on held-out trials (MAP correction)">
              <Reliability series={[
                { label: `calibrated model (ECE ${fix(ms.calibration.ece, 4)})`, color: "#5ad8ef", bins: ms.calibration.bins },
                { label: `mismatched model (ECE ${fix(mm.calibration.ece, 4)})`, color: "#f3b867", bins: mm.calibration.bins },
              ]} />
              <div className="field-help">Mathematically justified only when the model matches the noise; the mismatched curve shows over/under-confidence.</div>
            </Card>
            <Card title="Energy decoder vs exact reference" sub="Vectorized decision tables checked against the pure-Python enumeration">
              <div className="table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
                <table className="data">
                  <thead><tr><th>d</th><th>p</th><th>q</th><th className="num">table≠oracle</th><th className="num">MAP≠Bayes</th></tr></thead>
                  <tbody>
                    {data.agreement.configs.map((c: any, i: number) => (
                      <tr key={i}>
                        <td className="num">{c.distance}</td>
                        <td className="num" style={{ fontSize: 11 }}>{c.p.map((v: number) => v.toFixed(2)).join(" ")}</td>
                        <td className="num" style={{ fontSize: 11 }}>{c.q.map((v: number) => v.toFixed(2)).join(" ")}</td>
                        <td className="num" style={{ color: c.vectorized_vs_reference_mismatches ? "var(--red)" : "var(--green)" }}>{c.vectorized_vs_reference_mismatches}</td>
                        <td className="num">{c.energy_vs_bayes_different_corrections}/{c.syndromes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="field-help" style={{ marginTop: 8 }}>{data.agreement.note}</div>
            </Card>
          </div>

          <div className="grid g2">
            <Card title="Decoder runtime" icon={<Timer />} sub="Single decode in Python (d = 3), 400 repetitions on this machine">
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Decoder</th><th className="num">median</th><th className="num">p95</th></tr></thead>
                  <tbody>
                    {["none", "lookup", "energy", "exact"].map((k) => (
                      <tr key={k}><td>{methodLabel(k)}</td><td className="num">{us(data.runtime[k].median_us)}</td><td className="num">{us(data.runtime[k].p95_us)}</td></tr>
                    ))}
                    <tr><td>Vectorized table lookup</td><td className="num" colSpan={2}>{int(data.runtime.vectorized_batch.shots)} shots in {fix(data.runtime.vectorized_batch.seconds, 3)} s</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="field-help">The energy decoder's cost here is dominated by building the full explanation payload, not by the 8-candidate search.</div>
            </Card>
            <Card title="Run the benchmark again" icon={<Play />} sub="Fresh seeded run in the backend (a few seconds)">
              <div className="col">
                <Field label="Shots per point"><Seg full value={shots} onChange={setShots} options={[{ value: 5000, label: "5k" }, { value: 20000, label: "20k" }, { value: 100000, label: "100k" }]} /></Field>
                <Field label="Seed"><input className="input mono" type="number" value={seed} onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))} /></Field>
                <button className="btn violet" disabled={job.running} onClick={() => { setUseRun(true); job.start("/qec/benchmarks/run", { shots, seed, p: 0.05, q: 0.02 }); }}><Play />Run</button>
                <JobProgress job={job.job} error={job.error} onCancel={job.cancel} />
                {job.result && <div className="row"><CircleCheck style={{ color: "var(--green)", width: 15 }} /><span className="field-help">Showing the fresh run ({fix(job.result.duration_seconds, 1)} s). <button className="btn sm ghost" onClick={() => setUseRun(false)}>Back to recorded</button> {job.job && <a className="btn sm" href={`/api/qec/benchmarks/jobs/${job.job.id}/csv`}>CSV</a>}</span></div>}
              </div>
            </Card>
          </div>
          <Tech title="Methodology">
            <p>Each point samples independent X flips (probability p per data qubit) and syndrome readout flips (q per check) from separate seeded streams. Decoders see only the observed syndrome and the declared model. A logical failure is a residual with weight above (d−1)/2 after an ideal final round. Intervals are Wilson 95%.</p>
            <p>The held-out study draws per-trial parameters p_i ~ U(0.005, 0.2), q_j ~ U(0, 0.15) (known to a calibrated decoder) so that gaps vary; the threshold flags the lowest 10% of validation gaps and is frozen before the held-out seed is evaluated.</p>
          </Tech>
        </div>
      )}
    </div>
  );
}
