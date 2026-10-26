import { useEffect, useMemo, useState } from "react";
import { CircuitBoard, Dices, Download, FlaskConical, Microscope, RotateCcw, Sigma, Waves } from "lucide-react";
import { downloadJson, useApi } from "../lib/api";
import { useKey, usePlayer } from "../lib/hooks";
import { href, qNum, qStr } from "../lib/router";
import { fix, pct } from "../lib/format";
import type { LabTrial } from "../lib/types";
import { Callout, Card, Eq, ErrorBox, Field, Loading, PageHead, ProvenanceBadge, Seg, Slider, Tech, Toggle, useDebounced } from "../components/ui";
import { DecoderTable, EnergyRanking, LogicalOutcome, PlayerControls, StabilizerDiagram, StateBars, STAGES, Timeline, ketString } from "../components/qec";
import type { Pauli } from "../components/qec";
import { CircuitViewer } from "../components/CircuitViewer";

const STATES = [
  { value: "zero", label: "|0⟩" },
  { value: "one", label: "|1⟩" },
  { value: "plus", label: "|+⟩" },
  { value: "minus", label: "|−⟩" },
  { value: "plus_i", label: "|+i⟩" },
  { value: "custom", label: "θ, φ" },
];
const CYCLE: Pauli[] = ["I", "X", "Y", "Z"];
const STAGE_KEYS = ["encode", "inject", "measure", "measure", "correct", "verify"];
const STAGE_SUB = [
  "Spread the logical value with two CNOTs: α|000⟩ + β|111⟩.",
  "Deliberate faults and seeded random flips act on the data qubits.",
  "Ancillas record the parities Z0Z1 and Z1Z2; readout may flip the recorded bits.",
  "Rank all 8 candidate errors by negative log-likelihood energy.",
  "Apply the decoder's correction: physical feed-forward or a Pauli-frame update.",
  "Did the logical information survive?",
];

function parseInject(v: string | null): Pauli[] {
  const out: Pauli[] = ["I", "I", "I"];
  if (!v) return out;
  for (const tok of v.split(",")) {
    const m = tok.trim().match(/^([XYZ])([0-2])$/);
    if (m) out[Number(m[2])] = m[1] as Pauli;
  }
  return out;
}

