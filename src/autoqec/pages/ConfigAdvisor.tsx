import { useMemo, useState } from "react";
import { CircleCheck, CircleX, Orbit, Target } from "lucide-react";
import { useApi } from "../lib/api";
import { href } from "../lib/router";
import { ci, expLabel, methodColor, methodLabel, pct, us } from "../lib/format";
import { Scatter } from "../charts/charts";
import { Callout, Card, ErrorBox, Field, Loading, PageHead, ProvenanceBadge, Seg, Slider, Toggle, useDebounced } from "../components/ui";

const ROUNDS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25];

export default function ConfigAdvisor() {
  const [rounds, setRounds] = useState<number>(25);
  const [basis, setBasis] = useState<"any" | "X" | "Z">("any");
  const [kind, setKind] = useState<"per_shot" | "per_round">("per_round");
  const [useTarget, setUseTarget] = useState(true);
  const [target, setTarget] = useState(0.45);
  const [targetRound, setTargetRound] = useState(0.032);
  const [useQubits, setUseQubits] = useState(false);
  const [qubits, setQubits] = useState(49);
  const [useLatency, setUseLatency] = useState(false);
  const [latency, setLatency] = useState(50);
  const [conservative, setConservative] = useState(true);
  const [w, setW] = useState({ reliability: 1, space: 0.5, speed: 0.1 });
  const body = useMemo(() => ({
    rounds: kind === "per_shot" ? rounds : null, basis, target_kind: kind,
    target: useTarget ? (kind === "per_shot" ? target : targetRound) : null,
    max_qubits: useQubits ? qubits : null, max_latency_us: useLatency ? latency : null, conservative, priorities: w,
  }), [rounds, basis, kind, useTarget, target, targetRound, useQubits, qubits, useLatency, latency, conservative, w]);
  const deb = useDebounced(body, 200);
  const { data, error, reload } = useApi<any>("/google/advisor", deb);
  const rec = data?.recommendation;
  const isRec = (c: any) => !!rec && c.experiment === rec.experiment && c.method === rec.method;
  const pts = (data?.candidates ?? []).map((c: any, i: number) => ({
    id: `${c.experiment}|${c.method}|${i}`, x: c.physical_qubits + (c.method.length % 7) * 0.35 - 1, y: c.metric, color: methodColor(c.method),
    shape: (isRec(c) ? "diamond" : c.feasible ? "circle" : "ring") as "diamond" | "circle" | "ring", faded: !c.feasible, size: isRec(c) ? 8 : 5,
    label: <div><b>{methodLabel(c.method)}</b><div className="num muted">{expLabel(c.experiment)} · {pct(c.metric, 2)}</div></div>,
  }));

  return (
    <div className="fade-in">
      <PageHead module={2} kicker="Module 2 · Google Hardware Analyzer" title="Configuration Advisor"
        lede="Recommends an error-correction configuration — code distance, patch, memory basis, rounds and decoder — strictly from configurations that were evaluated on Google's real shots. It never extrapolates to untested operating points."
        right={<ProvenanceBadge kind="hardware" />} />
      <div className="two-pane">
        <div className="col sticky">
          <Card title="Requirements" icon={<Target />}>
            <div className="col">
              <Field label="Reliability metric">
                <Seg full value={kind} onChange={setKind} options={[{ value: "per_shot", label: "Failure per shot" }, { value: "per_round", label: "Error per round (fit)" }]} />
              </Field>
              {kind === "per_shot" && (
                <Field label="Memory duration (tested rounds only)">
                  <select className="input" value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>{ROUNDS.map((r) => <option key={r} value={r}>{r} rounds</option>)}</select>
                </Field>
              )}
              <Field label="Memory basis"><Seg full value={basis} onChange={setBasis} options={[{ value: "any", label: "Any" }, { value: "X", label: "X" }, { value: "Z", label: "Z" }]} /></Field>
              <Toggle on={useTarget} onChange={setUseTarget} label="Reliability target" />
              {useTarget && (kind === "per_shot"
                ? <Slider label="max logical failure per shot" value={target} min={0.005} max={0.5} step={0.005} onChange={setTarget} format={(v) => pct(v, 1)} tone="teal" />
                : <Slider label="max logical error per round" value={targetRound} min={0.02} max={0.06} step={0.0005} onChange={setTargetRound} format={(v) => pct(v, 2)} tone="teal" />)}
              <Toggle on={conservative} onChange={setConservative} label="Judge by the 95% upper bound" />
              <Toggle on={useQubits} onChange={setUseQubits} label="Physical-qubit budget" />
              {useQubits && <Slider label="max physical qubits" value={qubits} min={10} max={60} step={1} onChange={setQubits} format={(v) => String(v)} />}
              <Toggle on={useLatency} onChange={setUseLatency} label="Decoder latency limit" />
              {useLatency && <Slider label="max µs per shot (measured)" value={latency} min={1} max={5000} step={1} onChange={setLatency} format={(v) => us(v)} tone="violet" />}
            </div>
          </Card>
          <Card title="Priorities">
            <div className="col">
              <Slider label="Reliability" value={w.reliability} min={0} max={3} step={0.05} onChange={(v) => setW({ ...w, reliability: v })} format={(v) => v.toFixed(2)} tone="teal" />
              <Slider label="Space (fewer qubits)" value={w.space} min={0} max={3} step={0.05} onChange={(v) => setW({ ...w, space: v })} format={(v) => v.toFixed(2)} />
              <Slider label="Speed (lower latency)" value={w.speed} min={0} max={3} step={0.05} onChange={(v) => setW({ ...w, speed: v })} format={(v) => v.toFixed(2)} tone="violet" />
            </div>
          </Card>
        </div>
        <div className="col">
          {error && <Card><ErrorBox message={error} onRetry={reload} /></Card>}
          {!data && !error && <Card><Loading label="Filtering tested configurations…" /></Card>}
          {data && data.status === "no_match" && (
            <Card tone="red" title={<><CircleX style={{ color: "var(--red)" }} />{data.message}</>}>
              <p>{data.detail ?? "Every experimentally evaluated configuration violates at least one requirement. Closest candidates and their violations are listed below."}</p>
              {data.candidates?.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 10, maxHeight: 340, overflowY: "auto" }}>
                  <table className="data">
                    <thead><tr><th>Configuration</th><th>Decoder</th><th>Violations</th></tr></thead>
                    <tbody>{data.candidates.slice(0, 15).map((c: any, i: number) => (
                      <tr key={i}><td>{expLabel(c.experiment)}</td><td>{methodLabel(c.method)}</td><td>{c.violations.join("; ")}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          {data && data.status === "recommended" && rec && (
            <>
              <Card tone="green" title={<><CircleCheck style={{ color: "var(--green)" }} />Recommended tested configuration</>} sub={`${data.feasible} of ${data.evaluated} evaluated configurations meet the constraints`}>
                <div className="grid g4">
                  <div className="metric teal"><div className="label">Code</div><div className="value" style={{ fontSize: 20 }}>d = {rec.distance} · {rec.basis}</div><div className="hint">{rec.rounds} rounds · patch ({rec.center.replace("_", ", ")})</div></div>
                  <div className="metric"><div className="label">Physical qubits</div><div className="value">{rec.physical_qubits}</div><div className="hint">from the experiment's circuit</div></div>
                  <div className="metric green"><div className="label">{kind === "per_round" ? "Error per round" : "Failure per shot"}</div><div className="value" style={{ fontSize: 20 }}>{pct(kind === "per_round" ? rec.per_round?.epsilon : rec.rate, 2)}</div>
                    <div className="hint">{kind === "per_round" && rec.per_round ? ci(rec.per_round.ci95, 2) : ci(rec.ci95, 2)} · {rec.shots.toLocaleString()} shots</div></div>
                  <div className="metric violet"><div className="label">Decoder</div><div className="value" style={{ fontSize: 16, lineHeight: 1.3 }}>{methodLabel(rec.method)}</div><div className="hint">{rec.latency_us ? `${us(rec.latency_us)} / shot` : "latency not measured"}</div></div>
                </div>
                <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "var(--text-2)", lineHeight: 1.6 }}>{data.why.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
                <div className="row" style={{ marginTop: 12 }}>
                  <a className="btn sm teal" href={href("/shots", { exp: rec.experiment, shot: 0 })}><Orbit />See a real shot from it</a>
                  <a className="btn sm" href={href("/failures", { exp: rec.experiment })}>Investigate its failures</a>
                </div>
              </Card>
              {data.tradeoffs.length > 0 && (
                <Card title="Trade-offs versus the next tested options">
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>Configuration</th><th>Decoder</th><th className="num">Metric</th><th className="num">Qubits</th><th className="num">Latency</th><th>Compared with the recommendation</th></tr></thead>
                      <tbody>{data.tradeoffs.map((t: any, i: number) => (
                        <tr key={i}><td>{expLabel(t.experiment)}</td><td>{methodLabel(t.method)}</td><td className="num">{pct(t.metric, 2)}</td><td className="num">{t.physical_qubits}</td><td className="num">{us(t.latency_us)}</td><td style={{ fontSize: 12 }}>{t.difference}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
          {data && pts.length > 0 && (
            <Card title="Evaluated options" sub="x: physical qubits (jittered by decoder) · y: the selected reliability metric · ◆ recommended · ○ infeasible">
              <Scatter points={pts} xLabel="physical qubits" yLabel={kind === "per_round" ? "error per round" : "failure per shot"} yFmt={(v) => pct(v, 1)} xFmt={(v) => String(Math.round(v))} height={300} />
            </Card>
          )}
          {data?.boundaries && <Callout tone="hw"><ul style={{ margin: 0, paddingLeft: 18 }}>{data.boundaries.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul></Callout>}
        </div>
      </div>
    </div>
  );
}
