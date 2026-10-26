import { useEffect, useState } from "react";
import { Orbit, ScanSearch } from "lucide-react";
import { useApi } from "../lib/api";
import { href, navigate, qStr } from "../lib/router";
import { expLabel, int, methodColor, methodLabel } from "../lib/format";
import type { Geometry, ShotEvidence } from "../lib/types";
import { BarList } from "../charts/charts";
import { Callout, Card, ErrorBox, Loading, PageHead, ProvenanceBadge, Tabs } from "../components/ui";
import { AnswerKey, DecoderVerdicts, ExperimentSelector, useExperiments } from "../components/hardware";
import { Lattice2D } from "../components/Lattice2D";

interface ShotList {
  experiment: string;
  category: string;
  shots_considered: number;
  matches: number;
  counts: Record<string, number | null>;
  methods: string[];
  rows: { shot: number; actual: boolean; wrong: string[] }[];
  failure_counts: Record<string, number>;
  failure_counts_shots: number;
  note: string;
}

const CATEGORIES = [
  { value: "disagreement", label: "Decoders disagree" },
  { value: "pymatching_failed", label: "PyMatching failed" },
  { value: "ising_only_correct", label: "Only Ising correct" },
  { value: "confident_ising_failure", label: "Confident Ising failures" },
  { value: "all_failed", label: "Every decoder failed" },
  { value: "any_failed", label: "Any failure" },
];

export default function FailureInvestigator({ query }: { query: URLSearchParams }) {
  const exps = useExperiments();
  const [exp, setExp] = useState(qStr(query, "exp", "surface_code_bZ_d3_r05_center_3_5"));
  const [category, setCategory] = useState(qStr(query, "category", "disagreement"));
  const [shot, setShot] = useState<number | null>(null);
  useEffect(() => {
    if (query.get("exp")) setExp(query.get("exp") as string);
    if (query.get("category")) setCategory(query.get("category") as string);
  }, [query]);
  const list = useApi<ShotList>(`/google/experiments/${exp}/shots?category=${category}&limit=300`);
  const detail = useApi<{ geometry: Geometry }>(`/google/experiments/${exp}`);
  const ev = useApi<ShotEvidence>(shot === null ? null : `/google/experiments/${exp}/shots/${shot}`);
  useEffect(() => setShot(null), [exp, category]);
  useEffect(() => {
    if (shot === null && list.data?.rows.length) setShot(list.data.rows[0].shot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);
  const counts = list.data?.counts ?? {};
  const fc = list.data?.failure_counts ?? {};
  return (
    <div className="fade-in">
      <PageHead module={2} kicker="Module 2 · Google Hardware Analyzer" title="Failure Investigator"
        lede="Drill from aggregate numbers into individual real shots: where decoders disagree, where every decoder failed, and where a decoder was confidently wrong. Each shot opens with the evidence each decoder actually used."
        right={<ProvenanceBadge kind="hardware" />} />
      <Card>
        {exps.data ? <ExperimentSelector value={exp} onChange={(id) => { setExp(id); navigate("/failures", { exp: id, category }); }} list={exps.data.experiments} /> : <Loading />}
      </Card>
      <div className="mt">
        <Tabs value={category} onChange={(c) => { setCategory(c); navigate("/failures", { exp, category: c }); }}
          tabs={CATEGORIES.map((c) => ({ ...c, count: counts[c.value] === null || counts[c.value] === undefined ? "—" : int(counts[c.value] as number) }))} />
      </div>
      {list.error && <Card><ErrorBox message={list.error} onRetry={list.reload} /></Card>}
      <div className="two-pane">
        <div className="col sticky">
          <Card title={<><ScanSearch />Matching shots</>} sub={list.data ? `${int(list.data.matches)} of ${int(list.data.shots_considered)} available shots · showing up to 300` : ""}>
            {!list.data ? <Loading /> : list.data.rows.length === 0 ? (
              <Callout tone="info">{category === "ising_only_correct" || category === "confident_ising_failure" ? "Ising predictions exist only for experiments in the recorded Ising benchmark (surface code, ≤ 5 rounds)." : "No shots in this category."}</Callout>
            ) : (
              <div className="col" style={{ gap: 4, maxHeight: 560, overflowY: "auto" }}>
                {list.data.rows.map((r) => (
                  <button key={r.shot} onClick={() => setShot(r.shot)}
                    style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 9px", borderRadius: 8, textAlign: "left",
                      border: `1px solid ${shot === r.shot ? "var(--cyan)" : "var(--line)"}`, background: shot === r.shot ? "var(--cyan-dim)" : "rgba(4,8,15,0.35)" }}>
                    <span className="num" style={{ width: 56, color: "var(--text)" }}>#{r.shot}</span>
                    <span className="num muted" style={{ fontSize: 11 }}>{r.actual ? "flipped" : "kept"}</span>
                    <span style={{ display: "flex", gap: 3, marginLeft: "auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {r.wrong.map((w) => <i key={w} title={`${methodLabel(w)} wrong`} style={{ width: 8, height: 8, borderRadius: 2, background: methodColor(w), display: "inline-block" }} />)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="field-help" style={{ marginTop: 8 }}>Coloured squares mark the decoders that were wrong on that shot.</div>
          </Card>
          <Card title="Failures on identical shots" sub={list.data ? `first ${int(list.data.failure_counts_shots)} shots, every method scored on the same shots` : ""}>
            <BarList fmt={(v) => int(v)} bars={Object.entries(fc).sort((a, b) => a[1] - b[1]).map(([k, v]) => ({ label: methodLabel(k), value: v, color: methodColor(k) }))} labelWidth={170} />
            <div className="field-help">{list.data?.note}</div>
          </Card>
        </div>
        <div className="col">
          {shot === null ? <Card><Callout tone="info">Select a shot to investigate.</Callout></Card> : !ev.data ? (ev.error ? <Card><ErrorBox message={ev.error} /></Card> : <Card><Loading label={`Decoding shot ${shot}…`} /></Card>) : (
            <>
              <div className="spread wrap">
                <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600 }}>Shot {ev.data.shot} · {expLabel(exp)}</div>
                <a className="btn sm teal" href={href("/shots", { exp, shot: ev.data.shot, overlay: "both" })}><Orbit />Open in 3D explorer</a>
              </div>
              <AnswerKey ev={ev.data} />
              <Card title="Predictions vs the answer key"><DecoderVerdicts ev={ev.data} /></Card>
              <Card title="Why did they disagree?">
                <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", lineHeight: 1.6, fontSize: 13 }}>{ev.data.narrative.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </Card>
              {detail.data && (
                <Card title="Detector events by round" sub="Rings: teal = matched by PyMatching, violet = used by the Ising solution, white = both">
                  <Lattice2D geo={detail.data.geometry} fired={ev.data.measured.detection_events} round={null} onRound={() => undefined}
                    overlay={{ pymatching: ev.data.decoders.pymatching_pij?.edges, ising: ev.data.decoders.ising_noise_aware?.mechanisms }} show={{ pm: true, ising: true, comp: false }} />
                </Card>
              )}
              <Callout tone="hw">{ev.data.language_note}</Callout>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
