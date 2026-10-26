import { useEffect, useMemo, useState } from "react";
import { CircuitBoard, Dices, Download, Send } from "lucide-react";
import { downloadJson, useApi } from "../lib/api";
import { useKey, usePlayer } from "../lib/hooks";
import { href, qNum, qStr } from "../lib/router";
import { ci, fix, pct } from "../lib/format";
import type { MessageResult } from "../lib/types";
import { Bits, Callout, Card, Drawer, ErrorBox, Field, Loading, Metric, OutcomeBadge, PageHead, ProvenanceBadge, Seg, Slider, useDebounced } from "../components/ui";
import { EnergyRanking, PlayerControls } from "../components/qec";

const LANES = ["Encode", "Noise", "Syndrome", "Decode", "Recover"];

function charHex(c: string) {
  return [...new TextEncoder().encode(c)].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

export default function MessageLab({ query }: { query: URLSearchParams }) {
  const [message, setMessage] = useState(qStr(query, "message", "HELLO"));
  const [p, setP] = useState(qNum(query, "p", 0.08));
  const [q, setQ] = useState(qNum(query, "q", 0.02));
  const [decoder, setDecoder] = useState(qStr(query, "decoder", "energy"));
  const [seed, setSeed] = useState(qNum(query, "seed", 7));
  const [bit, setBit] = useState<number | null>(null);
  useEffect(() => {
    if (query.get("message")) setMessage(query.get("message") as string);
    if (query.get("p")) setP(qNum(query, "p", 0.08));
    if (query.get("q")) setQ(qNum(query, "q", 0.02));
    if (query.get("seed")) setSeed(qNum(query, "seed", 7));
  }, [query]);
  const bytes = new TextEncoder().encode(message).length;
  const body = useMemo(() => ({ message, p, q, decoder, seed }), [message, p, q, decoder, seed]);
  const deb = useDebounced(body, 300);
  const valid = bytes > 0 && bytes <= 64;
  const { data, error, loading, reload } = useApi<MessageResult>(valid ? "/qec/message" : null, deb);
  const nChars = data?.chars.length ?? 0;
  const frames = Math.max(1, nChars * LANES.length);
  const player = usePlayer(frames, 420);
  useEffect(() => {
    player.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  useKey((e) => {
    if (e.key === " ") { e.preventDefault(); player.toggle(); }
    if (e.key === "ArrowRight") player.next();
    if (e.key === "ArrowLeft") player.prev();
  }, [player]);
  const curChar = Math.floor(player.index / LANES.length);
  const curLane = player.index % LANES.length;
  const finished = player.index >= frames - 1;
  const doneChars = finished ? nChars : curChar + (curLane === LANES.length - 1 ? 1 : 0);
  const ch = data?.chars[Math.min(curChar, nChars - 1)];
  const range = ch ? Array.from({ length: ch.bit_end - ch.bit_start }, (_, k) => ch.bit_start + k) : [];
  const tr = data?.trace;

  return (
    <div className="fade-in">
      <PageHead kicker="Module 1 · Interactive Studio" title="Message Lab"
        lede="Type a short message. Each bit of its UTF-8 encoding is stored in a three-qubit repetition code, hit by seeded noise, syndrome-measured, decoded and recovered — next to an unprotected copy that suffers the same physical flips."
        right={<><ProvenanceBadge kind="simulation" /><ProvenanceBadge kind="live" />
          <button className="btn sm" disabled={!data} onClick={() => data && downloadJson(`autoqec-message-seed${data.input.seed}.json`, data)}><Download />Export</button></>} />
      <Card>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", alignItems: "end", gap: 18 }}>
          <Field label={<>Message <span className="muted num" style={{ marginLeft: 6 }}>{bytes}/64 bytes · {bytes * 8} bits</span></>}>
            <input className="input" value={message} maxLength={64} onChange={(e) => setMessage(e.target.value)} aria-label="Message to transmit" style={{ fontSize: 15, fontFamily: "var(--font-mono)" }} />
          </Field>
          <Slider label="Physical flip probability p" value={p} min={0} max={0.4} step={0.005} onChange={setP} format={(v) => v.toFixed(3)} />
          <Slider label="Syndrome readout error q" value={q} min={0} max={0.3} step={0.005} onChange={setQ} format={(v) => v.toFixed(3)} tone="violet" />
          <Field label="Decoder">
            <Seg full value={decoder} onChange={setDecoder} options={[{ value: "lookup", label: "Lookup" }, { value: "energy", label: "Energy" }, { value: "exact", label: "Exact" }, { value: "none", label: "None" }]} />
          </Field>
          <Field label="Seed">
            <div className="row">
              <input className="input mono" style={{ width: 90 }} type="number" min={0} value={seed} onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))} aria-label="Seed" />
              <button className="btn icon" onClick={() => setSeed(Math.floor(Math.random() * 1e6))} aria-label="New seed" title="New seed"><Dices /></button>
            </div>
          </Field>
        </div>
      </Card>
      {!valid && <Callout tone="warn">Enter between 1 and 64 UTF-8 bytes.</Callout>}
      {error && <Card className="mt"><ErrorBox message={error} onRetry={reload} /></Card>}
      {!data && !error && valid && <Card className="mt"><Loading label="Transmitting…" /></Card>}
      {data && tr && (
        <div className="col mt" style={{ gap: 16 }}>
          <div className="grid g3">
            {([["Original message", "original", "neutral"], ["Unprotected noisy transmission", "unprotected", "fail"], ["Protected transmission after decoding", "protected", "pass"]] as const).map(([title, key]) => {
              const exact = key === "original" ? true : key === "unprotected" ? data.text.unprotected_exact : data.text.protected_exact;
              return (
                <Card key={key} title={title} tone={key === "original" ? undefined : exact ? "green" : "red"}
                  right={key === "original" ? <span className="chip num">{data.bytes.length} B</span> : !finished ? <span className="badge neutral">in transit</span> : exact ? <span className="badge pass">intact</span> : <span className="badge fail">corrupted</span>}>
                  <div className="row wrap" style={{ gap: 6, minHeight: 52 }}>
                    {data.chars.map((c, i) => {
                      const shown = key === "original" || i < doneChars;
                      const text = key === "original" ? c.char : key === "unprotected" ? c.unprotected : c.protected;
                      const errs = key === "unprotected" ? c.unprotected_bit_errors : key === "protected" ? c.protected_bit_errors : 0;
                      return (
                        <button key={i} onClick={() => setBit(c.bit_start)} title={`${c.char} (${charHex(c.char)}) — ${errs} bit error(s)`}
                          style={{ minWidth: 34, height: 46, padding: "0 6px", borderRadius: 9, fontSize: 22, fontFamily: "var(--font-mono)", fontWeight: 600,
                            border: `1px solid ${!shown ? "var(--line)" : errs ? "rgba(244,124,128,0.55)" : "var(--line-2)"}`,
                            background: !shown ? "transparent" : errs ? "rgba(244,124,128,0.12)" : "rgba(255,255,255,0.03)",
                            color: !shown ? "var(--faint)" : errs ? "var(--red)" : "var(--text)", outline: i === curChar && !finished ? "1px solid var(--cyan)" : undefined }}>
                          {shown ? (text === " " ? "␠" : text) : "·"}
                        </button>
                      );
                    })}
                  </div>
                  {key !== "original" && finished && (
                    <div className="field-help" style={{ marginTop: 8 }}>
                      {key === "unprotected"
                        ? <>bit errors {data.stats.unprotected_bit_errors.count}/{data.stats.bits} = {pct(data.stats.unprotected_bit_errors.rate, 1)} {ci(data.stats.unprotected_bit_errors.ci95, 1)}</>
                        : <>bit errors {data.stats.protected_bit_errors.count}/{data.stats.bits} = {pct(data.stats.protected_bit_errors.rate, 1)} {ci(data.stats.protected_bit_errors.ci95, 1)}</>}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <div className="wide-right">
            <Card title={ch ? <>Transmitting “{ch.char === " " ? "␠" : ch.char}” <span className="muted num" style={{ fontWeight: 450 }}>· byte {charHex(ch.char)} · bits {ch.bit_start}–{ch.bit_end - 1}</span></> : "Transmission"}>
              <div style={{ marginBottom: 12 }}><PlayerControls player={player} count={frames} label={`character ${Math.min(curChar + 1, nChars)} of ${nChars} · ${LANES[curLane]}`} /></div>
              <div style={{ overflowX: "auto" }}>
                <table className="data" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>Stage</th>
                      {range.map((b) => <th key={b} className="num" style={{ textAlign: "center" }}>bit {b - (ch?.bit_start ?? 0)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {LANES.map((lane, li) => {
                      const show = finished || li <= curLane;
                      return (
                        <tr key={lane} style={{ opacity: show ? 1 : 0.18, transition: "opacity .3s" }}>
                          <td style={{ color: li === curLane && !finished ? "var(--cyan)" : "var(--text-2)", fontWeight: 600, whiteSpace: "nowrap" }}>{lane}</td>
                          {range.map((b) => {
                            const v = data.bits[b];
                            let cell: React.ReactNode = null;
                            if (li === 0) cell = <Bits value={v ? "111" : "000"} size={18} highlight="one" />;
                            if (li === 1) cell = <Bits value={(v ? "111" : "000").split("").map((x, k) => String(Number(x) ^ Number(tr.flips[b][k]))).join("")} compare={v ? "111" : "000"} size={18} />;
                            if (li === 2) cell = <span className="bits" style={{ color: tr.readout[b] !== "00" ? "var(--amber)" : tr.observed_syndrome[b] !== "00" ? "var(--violet)" : "var(--muted)" }} title={`ideal ${tr.ideal_syndrome[b]}, readout flips ${tr.readout[b]}`}>{tr.observed_syndrome[b]}</span>;
                            if (li === 3) cell = <span className="bits" style={{ color: tr.correction[b] !== "000" ? "var(--green)" : "var(--muted)" }}>{tr.correction[b]}</span>;
                            if (li === 4) cell = (
                              <span className="col" style={{ gap: 2, alignItems: "center" }}>
                                <span className={`bit-tile ${tr.protected[b] !== v ? "err" : tr.outcome[b] === "restored" && tr.flips[b] !== "000" ? "fixed" : ""}`} style={{ width: 20, height: 20 }}>{tr.protected[b]}</span>
                                <span style={{ fontSize: 9.5, color: tr.unprotected[b] !== v ? "var(--red)" : "var(--faint)" }}>raw {tr.unprotected[b]}</span>
                              </span>
                            );
                            return (
                              <td key={b} style={{ textAlign: "center", cursor: "pointer" }} onClick={() => setBit(b)}>{cell}</td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="legend" style={{ marginTop: 10 }}>
                <span><i style={{ background: "var(--red)" }} />flipped / wrong</span>
                <span><i style={{ background: "var(--amber)" }} />readout flip in syndrome</span>
                <span><i style={{ background: "var(--violet)" }} />non-trivial syndrome</span>
                <span><i style={{ background: "var(--green)" }} />correction / recovered</span>
                <span>“raw” = unprotected copy (same flip as qubit d0)</span>
              </div>
            </Card>
            <div className="col">
              <div className="grid g2">
                <Metric tone="red" label="Unprotected bit errors" value={data.stats.unprotected_bit_errors.count} unit={`/ ${data.stats.bits}`} hint={ci(data.stats.unprotected_bit_errors.ci95, 1)} />
                <Metric tone={data.stats.protected_bit_errors.count ? "amber" : "green"} label="Protected bit errors" value={data.stats.protected_bit_errors.count} unit={`/ ${data.stats.bits}`} hint={ci(data.stats.protected_bit_errors.ci95, 1)} />
                <Metric label="Blocks hit by noise" value={data.stats.blocks_with_errors} hint={`${data.stats.physical_flips} physical + ${data.stats.readout_flips} readout flips`} />
                <Metric tone={data.stats.logical_failures ? "red" : "green"} label="Decoding failures" value={data.stats.logical_failures} hint={`${data.stats.restored} restored · ${data.stats.recoverable_residual} recoverable residual`} />
              </div>
              <Card title="Overhead" icon={<CircuitBoard />}>
                <div className="kv">
                  <dt>per protected bit</dt><dd>{data.resources.per_bit.data_qubits} data + {data.resources.per_bit.ancilla_qubits} ancilla qubits, {data.resources.per_bit.two_qubit_gates} CNOTs, {data.resources.per_bit.measurements} measurements</dd>
                  <dt>concurrent qubits</dt><dd>{data.resources.concurrent_physical_qubits} (blocks processed sequentially)</dd>
                  <dt>whole message</dt><dd>{data.resources.total_two_qubit_gates} CNOTs · {data.resources.total_measurements} measurements</dd>
                  <dt>unprotected</dt><dd>1 qubit + 1 measurement per bit</dd>
                  <dt>correction</dt><dd>{data.resources.circuit_mode}</dd>
                </div>
              </Card>
              <Callout tone="sim">{data.scientific_boundary} Under high noise the protected copy fails too — two flips in one block beat a distance-3 code.</Callout>
            </div>
          </div>

          <Card title="Every bit" sub="Click any bit to inspect its block, syndrome, decoder evidence and circuit">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {data.chars.map((c) => (
                <div key={c.index} style={{ padding: 8, borderRadius: 10, border: "1px solid var(--line)", background: "rgba(4,8,15,0.35)" }}>
                  <div className="spread" style={{ marginBottom: 6 }}>
                    <span className="num" style={{ fontSize: 15, color: "var(--text)" }}>{c.char === " " ? "␠" : c.char}</span>
                    <span className="num muted" style={{ fontSize: 10.5 }}>{charHex(c.char)}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 3 }}>
                    {Array.from({ length: c.bit_end - c.bit_start }, (_, k) => c.bit_start + k).map((b) => {
                      const o = tr.outcome[b];
                      const color = tr.protected[b] !== data.bits[b] ? "var(--red)" : tr.flips[b] !== "000" || tr.readout[b] !== "00" ? (o === "restored" ? "var(--green)" : "var(--amber)") : "var(--line-2)";
                      return (
                        <button key={b} onClick={() => setBit(b)} title={`bit ${b}: ${data.bits[b]} · flips ${tr.flips[b]} · syndrome ${tr.observed_syndrome[b]} · ${o}`}
                          style={{ height: 16, borderRadius: 3, background: color, opacity: bit === b ? 1 : 0.85, outline: bit === b ? "2px solid #fff" : undefined }} aria-label={`Inspect bit ${b}`} />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="legend" style={{ marginTop: 10 }}>
              <span><i style={{ background: "var(--line-2)" }} />no noise</span>
              <span><i style={{ background: "var(--green)" }} />noise corrected (restored)</span>
              <span><i style={{ background: "var(--amber)" }} />recoverable residual</span>
              <span><i style={{ background: "var(--red)" }} />protected bit wrong</span>
            </div>
          </Card>
        </div>
      )}
      <Drawer open={bit !== null && !!data} onClose={() => setBit(null)} title={bit !== null ? `Bit ${bit}` : ""}>
        {bit !== null && data && tr && (() => {
          const v = data.bits[bit];
          const entry = data.decoder_table[tr.observed_syndrome[bit]];
          const block = (v ? "111" : "000").split("").map((x, k) => String(Number(x) ^ Number(tr.flips[bit][k]))).join("");
          return (
            <>
              <div className="row wrap">
                <span className="chip">value <b className="num">{v}</b></span>
                <span className="chip">encoded <b className="bits">{v ? "111" : "000"}</b></span>
                <OutcomeBadge outcome={tr.outcome[bit]} />
              </div>
              <div className="kv">
                <dt>physical flips (ground truth)</dt><dd>{tr.flips[bit]}</dd>
                <dt>block after noise</dt><dd>{block}</dd>
                <dt>ideal syndrome</dt><dd>{tr.ideal_syndrome[bit]}</dd>
                <dt>readout flips</dt><dd>{tr.readout[bit]}</dd>
                <dt>observed syndrome</dt><dd>{tr.observed_syndrome[bit]}</dd>
                <dt>decoder correction</dt><dd>{tr.correction[bit]} ({decoder})</dd>
                <dt>residual</dt><dd>{tr.residual[bit]}</dd>
                <dt>received (protected)</dt><dd>{tr.protected[bit]} {tr.protected[bit] === v ? "✓" : "✗"}</dd>
                <dt>received (unprotected)</dt><dd>{tr.unprotected[bit]} {tr.unprotected[bit] === v ? "✓" : "✗"}</dd>
              </div>
              {entry && (
                <Card title={`Why ${entry.correction} for syndrome ${tr.observed_syndrome[bit]}?`} sub={`energy gap ΔE = ${fix(entry.energy_gap, 3)} nats · seen ${entry.occurrences}× in this message`}>
                  <EnergyRanking candidates={entry.top} actual={tr.flips[bit]} />
                </Card>
              )}
              <a className="btn" href={href("/circuit", { state: v ? "one" : "zero", x: tr.flips[bit], ro: tr.readout[bit], decoder, mode: "pauli_frame", p: Math.max(p, 0.001), q })}>
                <CircuitBoard />Open this bit's circuit
              </a>
            </>
          );
        })()}
      </Drawer>
      {loading && data && <div className="muted pulse" style={{ fontSize: 12, marginTop: 8 }}>updating…</div>}
      <div className="sr-only"><Send /></div>
    </div>
  );
}
