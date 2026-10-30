import { useEffect, useMemo, useState } from "react";
import { CircuitBoard, Cpu, Network, Timer } from "lucide-react";
import { useApi } from "../lib/api";
import { useKey, usePlayer } from "../lib/hooks";
import { qNum, qStr } from "../lib/router";
import { fix, pct } from "../lib/format";
import type { Amp, CircuitResult, Operation } from "../lib/types";
import { Callout, Card, ErrorBox, Field, Loading, PageHead, ProvenanceBadge, Seg, Slider, Tabs, useDebounced } from "../components/ui";
import { CircuitViewer, opSummary } from "../components/CircuitViewer";
import { PlayerControls } from "../components/qec";

function BitToggles({ value, onChange, label, prefix, offset = 0 }: { value: string; onChange: (v: string) => void; label: string; prefix: string; offset?: number }) {
  return (
    <div className="row" role="group" aria-label={label} style={{ gap: 6 }}>
      {value.split("").map((b, i) => (
        <button key={i} className={`btn sm ${b === "1" ? "active" : ""}`} aria-pressed={b === "1"}
          onClick={() => onChange(value.split("").map((x, k) => (k === i ? (x === "1" ? "0" : "1") : x)).join(""))}>
          {prefix}{i + offset}
        </button>
      ))}
    </div>
  );
}

function Amplitudes({ amps }: { amps: Amp[] }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      {amps.map((a) => {
        const hue = ((Math.atan2(a.im, a.re) * 180) / Math.PI + 360) % 360;
        return (
          <div key={a.basis} className="row" style={{ gap: 10 }}>
            <span className="bits" style={{ width: 92, fontSize: 12 }}>|{a.basis.slice(0, 3)}<span style={{ color: "var(--violet)" }}>{a.basis.slice(3)}</span>⟩</span>
            <div style={{ flex: 1, height: 10, borderRadius: 5, background: "#121b2f", overflow: "hidden" }}>
              <div style={{ width: `${a.prob * 100}%`, height: "100%", background: `hsl(${(190 + hue) % 360} 80% 62%)`, transition: "width .4s var(--ease)" }} />
            </div>
            <span className="num" style={{ width: 150, fontSize: 11.5, textAlign: "right" }}>
              {a.re.toFixed(3)}{a.im >= 0 ? "+" : "−"}{Math.abs(a.im).toFixed(3)}i
            </span>
          </div>
        );
      })}
      <div className="field-help">basis order d0 d1 d2 <span style={{ color: "var(--violet)" }}>a0 a1</span> · bar colour encodes the complex phase</div>
    </div>
  );
}

