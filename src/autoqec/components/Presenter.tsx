import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { navigate } from "../lib/router";
import type { Query } from "../lib/router";

interface Beat {
  title: string;
  text: string;
  path: string;
  query?: Query;
  seconds: number;
}

export const BEATS: Beat[] = [
  { title: "1 · Quantum information is fragile", seconds: 20, path: "/",
    text: "Physical qubits flip and dephase. Error correction spreads one logical qubit over many physical qubits and watches parity checks — syndromes — for clues." },
  { title: "2 · Run a real repetition-code experiment", seconds: 25, path: "/lab", query: { inject: "X1", state: "plus", p: 0.02, q: 0.02 },
    text: "We encode α|000⟩+β|111⟩, inject X on qubit 1, and the checks Z0Z1 and Z1Z2 both read −1: syndrome 11. Step through Encode → Verify; every state is a Qiskit statevector." },
  { title: "3 · Protect a message — and watch it fail honestly", seconds: 25, path: "/message", query: { message: "HELLO", p: 0.12, q: 0.02, seed: 7 },
    text: "Each bit of HELLO rides in its own 3-qubit block. Noise corrupts the unprotected copy; the protected copy recovers most bits — but two flips in one block still beat the code." },
  { title: "4 · Why did the decoder choose that correction?", seconds: 25, path: "/explainer", query: { syndrome: "10", p: 0.1, q: 0.08 },
    text: "All 8 candidate errors are ranked by negative log-likelihood energy. The gap ΔE says how much the runner-up loses — a model-based ambiguity indicator, not a probability of success." },
  { title: "5 · Choose a circuit under resource limits", seconds: 20, path: "/optimizer",
    text: "59 verified compilations of the SAME logical task. Hard constraints filter first; the normalized cost J ranks the rest. Fewer CNOTs does not automatically mean lower logical error." },
  { title: "6 · Switch to Google's real quantum processor data", seconds: 20, path: "/dataset",
    text: "131 published surface-code experiments from Zenodo, checksum-verified. Detection events were re-derived from raw measurements and our PyMatching run reproduces Google's predictions shot-for-shot on 73 experiments." },
  { title: "7 · Open one real experimental shot", seconds: 25, path: "/shots", query: { exp: "surface_code_bZ_d3_r05_center_3_5", shot: 7 },
    text: "This is a single shot from Sycamore: detector events in space and time, and the recorded logical flip kept separate as the answer key." },
  { title: "8 · How PyMatching and our Ising decoder decided", seconds: 25, path: "/shots", query: { exp: "surface_code_bZ_d3_r05_center_3_5", shot: 7, overlay: "both" },
    text: "PyMatching matched detector pairs; the noise-aware Ising/QUBO decoder solved the exact syndrome-constrained hypergraph problem. We show what each decoder inferred — not a diagnosis of the physical defect." },
  { title: "9 · Held-out benchmarks and their limits", seconds: 30, path: "/hw-benchmarks",
    text: "Every method is scored on identical real shots with Wilson intervals and paired McNemar tests. Models are calibrated on even shots and tested on odd ones. Where PyMatching wins, we say so." },
  { title: "10 · Reliability, explainability, resources", seconds: 15, path: "/advisor",
    text: "The advisor recommends only experimentally tested configurations — or says “No tested configuration meets these constraints.” Explainable decisions, honest uncertainty, real hardware evidence." },
];

export function Presenter({ onExit }: { onExit: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    navigate(BEATS[i].path, BEATS[i].query);
  }, [i]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Escape") onExit();
      if (e.key === "ArrowRight" || e.key === "PageDown") setI((v) => Math.min(BEATS.length - 1, v + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onExit]);
  const beat = BEATS[i];
  const total = BEATS.reduce((s, b) => s + b.seconds, 0);
  return (
    <div className="presenter-bar" role="dialog" aria-label="Presentation mode">
      <div className="presenter-progress">{BEATS.map((_, k) => <i key={k} className={k <= i ? "on" : ""} />)}</div>
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="presenter-title">{beat.title}</div>
          <div className="presenter-text">{beat.text}</div>
        </div>
        <div className="row" style={{ flex: "none" }}>
          <span className="num muted" style={{ fontSize: 11 }}>~{beat.seconds}s · {Math.round(total / 60)} min total</span>
          <button className="btn icon" onClick={() => setI(Math.max(0, i - 1))} aria-label="Previous beat" disabled={i === 0}><ChevronLeft /></button>
          <button className="btn primary" onClick={() => (i === BEATS.length - 1 ? onExit() : setI(i + 1))}>
            {i === BEATS.length - 1 ? "Finish" : "Next"}<ChevronRight />
          </button>
          <button className="btn icon ghost" onClick={onExit} aria-label="Exit presentation"><X /></button>
        </div>
      </div>
    </div>
  );
}
