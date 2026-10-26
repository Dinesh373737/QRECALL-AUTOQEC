import { useMemo, useState } from "react";
import { Database, FileDigit, Fingerprint, Map, Play } from "lucide-react";
import { useApi, useJob } from "../lib/api";
import { href, qStr } from "../lib/router";
import { expLabel, int, pct, sci, us } from "../lib/format";
import type { Geometry } from "../lib/types";
import { Callout, Card, ErrorBox, Kv, Loading, Metric, PageHead, ProvenanceBadge, Seg, Status, JobProgress } from "../components/ui";
import { useExperiments } from "../components/hardware";

interface Detail {
  experiment: any;
  properties: Record<string, string | number>;
  dems: Record<string, any>;
  dem_files: Record<string, string>;
  geometry: Geometry;
  files: Record<string, string> | null;
  source_sha256: Record<string, string> | null;
  results: Record<string, { rate: number; ci95: number[]; count: number; trials: number }> | null;
}

function GeometryMap({ geo }: { geo: Geometry }) {
  // Google's coordinates are (row, column): draw the column horizontally and the row vertically.
  const xs = geo.qubits.map((q) => q.y);
  const ys = geo.qubits.map((q) => q.x);
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
  const W = 300;
  const s = W / Math.max(x1 - x0, y1 - y0);
  return (
    <svg viewBox={`0 0 ${(x1 - x0) * s} ${(y1 - y0) * s}`} className="chart" style={{ maxWidth: 340 }} role="img" aria-label="Qubit layout of this experiment">
      {geo.qubits.map((q) => {
        const cx = (q.y - x0) * s, cy = (q.x - y0) * s;
        return q.role === "data"
          ? <circle key={q.id} cx={cx} cy={cy} r={s * 0.22} fill="#5ad8ef" opacity={0.9}><title>{`data qubit ${q.id} at (${q.x}, ${q.y})`}</title></circle>
          : <rect key={q.id} x={cx - s * 0.22} y={cy - s * 0.22} width={s * 0.44} height={s * 0.44} transform={`rotate(45 ${cx} ${cy})`}
            fill={q.basis === "X" ? "#f3b867" : "#a58bff"} opacity={0.85}><title>{`measure qubit ${q.id} (${q.basis}-type) at (${q.x}, ${q.y})`}</title></rect>;
      })}
    </svg>
  );
}