function CouplingGraph({ edges, layout }: { edges: number[][]; layout: Record<string, string> }) {
  const nodes = [...new Set(edges.flat())].sort((a, b) => a - b);
  const pos: Record<number, [number, number]> = edges.length === 6 && nodes.length === 7
    ? { 0: [40, 30], 1: [110, 30], 2: [180, 30], 3: [110, 90], 4: [40, 150], 5: [110, 150], 6: [180, 150] }
    : Object.fromEntries(nodes.map((n, i) => [n, [30 + i * 55, 60]]));
  const inv = Object.fromEntries(Object.entries(layout).map(([v, p]) => [Number(p.slice(1)), v]));
  const h = edges.length === 6 && nodes.length === 7 ? 180 : 110;
  const w = Math.max(220, ...nodes.map((n) => pos[n][0] + 40));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" style={{ maxWidth: 320 }}>
      {edges.map(([a, b]) => <line key={`${a}-${b}`} x1={pos[a][0]} y1={pos[a][1]} x2={pos[b][0]} y2={pos[b][1]} stroke="#33476f" strokeWidth={2} />)}
      {nodes.map((n) => {
        const v = inv[n];
        const color = v?.startsWith("d") ? "#5ad8ef" : v?.startsWith("a") ? "#a58bff" : "#3a4a6c";
        return (
          <g key={n}>
            <circle cx={pos[n][0]} cy={pos[n][1]} r={15} fill="#0c1424" stroke={color} strokeWidth={2} />
            <text x={pos[n][0]} y={pos[n][1] + 4} textAnchor="middle" style={{ fontSize: 10.5, fill: "var(--text)", fontFamily: "var(--font-mono)" }}>{v ?? `q${n}`}</text>
            <text x={pos[n][0]} y={pos[n][1] + 28} textAnchor="middle" style={{ fontSize: 9, fill: "var(--muted)" }}>q{n}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function CircuitInspector({ query }: { query: URLSearchParams }) {
  const [state, setState] = useState(qStr(query, "state", "plus"));
  const [x, setX] = useState(qStr(query, "x", "010"));
  const [z, setZ] = useState(qStr(query, "z", "000"));
  const [ro, setRo] = useState(qStr(query, "ro", "00"));
  const [decoder, setDecoder] = useState(qStr(query, "decoder", "energy"));
  const [mode, setMode] = useState(qStr(query, "mode", "physical"));
  const [p, setP] = useState(qNum(query, "p", 0.05));
  const [q, setQ] = useState(qNum(query, "q", 0.02));
  const [coupling, setCoupling] = useState("line");
  const [level, setLevel] = useState(1);
  const [view, setView] = useState<"logical" | "transpiled">("logical");
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    if (query.get("x")) setX(query.get("x") as string);
    if (query.get("z")) setZ(query.get("z") as string);
    if (query.get("ro")) setRo(query.get("ro") as string);
    if (query.get("state")) setState(query.get("state") as string);
    if (query.get("mode")) setMode(query.get("mode") as string);
  }, [query]);
  const body = useMemo(() => ({ state, x_errors: x, z_errors: z, readout_flips: ro, decoder, mode, p: Math.max(p, 0.001), q, coupling, optimization_level: level, seed: 11 }),
    [state, x, z, ro, decoder, mode, p, q, coupling, level]);
  const deb = useDebounced(body, 200);
  const { data, error, reload } = useApi<CircuitResult>("/qec/circuit", deb);
  const steps = data?.steps ?? [];
  const player = usePlayer(steps.length, 700);
  useEffect(() => { player.end(); setSelected(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [data]);
  useKey((e) => {
    if (e.key === " ") { e.preventDefault(); player.toggle(); }
    if (e.key === "ArrowRight") player.next();
    if (e.key === "ArrowLeft") player.prev();
  }, [player]);
  const step = steps[player.index];
  const currentOp = step && step.index >= 0 ? step.index : -1;
  const focusOp: Operation | undefined = data?.operations.find((o) => o.index === (selected ?? currentOp));
  const focusStep = steps.find((s) => s.index === (selected ?? currentOp)) ?? step;
  const clregs = mode === "physical" ? [{ name: "syn", size: 2 }, { name: "ver", size: 1 }] : [{ name: "syn", size: 2 }, { name: "out", size: 3 }];
  const m = data?.metrics;
  const t = data?.transpiled.metrics;

  return (
    <div className="fade-in">
      <PageHead kicker="Module 1 · Interactive Studio" title="Circuit Inspector"
        lede="The exact Qiskit circuit used by the lab: encoding, injected errors, syndrome extraction, mid-circuit measurement, classical feed-forward (or a Pauli-frame update) and ideal verification — stepped gate by gate, then transpiled to a constrained device."
        right={<><ProvenanceBadge kind="simulation" /><ProvenanceBadge kind="live" /></>} />
      <div className="two-pane">
        <div className="col sticky">
          <Card title="Experiment" icon={<CircuitBoard />}>
            <div className="col">
              <Field label="Logical input">
                <Seg value={state} onChange={setState} options={[{ value: "zero", label: "|0⟩" }, { value: "one", label: "|1⟩" }, { value: "plus", label: "|+⟩" }, { value: "minus", label: "|−⟩" }, { value: "plus_i", label: "|+i⟩" }]} />
              </Field>
              <Field label="X errors after encoding"><BitToggles value={x} onChange={setX} label="X errors" prefix="X" /></Field>
              <Field label="Z errors (undetectable)"><BitToggles value={z} onChange={setZ} label="Z errors" prefix="Z" /></Field>
              <Field label="Syndrome readout flips"><BitToggles value={ro} onChange={setRo} label="Readout flips" prefix="S" offset={1} /></Field>
              <Field label="Decoder (sets the feed-forward table)">
                <Seg full value={decoder} onChange={setDecoder} options={[{ value: "lookup", label: "Lookup" }, { value: "energy", label: "Energy" }, { value: "exact", label: "Exact" }, { value: "none", label: "None" }]} />
              </Field>
              <Slider label="Decoder model p" value={p} min={0.001} max={0.4} step={0.001} onChange={setP} format={(v) => v.toFixed(3)} />
              <Slider label="Decoder model q" value={q} min={0} max={0.4} step={0.001} onChange={setQ} format={(v) => v.toFixed(3)} tone="violet" />
              <Field label="Correction style" help={mode === "physical" ? "X gates applied inside if_test blocks (classical feed-forward)." : "No gates: the correction is tracked classically and applied to the readout."}>
                <Seg full value={mode} onChange={setMode} options={[{ value: "physical", label: "Feed-forward gates" }, { value: "pauli_frame", label: "Pauli frame" }]} />
              </Field>
            </div>
          </Card>
          <Card title="Transpilation target" icon={<Cpu />}>
            <div className="col">
              <Field label="Coupling map"><Seg full value={coupling} onChange={setCoupling} options={[{ value: "line", label: "5-qubit line" }, { value: "h7", label: "7-qubit H graph" }]} /></Field>
              <Field label="Optimization level"><Seg full value={level} onChange={setLevel} options={[0, 1, 2, 3].map((v) => ({ value: v, label: String(v) }))} /></Field>
              <div className="field-help">Basis rz, sx, x, cx · seed 11 · the Toffoli in the ideal verifier is decomposed by the transpiler.</div>
            </div>
          </Card>
        </div>
        <div className="col">
          {error && <Card><ErrorBox message={error} onRetry={reload} /></Card>}
          {!data && !error && <Card><Loading label="Building the circuit with Qiskit…" /></Card>}
          {data && m && t && (
            <>
              <Card>
                <Tabs value={view} onChange={setView} tabs={[{ value: "logical", label: "Logical circuit", count: `${m.total_gates} gates` }, { value: "transpiled", label: "Transpiled circuit", count: `${t.total_gates} gates` }]} />
                {view === "logical" ? (
                  <div className="col">
                    <div className="spread wrap">
                      <PlayerControls player={player} count={steps.length} label={step ? `step ${player.index} of ${steps.length - 1} · ${step.name}` : ""} />
                      <div className="row wrap">
                        <span className="chip">observed syndrome <b className="bits">{data.observed_syndrome}</b></span>
                        <span className="chip">correction <b className="bits">{data.correction}</b></span>
                        <span className="chip">residual <b className="bits">{data.residual}</b></span>
                      </div>
                    </div>
                    <CircuitViewer ops={data.operations} qubits={data.qubits} clregs={clregs} current={currentOp} selected={selected} onSelect={(i) => setSelected(i === selected ? null : i)} />
                    <div className="legend">
                      <span><i style={{ background: "#5ad8ef" }} />unitary gate</span>
                      <span><i style={{ background: "#f47c80" }} />injected error</span>
                      <span><i style={{ background: "#f3b867" }} />modeled readout flip</span>
                      <span><i style={{ background: "#a58bff" }} />measurement</span>
                      <span><i style={{ background: "#63d697" }} />classical feed-forward (if_test)</span>
                    </div>
                  </div>
                ) : (
                  <div className="col">
                    <div className="row wrap">
                      <span className="chip">{data.transpiled.physical_qubits} physical qubits on {coupling === "line" ? "5-qubit line" : "7-qubit H graph"}</span>
                      <span className="chip">optimization level {data.transpiled.optimization_level}</span>
                      <span className="chip"><Timer style={{ width: 12, height: 12 }} />compiled in {(data.transpiled.compile_seconds * 1000).toFixed(0)} ms</span>
                    </div>
                    <CircuitViewer ops={data.transpiled.operations} qubits={[...new Set(data.transpiled.operations.flatMap((o) => o.qubits))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))}
                      clregs={clregs} colW={44} physical />
                    <div className="grid g2" style={{ alignItems: "center" }}>
                      <div>
                        <div className="field-help" style={{ marginBottom: 6 }}>Final virtual → physical layout on the coupling graph</div>
                        <CouplingGraph edges={data.transpiled.coupling_edges} layout={data.transpiled.layout} />
                      </div>
                      <Callout tone="info">Routing inserts SWAPs (as CNOT triples) when interacting qubits are not neighbours, which is why the transpiled two-qubit count exceeds the logical one. Depth counts layers of gates; it is not wall-clock time.</Callout>
                    </div>
                  </div>
                )}
              </Card>
              {view === "logical" && focusOp && focusStep && (
                <div className="grid g2">
                  <Card title={<>Gate {focusOp.index}: <span className="num">{focusOp.display ?? focusOp.name}</span> <span className="badge neutral">{focusOp.stage}</span></>}
                    sub={selected !== null ? "selected gate (click again to follow the player)" : "current player step"}>
                    <div className="col">
                      <p style={{ color: "var(--text)" }}>{focusOp.explanation}</p>
                      <div className="kv">
                        <dt>instruction</dt><dd>{opSummary(focusOp)}</dd>
                        {focusStep.outcome !== undefined && <><dt>outcome</dt><dd>{focusStep.outcome} {focusStep.deterministic ? "(deterministic)" : `(sampled; P(1) = ${fix(focusStep.probability_one, 4)})`}</dd></>}
                        {focusStep.taken !== undefined && <><dt>condition</dt><dd>syn = {focusStep.register_value} vs {focusStep.condition_value} → {focusStep.taken ? "TAKEN: gates applied" : "not taken"}</dd></>}
                        <dt>classical bits</dt><dd>{Object.entries(focusStep.classical).map(([k, v]) => `${k}=${v}`).join("  ")}</dd>
                      </div>
                    </div>
                  </Card>
                  <Card title="State after this step" sub="Qiskit Statevector over d0 d1 d2 a0 a1 (non-zero amplitudes)">
                    <Amplitudes amps={focusStep.state} />
                  </Card>
                </div>
              )}
              <Card title="Resource metrics" icon={<Network />} sub="Recursive counts include gates inside control-flow blocks">
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Metric</th><th className="num">Logical circuit</th><th className="num">Transpiled</th><th>Note</th></tr></thead>
                    <tbody>
                      <tr><td>Data qubits</td><td className="num">{m.data_qubits}</td><td className="num">3</td><td className="muted">d0 d1 d2</td></tr>
                      <tr><td>Ancilla qubits</td><td className="num">{m.ancilla_qubits}</td><td className="num">{t.total_qubits - 3}</td><td className="muted">routing may use extra physical qubits</td></tr>
                      <tr><td>Total qubits</td><td className="num">{m.total_qubits}</td><td className="num">{t.total_qubits}</td><td className="muted">overhead vs 1 unprotected qubit: ×{m.total_qubits}</td></tr>
                      <tr><td>Total gates</td><td className="num">{m.total_gates}</td><td className="num">{t.total_gates}</td><td className="muted">excludes measurements and barriers</td></tr>
                      <tr><td>One-qubit gates</td><td className="num">{m.one_qubit_gates}</td><td className="num">{t.one_qubit_gates}</td><td className="muted">rz is virtual on many devices</td></tr>
                      <tr><td>Two-qubit gates</td><td className="num">{m.two_qubit_gates}</td><td className="num">{t.two_qubit_gates}</td><td className="muted">dominant error source</td></tr>
                      <tr><td>Three-qubit gates</td><td className="num">{m.multi_qubit_gates}</td><td className="num">{t.multi_qubit_gates}</td><td className="muted">Toffoli of the ideal verifier (decomposed when transpiled)</td></tr>
                      <tr><td>Measurements</td><td className="num">{m.measurements}</td><td className="num">{t.measurements}</td><td className="muted">2 syndrome + verification/readout</td></tr>
                      <tr><td>Conditional blocks</td><td className="num">{m.conditional_blocks}</td><td className="num">{t.conditional_blocks}</td><td className="muted">classical feed-forward</td></tr>
                      <tr><td>Circuit depth</td><td className="num">{m.depth}</td><td className="num">{t.depth}</td><td className="muted">layers, not wall-clock time</td></tr>
                      <tr><td>Compilation time</td><td className="num">—</td><td className="num">{(data.transpiled.compile_seconds * 1000).toFixed(0)} ms</td><td className="muted">Qiskit {data.provenance.versions.qiskit}</td></tr>
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="col">
                <Card title="Aer cross-check" sub={`${data.aer_cross_check.shots} shots, seed ${data.aer_cross_check.seed} — independent of the step-through simulator`}>
                  <div className="col">
                    {Object.entries(data.aer_cross_check.counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                      <div key={k} className="row">
                        <span className="bits" style={{ width: 110 }}>{k}</span>
                        <div style={{ flex: 1, height: 10, borderRadius: 5, background: "#121b2f" }}><div style={{ width: pct(n / data.aer_cross_check.shots, 2), height: "100%", borderRadius: 5, background: "var(--violet)" }} /></div>
                        <span className="num" style={{ width: 60, textAlign: "right" }}>{n}</span>
                      </div>
                    ))}
                    <div className="field-help">{data.aer_cross_check.key_format}</div>
                  </div>
                </Card>

              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