export default function QecLab({ query }: { query: URLSearchParams }) {
  const [state, setState] = useState(qStr(query, "state", "plus"));
  const [theta, setTheta] = useState(qNum(query, "theta", 1.1));
  const [phi, setPhi] = useState(qNum(query, "phi", 0.6));
  const [faults, setFaults] = useState<Pauli[]>(() => parseInject(query.get("inject") ?? "X1"));
  const [p, setP] = useState(qNum(query, "p", 0.02));
  const [q, setQ] = useState(qNum(query, "q", 0.02));
  const [matched, setMatched] = useState(true);
  const [mp, setMp] = useState(0.05);
  const [mq, setMq] = useState(0.02);
  const [decoder, setDecoder] = useState(qStr(query, "decoder", "energy"));
  const [mode, setMode] = useState(qStr(query, "mode", "physical"));
  const [seed, setSeed] = useState(qNum(query, "seed", 7));
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    // Presenter / deep links update the experiment.
    if (query.get("inject") !== null) setFaults(parseInject(query.get("inject")));
    if (query.get("state")) setState(query.get("state") as string);
    if (query.get("p") !== null) setP(qNum(query, "p", 0));
    if (query.get("q") !== null) setQ(qNum(query, "q", 0));
  }, [query]);

  const body = useMemo(() => ({
    state, theta, phi, p, q, decoder, mode, seed,
    injected: faults.flatMap((f, i) => (f === "I" ? [] : [{ qubit: i, pauli: f }])),
    model: matched ? null : { p: mp, q: mq },
  }), [state, theta, phi, p, q, decoder, mode, seed, faults, matched, mp, mq]);
  const debounced = useDebounced(body, 180);
  const { data, error, loading, reload } = useApi<LabTrial>("/qec/lab/trial", debounced);
  const player = usePlayer(STAGES.length, 1100);
  useKey((e) => {
    if (e.key === " ") { e.preventDefault(); player.toggle(); }
    if (e.key === "ArrowRight") player.next();
    if (e.key === "ArrowLeft") player.prev();
  }, [player]);
  useEffect(() => setSelected(null), [data]);

  const stage = player.index;
  const snap = data ? (data.stages[STAGE_KEYS[stage]] ?? data.stages["measure"] ?? data.stages["inject"]) : null;
  const reduced = snap?.reduced?.separable ? snap.reduced.data ?? [] : [];
  const errors: Pauli[] = data ? [0, 1, 2].map((i) => {
    const x = data.noise.injected_x[i] === "1";
    const z = data.noise.injected_z[i] === "1";
    return x && z ? "Y" : x ? "X" : z ? "Z" : "I";
  }) : faults;
  const cycleFault = (qb: number) => setFaults((f) => f.map((v, i) => (i === qb ? CYCLE[(CYCLE.indexOf(v) + 1) % 4] : v)));
  const circuitLink = data ? href("/circuit", {
    state, x: data.noise.total_x, z: data.noise.injected_z, ro: data.noise.readout_flips, decoder, mode, p: Math.max(p, 0.001), q,
  }) : href("/circuit");

  return (
    <div className="fade-in">
      <PageHead kicker="Module 1 · Interactive Studio" title="QEC Lab: the three-qubit bit-flip code"
        lede="Encode a logical qubit, inject faults, measure the two parity checks, decode with an explicit likelihood model and verify the result — every state is a real Qiskit statevector and every number comes from the backend."
        right={<><ProvenanceBadge kind="simulation" /><ProvenanceBadge kind="live" />
          <button className="btn sm" disabled={!data} onClick={() => data && downloadJson(`autoqec-lab-trial-seed${data.input.seed}.json`, data)}><Download />Export trial</button></>} />
      <div className="lab-layout">
        <div className="col sticky">
          <Card title="Logical state" icon={<Sigma />}>
            <div className="col">
              <Seg value={state} options={STATES} onChange={setState} label="Logical input state" />
              {state === "custom" && (
                <>
                  <Slider label="θ (polar angle)" value={theta} min={0} max={Math.PI} step={0.01} onChange={setTheta} format={(v) => `${v.toFixed(2)} rad`} />
                  <Slider label="φ (phase)" value={phi} min={-Math.PI} max={Math.PI} step={0.01} onChange={setPhi} format={(v) => `${v.toFixed(2)} rad`} />
                </>
              )}
              {data && (
                <div className="field-help">
                  α = <span className="num">{fix(data.input.alpha[0], 3)}</span>, β = <span className="num">{fix(data.input.beta[0], 3)}{data.input.beta[1] ? ` ${data.input.beta[1] < 0 ? "−" : "+"} ${fix(Math.abs(data.input.beta[1]), 3)}i` : ""}</span>
                  {" "}→ encoded α|000⟩ + β|111⟩
                </div>
              )}
            </div>
          </Card>
          <Card title="Inject faults" icon={<FlaskConical />} sub="Click a qubit (or use the selectors) to cycle I → X → Y → Z">
            <StabilizerDiagram errors={faults} showChecks={false} onQubitClick={cycleFault} compact />
            <div className="grid g3" style={{ gap: 8, marginTop: 4 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="col" style={{ gap: 4, alignItems: "center" }}>
                  <span className="field-help">d{i}</span>
                  <Seg value={faults[i]} options={CYCLE.map((c) => ({ value: c, label: c }))} onChange={(v) => setFaults((f) => f.map((x, k) => (k === i ? v : x)))} label={`Injected Pauli on d${i}`} mini />
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => setFaults(["I", "I", "I"])}><RotateCcw />Clear faults</button>
            </div>
          </Card>
          <Card title="Random noise" icon={<Waves />} sub="Seeded independent bit flips (simulation ground truth)">
            <div className="col">
              <Slider label="Data flip probability p" value={p} min={0} max={0.3} step={0.005} onChange={setP} format={(v) => v.toFixed(3)} />
              <Slider label="Syndrome readout error q" value={q} min={0} max={0.3} step={0.005} onChange={setQ} format={(v) => v.toFixed(3)} tone="violet" />
              <Toggle on={matched} onChange={setMatched} label="Decoder model matches the simulated noise" />
              {!matched && (
                <>
                  <Slider label="Decoder assumes p" value={mp} min={0.001} max={0.5} step={0.001} onChange={setMp} format={(v) => v.toFixed(3)} />
                  <Slider label="Decoder assumes q" value={mq} min={0} max={0.5} step={0.001} onChange={setMq} format={(v) => v.toFixed(3)} tone="violet" />
                </>
              )}
              <div className="field-help">With p = 0 the decoder still assumes p ≥ 0.001 so deliberate faults remain explainable.</div>
            </div>
          </Card>
          <Card title="Decoder & replay" icon={<Microscope />}>
            <div className="col">
              <Field label="Decoder">
                <Seg full value={decoder} onChange={setDecoder} options={[
                  { value: "lookup", label: "Lookup" }, { value: "energy", label: "Energy" }, { value: "exact", label: "Exact" }, { value: "none", label: "None" },
                ]} />
              </Field>
              <Field label="Correction" help={mode === "physical" ? "Classical feed-forward applies X gates inside if_test blocks." : "No gates: the correction is a classical Pauli-frame update applied to the readout."}>
                <Seg full value={mode} onChange={setMode} options={[{ value: "physical", label: "Feed-forward" }, { value: "pauli_frame", label: "Pauli frame" }]} />
              </Field>
              <Field label="Seed">
                <div className="row">
                  <input className="input mono" type="number" min={0} value={seed} onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))} aria-label="Random seed" />
                  <button className="btn icon" onClick={() => setSeed(Math.floor(Math.random() * 1e6))} title="New random seed" aria-label="New random seed"><Dices /></button>
                  <button className="btn icon" onClick={reload} title="Replay with the same seed" aria-label="Replay"><RotateCcw /></button>
                </div>
              </Field>
            </div>
          </Card>
        </div>

        <div className="col">
          <Card>
            <div className="col">
              <div className="spread wrap">
                <PlayerControls player={player} count={STAGES.length} label={`Stage ${stage + 1} of ${STAGES.length}`} />
                {loading && <span className="muted pulse" style={{ fontSize: 12 }}>computing…</span>}
              </div>
              <Timeline index={stage} onSelect={player.setIndex} />
            </div>
          </Card>
          {error && <Card><ErrorBox message={error} onRetry={reload} /></Card>}
          {!data && !error && <Card><Loading label="Running the first trial…" /></Card>}
          {data && (
            <Card key={stage} className="fade-in" title={STAGES[stage]} sub={STAGE_SUB[stage]}
              right={stage >= 3 ? <span className="badge live">decoder sees only the observed syndrome</span> : stage === 1 ? <span className="badge sim">ground truth</span> : null}>
              {stage === 0 && (
                <div className="col">
                  <Eq tex={String.raw`|\psi_L\rangle = \alpha|000\rangle + \beta|111\rangle,\qquad S_1 = Z_0Z_1,\; S_2 = Z_1Z_2`} />
                  <StateBars amps={reduced} label="Data-register amplitudes after encoding (bar colour = phase)" />
                  <div className="num muted" style={{ fontSize: 12 }}>{ketString(reduced)}</div>
                  <Callout tone="info">The CNOTs copy computational-basis values, not the unknown state — no cloning occurs. Both checks have eigenvalue +1 on every codeword.</Callout>
                </div>
              )}
              {stage === 1 && (
                <div className="col">
                  <StabilizerDiagram errors={errors} randomFlips={data.noise.random_x} />
                  <div className="row wrap">
                    <span className="chip">injected X part: <b className="bits">{data.noise.injected_x}</b></span>
                    <span className="chip">random flips (seed {data.input.seed}): <b className="bits">{data.noise.random_x}</b></span>
                    <span className="chip">total X error: <b className="bits">{data.noise.total_x}</b></span>
                    {data.noise.injected_z !== "000" && <span className="badge warn">Z part {data.noise.injected_z}: invisible to these checks</span>}
                  </div>
                  <StateBars amps={reduced} label="Data register after the errors" />
                </div>
              )}
              {stage === 2 && (
                <div className="col">
                  <StabilizerDiagram errors={errors} randomFlips={data.noise.random_x} ideal={data.syndrome.ideal} observed={data.syndrome.observed} readout={data.noise.readout_flips} />
                  <div className="grid g3">
                    <div className="metric"><div className="label">Ideal syndrome</div><div className="value bits">{data.syndrome.ideal}</div><div className="hint">from H·e mod 2</div></div>
                    <div className="metric"><div className="label">Readout flips</div><div className="value bits" style={{ color: data.syndrome.readout_corrupted ? "var(--amber)" : undefined }}>{data.noise.readout_flips}</div><div className="hint">probability q per check</div></div>
                    <div className="metric cyan"><div className="label">Observed syndrome</div><div className="value bits">{data.syndrome.observed}</div><div className="hint">the only input to the decoder</div></div>
                  </div>
                  <Callout tone="info">Syndrome bit 0 means the stabilizer measured +1; bit 1 means −1. Single X errors give: none → 00, X0 → 10, X1 → 11, X2 → 01.</Callout>
                </div>
              )}
              {stage === 3 && (
                <div className="col">
                  <div className="row wrap">
                    <span className="chip">best <b className="bits">{data.analysis.best}</b></span>
                    <span className="chip">runner-up <b className="bits">{data.analysis.second ?? "—"}</b></span>
                    <span className="chip">ΔE <b className="num">{fix(data.analysis.energy_gap, 3)}</b> nats</span>
                    <span className="chip">P(keep | model, {decoder}) <b className="num">{pct(data.decisions[data.input.decoder].logical_classes.p_logical_preserved, 1)}</b></span>
                  </div>
                  <EnergyRanking candidates={data.analysis.candidates} selected={selected} onSelect={setSelected} actual={data.noise.total_x} />
                  {selected && (() => {
                    const c = data.analysis.candidates.find((x) => x.candidate === selected)!;
                    return (
                      <div className="callout info fade-in">
                        <div>
                          <b className="bits">{c.candidate}</b> predicts syndrome <b className="bits">{c.predicted_syndrome}</b>, so readout flips <b className="bits">{c.readout_flips}</b> are needed to explain the observation.
                          Energy = {fix(c.data_energy)} (data) + {fix(c.readout_energy)} (readout) = <b>{fix(c.energy)}</b>; model posterior {pct(c.posterior, 2)}.
                          {c.preserves_logical !== undefined && <> If applied as the correction: <b>{c.if_applied_outcome?.replace("_", " ")}</b>.</>}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="qa">
                    {data.explanation.answers.slice(0, 6).map((a) => (
                      <div key={a.question} className="qa-item"><div className="qa-q">{a.question}</div><div className="qa-a">{a.answer}</div></div>
                    ))}
                  </div>
                </div>
              )}
              {stage === 4 && (
                <div className="col">
                  <StabilizerDiagram errors={errors} randomFlips={data.noise.random_x} ideal={data.syndrome.ideal} observed={data.syndrome.observed} readout={data.noise.readout_flips} correction={data.verification.correction} />
                  <Callout tone={mode === "physical" ? "info" : "sim"}>
                    {mode === "physical"
                      ? <>Feed-forward: the classical syndrome register conditions X gates (<code>if_test</code>). Correction applied: <b className="bits">{data.verification.correction}</b>.</>
                      : <>Pauli frame: no gate is applied. The correction <b className="bits">{data.verification.correction}</b> is stored classically and XORed into the final readout.</>}
                  </Callout>
                  <StateBars amps={reduced} label={mode === "physical" ? "Data register after the physical correction" : "Data register (unchanged: the frame is classical)"} />
                </div>
              )}
              {stage === 5 && (
                <div className="col">
                  <LogicalOutcome v={data.verification} />
                  <div className="field-help">{data.verification.convention}</div>
                </div>
              )}
            </Card>
          )}
          <Tech title="The energy (negative log-likelihood) model">
            <Eq tex={String.raw`E(e\mid y) = -\sum_i\big[e_i\ln p_i + (1-e_i)\ln(1-p_i)\big] - \sum_j\big[d_j\ln q_j + (1-d_j)\ln(1-q_j)\big],\quad d = y \oplus He`} />
            <p>exp(−E) is the joint probability of the data errors <i>e</i> and the readout flips <i>d</i> needed to explain the observed syndrome <i>y</i>. The minimum-energy candidate is the most probable explanation under the declared model. All 2³ = 8 candidates are enumerated exactly.</p>
            <Eq tex={String.raw`\Delta E = E_{(2)} - E_{(1)} \ge 0 \quad\text{(model-based ambiguity indicator, not a calibrated success probability)}`} />
          </Tech>
          <Tech title="Logical success and degeneracy (the recovery convention)">
            <p>Success is judged on the residual r = e ⊕ ê after an ideal final round (noiseless readout + majority vote), the convention of memory experiments. r = 000 restores the codeword; weight(r) ≤ 1 keeps the logical value recoverable; otherwise a logical X̄ was applied. Two different candidates can therefore lead to the same logical outcome. We do not use an even/odd-weight rule: it would count a single leftover flip as a logical error.</p>
            <p>The exact reference maximizes P(logical value survives | y) by enumerating every candidate; it can differ from the energy decoder when several less-likely explanations share a logical outcome.</p>
          </Tech>
        </div>

        <div className="col lab-right">
          {data && (
            <>
              <Card title="Same syndrome, every decoder" sub={`observed ${data.syndrome.observed} · click a row to switch`}>
                <DecoderTable decisions={data.decisions} active={data.input.decoder} onPick={setDecoder} />
                <div className="field-help" style={{ marginTop: 8 }}>P(keep | model) is the model posterior that the logical value survives — calibrated only if the model is right (tested in Simulation Benchmarks).</div>
              </Card>
              <Card title="The circuit used in this trial" icon={<CircuitBoard />} right={<a className="btn sm" href={circuitLink}>Inspect</a>}>
                <CircuitViewer ops={data.circuit.operations} qubits={data.circuit.qubits}
                  clregs={mode === "physical" ? [{ name: "syn", size: 2 }, { name: "ver", size: 1 }] : [{ name: "syn", size: 2 }, { name: "out", size: 3 }]} colW={40} />
                <div className="row wrap" style={{ marginTop: 8 }}>
                  <span className="chip">{data.circuit.metrics.total_qubits} qubits</span>
                  <span className="chip">{data.circuit.metrics.two_qubit_gates} two-qubit</span>
                  <span className="chip">{data.circuit.metrics.multi_qubit_gates} Toffoli</span>
                  <span className="chip">{data.circuit.metrics.measurements} measurements</span>
                  <span className="chip">depth {data.circuit.metrics.depth}</span>
                </div>
              </Card>
              <Card title="Provenance">
                <div className="kv">
                  <dt>kind</dt><dd>simulation (Qiskit statevector)</dd>
                  <dt>seed</dt><dd>{data.provenance.seed} (data and readout streams)</dd>
                  <dt>model</dt><dd>{data.input.model_matches_simulation ? "matches simulation" : "declared mismatch"}</dd>
                  <dt>p (sim / model)</dt><dd>{data.input.p.map((v) => v.toFixed(3)).join(", ")} / {data.input.model_p.map((v) => v.toFixed(3)).join(", ")}</dd>
                  <dt>q (sim / model)</dt><dd>{data.input.q.map((v) => v.toFixed(3)).join(", ")} / {data.input.model_q.map((v) => v.toFixed(3)).join(", ")}</dd>
                  <dt>computed in</dt><dd>{data.provenance.duration_ms.toFixed(0)} ms</dd>
                </div>
              </Card>
              <Callout tone="warn">The three-qubit bit-flip code corrects a single X error only. It does not protect against Z (phase) errors — inject Z on |+⟩ to see an uncorrectable logical phase flip.</Callout>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
