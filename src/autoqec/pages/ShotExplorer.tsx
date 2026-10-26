import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Dices, Layers3, Orbit, ScanSearch, TriangleAlert } from "lucide-react";
import { get, useApi } from "../lib/api";
import { useReducedMotion } from "../lib/hooks";
import { href, navigate, qNum, qStr } from "../lib/router";
import { expLabel, fix, int, sci } from "../lib/format";
import type { Geometry, ShotEvidence } from "../lib/types";
import { Sparkbars } from "../charts/charts";
import { Callout, Card, ErrorBox, Loading, PageHead, ProvenanceBadge, Seg, Toggle } from "../components/ui";
import { AnswerKey, DecoderVerdicts, ExperimentSelector, MechanismTable, useExperiments } from "../components/hardware";
import { Lattice2D } from "../components/Lattice2D";

const Lattice3D = lazy(() => import("../components/SpacetimeLattice").then((m) => ({ default: m.SpacetimeLattice3D })));

export default function ShotExplorer({ query }: { query: URLSearchParams }) {
  const exps = useExperiments();
  const [exp, setExp] = useState(qStr(query, "exp", "surface_code_bZ_d3_r05_center_3_5"));
  const [shot, setShot] = useState(qNum(query, "shot", 7));
  const [shotInput, setShotInput] = useState(String(qNum(query, "shot", 7)));
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [round, setRound] = useState<number | null>(null);
  const [show, setShow] = useState({ pm: true, ising: true, comp: false });
  const [finding, setFinding] = useState("");
  const reduced = useReducedMotion();
  useEffect(() => {
    if (query.get("exp")) setExp(query.get("exp") as string);
    if (query.get("shot")) { setShot(qNum(query, "shot", 7)); setShotInput(String(qNum(query, "shot", 7))); }
    if (query.get("overlay") === "both") setShow({ pm: true, ising: true, comp: true });
  }, [query]);
  const info = exps.data?.experiments.find((e) => e.id === exp);
  const maxShot = (info?.detection_shots_available ?? 1) - 1;
  const detail = useApi<{ geometry: Geometry }>(`/google/experiments/${exp}`);
  const ev = useApi<ShotEvidence>(`/google/experiments/${exp}/shots/${shot}`);
  const geo = detail.data?.geometry;
  const e = ev.data;
  const setShotSafe = (s: number) => {
    const v = Math.max(0, Math.min(maxShot, s));
    setShot(v);
    setShotInput(String(v));
    navigate("/shots", { exp, shot: v });
  };
  const jump = async (category: string) => {
    setFinding(category);
    try {
      const res = await get<{ rows: { shot: number }[] }>(`/google/experiments/${exp}/shots?category=${category}&limit=2000`);
      const pool = res.rows.map((r) => r.shot);
      if (!pool.length) setFinding(`none:${category}`);
      else {
        setShotSafe(pool[Math.floor(Math.random() * pool.length)]);
        setFinding("");
      }
    } catch {
      setFinding("error");
    }
  };
  const overlay = useMemo(() => ({
    pymatching: e?.decoders.pymatching_pij?.edges,
    ising: e?.decoders.ising_noise_aware?.mechanisms,
    complement: e?.ising.complement?.mechanisms,
  }), [e]);
  const na = e?.decoders.ising_noise_aware;
  const disagree = e ? new Set(Object.values(e.decoders).map((d) => d.prediction).filter((p) => p !== null)).size > 1 : false;

  return (
    <div className="fade-in">
      <PageHead module={2} kicker="Module 2 · Google Hardware Analyzer" title="Real Shot Explorer"
        lede="One genuine experimental shot from Google's processor: the detector events it produced in space and time, every decoder's prediction, and the evidence each decoder used — with the recorded logical outcome kept separate as the answer key."
        right={<><ProvenanceBadge kind="hardware" /><ProvenanceBadge kind="live" label="Decoded live" /></>} />
      <Card>
        <div className="col">
          {exps.data ? <ExperimentSelector value={exp} onChange={(id) => { setExp(id); setRound(null); navigate("/shots", { exp: id, shot: Math.min(shot, 1999) }); }} list={exps.data.experiments} /> : <Loading label="Loading experiments…" />}
          <div className="spread wrap">
            <div className="row wrap">
              <span className="field-label" style={{ margin: 0 }}>Shot</span>
              <button className="btn icon" onClick={() => setShotSafe(shot - 1)} aria-label="Previous shot"><ChevronLeft /></button>
              <input className="input mono" style={{ width: 96 }} value={shotInput} onChange={(x) => setShotInput(x.target.value.replace(/\D/g, ""))}
                onKeyDown={(x) => x.key === "Enter" && setShotSafe(Number(shotInput) || 0)} onBlur={() => setShotSafe(Number(shotInput) || 0)} aria-label="Shot index" />
              <button className="btn icon" onClick={() => setShotSafe(shot + 1)} aria-label="Next shot"><ChevronRight /></button>
              <span className="muted num" style={{ fontSize: 12 }}>of {int(maxShot + 1)} available{info && info.detection_shots_available < info.shots ? ` (subset of ${int(info.shots)})` : ""}</span>
            </div>
            <div className="row wrap">
              <span className="field-help">Jump to a random</span>
              <button className="btn sm" onClick={() => jump("disagreement")}><Dices />disagreement</button>
              <button className="btn sm" onClick={() => jump("pymatching_failed")}>PyMatching failure</button>
              <button className="btn sm" onClick={() => jump("ising_only_correct")}>Ising-only correct</button>
              <button className="btn sm" onClick={() => jump("all_failed")}>all decoders wrong</button>
            </div>
          </div>
          {finding.startsWith("none:") && <Callout tone="warn">No shots in this experiment's available range match “{finding.slice(5).replace("_", " ")}”. (Ising-only results exist for experiments in the recorded Ising benchmark.)</Callout>}
          {info && <div className="field-help">{expLabel(exp)} · {info.detectors} detectors · {info.physical_qubits} physical qubits · {int(info.shots)} shots recorded · DOI 10.5281/zenodo.6804040</div>}
        </div>
      </Card>
      {(ev.error || detail.error) && <Card className="mt"><ErrorBox message={ev.error || detail.error} onRetry={ev.reload} /></Card>}
      <div className="wide-right mt">
        <div className="col">
          <Card title={<><Orbit />Space-time detector lattice</>} sub={geo ? geo.note : ""}
            right={<Seg value={view} onChange={setView} options={[{ value: "3d", label: "3D" }, { value: "2d", label: "2D rounds" }]} />}>
            {!geo || !e ? <Loading label="Decoding this shot…" /> : (
              <div className="col">
                <div className="row wrap">
                  <Toggle on={show.pm} onChange={(v) => setShow({ ...show, pm: v })} label={<span><span style={{ color: "#3fd0b0" }}>━</span> PyMatching matched edges (pij)</span>} />
                  <Toggle on={show.ising} onChange={(v) => setShow({ ...show, ising: v })} label={<span><span style={{ color: "#c7b8ff" }}>━</span> Ising mechanisms</span>} />
                  <Toggle on={show.comp} onChange={(v) => setShow({ ...show, comp: v })} label={<span><span style={{ color: "#f47c80" }}>┅</span> best opposite-outcome explanation</span>} />
                </div>
                {view === "3d" ? (
                  <Suspense fallback={<Loading label="Starting the 3D view…" />}>
                    <Lattice3D geo={geo} fired={e.measured.detection_events} overlay={overlay} round={round} show={show} reduced={reduced} />
                  </Suspense>
                ) : (
                  <Lattice2D geo={geo} fired={e.measured.detection_events} round={round} onRound={setRound} overlay={overlay} show={show} />
                )}
                <div className="col" style={{ gap: 4 }}>
                  <div className="spread"><span className="field-label">Detection events per round (click to isolate a round)</span>
                    {round !== null && <button className="btn sm ghost" onClick={() => setRound(null)}>show all rounds</button>}</div>
                  <div role="group" aria-label="Rounds" style={{ display: "grid", gridTemplateColumns: `repeat(${e.measured.events_per_round.length}, 1fr)`, gap: 2 }}>
                    {e.measured.events_per_round.map((n, t) => (
                      <button key={t} onClick={() => setRound(round === t ? null : t)} title={`round ${t}: ${n} events`} aria-label={`Round ${t}, ${n} events`}
                        style={{ height: 6, borderRadius: 3, background: round === t ? "var(--cyan)" : "#1f2c48" }} />
                    ))}
                  </div>
                  <Sparkbars values={e.measured.events_per_round} highlight={round ?? undefined} color="var(--violet)" />
                </div>
                <div className="legend">
                  <span><i style={{ background: "#a58bff" }} />Z-type detector fired</span>
                  <span><i style={{ background: "#f3b867" }} />X-type detector fired</span>
                  <span><i style={{ background: "#5a6b8f" }} />quiet detector</span>
                  <span><i style={{ background: "#5ad8ef" }} />data qubit (layout plate)</span>
                </div>
              </div>
            )}
          </Card>
          {e && na?.mechanisms && (
            <div className="grid g2">
              <Card title="What the Ising decoder inferred" sub={`${na.mechanisms.length} fault mechanism(s) · total weight ${fix(na.objective, 2)} nats · ${na.status}`}>
                <MechanismTable rows={na.mechanisms} label="mechanisms" />
              </Card>
              <Card title="What PyMatching matched" sub={`${e.decoders.pymatching_pij?.edges?.length ?? 0} edge(s) · model ${e.decoders.pymatching_pij?.dem}`}>
                <MechanismTable rows={(e.decoders.pymatching_pij?.edges ?? []).map((x) => ({ ...x, hyperedge: false }))} label="matched edges" />
              </Card>
            </div>
          )}
        </div>
        <div className="col">
          {!e ? <Card><Loading label="Running the decoders on this shot…" /></Card> : (
            <>
              <AnswerKey ev={e} />
              <div className="row wrap">
                <span className="chip">{e.measured.detection_events.length} of {e.measured.detector_count} detectors fired</span>
                {disagree ? <span className="badge warn"><TriangleAlert />decoders disagree</span> : <span className="badge neutral">decoders agree</span>}
                <a className="btn sm" href={href("/failures", { exp })}><ScanSearch />Investigate this experiment</a>
              </div>
              <Card title="Predictions vs the answer key"><DecoderVerdicts ev={e} /></Card>
              <Card title="Ambiguity of the Ising decision" icon={<Layers3 />}>
                {e.ising.tractable ? (
                  <div className="col">
                    <div className="kv">
                      <dt>model</dt><dd>{e.ising.dem} ({int(e.ising.mechanisms)} mechanisms; {e.partition} shot → complementary partition)</dd>
                      <dt>best solution</dt><dd>{na?.mechanisms?.length ?? "—"} mechanisms, E = {fix(na?.objective, 3)}</dd>
                      <dt>best opposite outcome</dt><dd>{e.ising.complement ? `${e.ising.complement.mechanisms.length} mechanisms, E = ${fix(e.ising.complement.objective, 3)}` : "—"}</dd>
                      <dt>complementary gap</dt><dd>{fix(e.ising.gap, 3)} nats</dd>
                      <dt>single-explanation ratio</dt><dd>{e.ising.relative_likelihood !== undefined ? sci(e.ising.relative_likelihood, 2) : "—"}</dd>
                      {e.ising.recorded && <><dt>benchmark record</dt><dd>predicted {e.ising.recorded.noise_aware_prediction ? "flip" : "no flip"} ({e.ising.recorded.noise_aware_status})</dd></>}
                    </div>
                    <div className="field-help">A small gap means a nearly-as-likely explanation implies the opposite logical outcome — a model-based warning, not a calibrated probability. Its predictive value is tested on held-out shots in Decoder Benchmarks.</div>
                  </div>
                ) : <Callout tone="warn">{e.ising.reason ?? "Exact Ising decoding is not tractable live for this experiment."}</Callout>}
              </Card>
              <Card title="Explanation" sub="Assembled from the decoders' outputs">
                <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", lineHeight: 1.6, fontSize: 13 }}>
                  {e.narrative.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </Card>
              <Callout tone="hw">{e.language_note}</Callout>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