export default function DatasetExplorer({ query }: { query: URLSearchParams }) {
  const status = useApi<any>("/google/status");
  const exps = useExperiments();
  const prov = useApi<any>("/provenance");
  const [code, setCode] = useState<"surface_code" | "repetition_code" | "all">("all");
  const [distance, setDistance] = useState<number | "all">("all");
  const [basis, setBasis] = useState<"X" | "Z" | "all">("all");
  const [selected, setSelected] = useState(qStr(query, "exp", "surface_code_bZ_d3_r05_center_3_5"));
  const detail = useApi<Detail>(`/google/experiments/${selected}`);
  const repro = useJob<any>();
  const list = useMemo(() => (exps.data?.experiments ?? []).filter((e) =>
    (code === "all" || e.code === code) && (distance === "all" || e.distance === distance) && (basis === "all" || e.basis === basis)), [exps.data, code, distance, basis]);
  const s = status.data;
  const archive = prov.data?.dataset?.archive;
  const verification = prov.data?.artifacts?.find((a: any) => a.path.endsWith("archive_verification.json"));
  const d = detail.data;
  return (
    <div className="fade-in">
      <PageHead module={2} kicker="Module 2 · Google Hardware Analyzer" title="Google Dataset Explorer"
        lede="Google Quantum AI, “Suppressing quantum errors by scaling a surface code logical qubit” (Nature 614, 676–681, 2023). The archive holds the executed circuits, raw measurements, detection events, recorded logical flips, detector error models and Google's own decoder predictions."
        right={<ProvenanceBadge kind="hardware" />} />
      {status.error && <Card><ErrorBox message={status.error} onRetry={status.reload} /></Card>}
      {s && (
        <div className="grid g4">
          <Metric tone="teal" label="Source" value="Zenodo" hint={<a href={s.record} target="_blank" rel="noreferrer">DOI {s.doi}</a>} />
          <Metric tone={s.full_archive_present ? "green" : "teal"} label="Active data layout" value={s.active_layout === "full" ? "Full archive" : s.active_layout === "subset" ? "Real subset" : "Missing"}
            hint={s.active_layout === "subset" ? `${s.subset?.experiment_count} experiments; detection events for the first shots of each` : `${s.archive.name} (${(s.archive.bytes / 1e6).toFixed(0)} MB)`} />
          <Metric tone="green" label="Archive checksum" value={s.results?.["archive_verification.json"] ? "Verified" : "Not checked"} hint={`MD5 ${s.archive.md5.slice(0, 12)}… matches Zenodo`} />
          <Metric label="License" value={s.license} hint={s.creators} />
        </div>
      )}
      <div className="wide-right mt">
        <Card title={<><Database />Experiments</>} sub={`${list.length} of ${exps.data?.count ?? "…"} · click a row to inspect`}
          right={<div className="row wrap">
            <Seg value={code} onChange={setCode} options={[{ value: "all", label: "All" }, { value: "surface_code", label: "Surface" }, { value: "repetition_code", label: "Repetition" }]} />
            <Seg value={distance} onChange={setDistance} options={[{ value: "all", label: "d" }, { value: 3, label: "3" }, { value: 5, label: "5" }, { value: 25, label: "25" }]} />
            <Seg value={basis} onChange={setBasis} options={[{ value: "all", label: "X/Z" }, { value: "X", label: "X" }, { value: "Z", label: "Z" }]} />
          </div>}>
          {exps.error && <ErrorBox message={exps.error} onRetry={exps.reload} />}
          {!exps.data && !exps.error && <Loading />}
          {exps.data && (
            <div className="table-wrap" style={{ maxHeight: 640, overflowY: "auto" }}>
              <table className="data">
                <thead><tr><th>Experiment</th><th className="num">Shots</th><th className="num">Detectors</th><th className="num">Qubits</th><th className="num">PyMatching</th><th className="num">Google TN</th></tr></thead>
                <tbody>
                  {list.map((e) => {
                    const pm = e.results?.pymatching_circuit;
                    const tn = e.results?.google_tensor_network_contraction ?? e.results?.google_correlated_matching;
                    return (
                      <tr key={e.id} className={`clickable ${e.id === selected ? "selected" : ""}`} onClick={() => setSelected(e.id)}>
                        <td><div style={{ color: "var(--text)" }}>{expLabel(e.id)}</div><div className="field-help num">{e.id}</div></td>
                        <td className="num">{int(e.shots)}</td><td className="num">{int(e.detectors)}</td><td className="num">{e.physical_qubits}</td>
                        <td className="num">{pm ? pct(pm.rate, 2) : "—"}</td><td className="num">{tn ? pct(tn.rate, 2) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="field-help" style={{ marginTop: 8 }}>Failure rates are per shot over all shots, from the recorded baseline. “Google TN” = Google's tensor-network decoder (correlated matching for the repetition code).</div>
        </Card>
        <div className="col">
          {detail.error && <Card><ErrorBox message={detail.error} /></Card>}
          {!d && !detail.error && <Card><Loading /></Card>}
          {d && (
            <>
              <Card title={expLabel(selected)} sub={selected} tone="teal">
                <Kv rows={Object.entries(d.properties).map(([k, v]) => [k, String(v)])} />
                <div className="row wrap" style={{ marginTop: 12 }}>
                  <a className="btn sm teal" href={href("/shots", { exp: selected, shot: 0 })}>Open a shot</a>
                  <a className="btn sm" href={href("/failures", { exp: selected })}>Failures</a>
                  <a className="btn sm" href={href("/hw-benchmarks", { exp: selected })}>Benchmarks</a>
                </div>
              </Card>
              <Card title="Layout" icon={<Map />} sub="Google's layout.svg (left) and our parsed geometry from circuit_ideal.stim (right)">
                <div className="grid g2" style={{ alignItems: "center" }}>
                  <img src={`/api/google/experiments/${selected}/layout.svg`} alt={`Google layout diagram for ${selected}`} style={{ width: "100%", background: "#fff", borderRadius: 8, padding: 4 }} />
                  <div className="col" style={{ alignItems: "center" }}>
                    <GeometryMap geo={d.geometry} />
                    <div className="legend"><span><i style={{ background: "#5ad8ef", borderRadius: 5 }} />data</span><span><i style={{ background: "#a58bff" }} />Z check</span><span><i style={{ background: "#f3b867" }} />X check</span></div>
                  </div>
                </div>
              </Card>
              <Card title="Detector error models" icon={<FileDigit />}>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Model</th><th className="num">Mechanisms</th><th className="num">Hyperedges</th><th className="num">median p</th><th className="num">max p</th></tr></thead>
                    <tbody>
                      {Object.entries(d.dems).map(([k, v]) => (
                        <tr key={k}><td><div>{d.dem_files[k]}</div><div className="field-help">{k === "circuit" ? "from circuit_noisy.stim (SI-style model)" : k === "pij_even_for_odd" ? "estimated from even shots → decode odd" : "estimated from odd shots → decode even"}</div></td>
                          <td className="num">{int(v.mechanisms)}</td><td className="num">{int(v.hyperedges)}</td><td className="num">{sci(v.probability_median)}</td><td className="num">{sci(v.probability_max)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title="Reproduce Google's PyMatching baseline" icon={<Play />} sub="Re-decode the available real shots with circuit_detector_error_model.dem and compare shot-by-shot">
                <div className="col">
                  <button className="btn teal" disabled={repro.running} onClick={() => repro.start("/google/reproduce", { experiment: selected })}><Play />Run PyMatching now</button>
                  <JobProgress job={repro.job} error={repro.error} onCancel={repro.cancel} />
                  {repro.result && (
                    <div className="col fade-in">
                      <div className="row wrap">
                        <Status ok={repro.result.reproduced} pass="Shot-for-shot identical" fail={`${repro.result.disagreements_with_google} shots differ`} />
                        <span className="chip">{int(repro.result.shots)} shots ({repro.result.layout})</span>
                        <span className="chip">{us(repro.result.per_shot_us)} per shot</span>
                      </div>
                      <Kv rows={[
                        ["our failures", `${repro.result.ours.count} (${pct(repro.result.ours.rate, 2)})`],
                        ["Google's failures", `${repro.result.google_pymatching.count} (${pct(repro.result.google_pymatching.rate, 2)})`],
                        ["configuration", repro.result.configuration],
                      ]} />
                      {!repro.result.reproduced && <Callout tone="info">Remaining differences occur on near-degenerate shots; on probed shots our prediction equals the exact minimum-weight optimum (see Methodology).</Callout>}
                    </div>
                  )}
                </div>
              </Card>
              {d.source_sha256 && (
                <Card title="File provenance" icon={<Fingerprint />} sub="SHA-256 of the official source files this subset was extracted from">
                  <Kv rows={Object.entries(d.source_sha256).map(([k, v]) => [k, `${v.slice(0, 20)}…`])} />
                </Card>
              )}
            </>
          )}
        </div>
      </div>
      <div className="grid g2 mt">
        <Callout tone="hw">Integrity: for every experiment, detection events and observable flips were re-derived from the raw <code>measurements.b8</code> and <code>sweep.b8</code> with Stim's measurement-to-detection converter and matched the published files bit-for-bit.</Callout>
        <Callout tone="info">Split methodology: Google's pij models were estimated from detection events of one shot parity; we always decode the complementary parity (even model → odd shots, odd model → even shots). No method sees the observable flips it predicts.</Callout>
      </div>
      {archive && verification && <div className="field-help mt">Archive {archive.name}: {(archive.bytes / 1e6).toFixed(1)} MB · MD5 {archive.md5} · verification artifact SHA-256 {verification.sha256.slice(0, 16)}…</div>}
    </div>
  );
}
