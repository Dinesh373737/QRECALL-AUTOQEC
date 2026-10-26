import {
  ArrowRight,
  ChartColumn,
  ChartLine,
  CircuitBoard,
  Cpu,
  Database,
  FlaskConical,
  MessageSquareText,
  Microscope,
  Orbit,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { href } from "../lib/router";
import { useApi } from "../lib/api";
import { int, pct } from "../lib/format";
import { Callout, Metric } from "../components/ui";

function HeroArt() {
  // A stylized space-time slice of a distance-3 surface code: data qubits, checks and a few fired detectors.
  const pts = [];
  for (let t = 0; t < 5; t++)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) pts.push({ x: 120 + i * 70 + t * 34, y: 70 + j * 70 + t * 30, t });
  const fired = new Set(["1-1-2", "2-0-1", "3-2-2", "3-1-1"]);
  return (
    <svg className="hero-art" viewBox="0 0 560 460" aria-hidden="true">
      <defs>
        <radialGradient id="hfire" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a58bff" stopOpacity="1" />
          <stop offset="100%" stopColor="#a58bff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((t) => (
        <g key={t} opacity={0.25 + t * 0.15}>
          <path d={`M${120 + t * 34},${70 + t * 30} h140 v140 h-140 z`} fill="none" stroke="#26365a" />
          <path d={`M${190 + t * 34},${70 + t * 30} v140 M${120 + t * 34},${140 + t * 30} h140`} stroke="#1d2a47" />
        </g>
      ))}
      {pts.map((p, k) => {
        const key = `${p.t}-${Math.round((p.x - 120 - p.t * 34) / 70)}-${Math.round((p.y - 70 - p.t * 30) / 70)}`;
        const on = fired.has(key);
        return (
          <g key={k}>
            {on && <circle cx={p.x} cy={p.y} r={22} fill="url(#hfire)" opacity={0.7}><animate attributeName="r" values="16;24;16" dur="2.4s" repeatCount="indefinite" /></circle>}
            <circle cx={p.x} cy={p.y} r={on ? 6 : 3.4} fill={on ? "#d9ccff" : "#5ad8ef"} opacity={on ? 1 : 0.55} />
          </g>
        );
      })}
      <path d="M224,191 Q260,230 292,261" stroke="#3fd0b0" strokeWidth="2" fill="none" strokeDasharray="5 4" />
      <path d="M326,291 Q330,320 362,331" stroke="#3fd0b0" strokeWidth="2" fill="none" strokeDasharray="5 4" />
    </svg>
  );
}

const M1 = [
  { path: "/lab", icon: FlaskConical, label: "QEC Lab", text: "Encode → inject → measure → decode → correct → verify, with real Qiskit states." },
  { path: "/message", icon: MessageSquareText, label: "Message Lab", text: "Send a message through noisy qubits with and without protection." },
  { path: "/circuit", icon: CircuitBoard, label: "Circuit Inspector", text: "Step through the actual circuit, feed-forward and transpiled form." },
  { path: "/explainer", icon: Microscope, label: "Decoder Explainer", text: "Every candidate error, its energy terms, and why one wins." },
  { path: "/optimizer", icon: SlidersHorizontal, label: "Resource Optimizer", text: "Hard constraints + normalized cost over verified compilations." },
  { path: "/sim-benchmarks", icon: ChartLine, label: "Simulation Benchmarks", text: "Failure curves, oracle agreement and held-out margin tests." },
];
const M2 = [
  { path: "/dataset", icon: Database, label: "Dataset Explorer", text: "131 Google surface-code experiments, verified and reproducible." },
  { path: "/shots", icon: Orbit, label: "Real Shot Explorer", text: "A single hardware shot in space-time, with each decoder's evidence." },
  { path: "/hw-benchmarks", icon: ChartColumn, label: "Decoder Benchmarks", text: "PyMatching vs Ising/QUBO vs Google's decoders on identical shots." },
  { path: "/failures", icon: ScanSearch, label: "Failure Investigator", text: "Disagreements and confident failures, drilled down to the shot." },
  { path: "/advisor", icon: Target, label: "Configuration Advisor", text: "Recommendations limited to experimentally tested configurations." },
];

export default function Home() {
  const { data: baseline } = useApi<any>("/google/benchmarks/baseline");
  const { data: status } = useApi<any>("/google/status");
  const { data: summary } = useApi<any>("/google/benchmarks/summary");
  const repro = summary?.baseline?.published_reproduction;
  const exps: any[] = baseline?.experiments ?? [];
  const shots = exps.reduce((s, e) => s + e.shots_evaluated, 0);
  const reproduced = exps.filter((e) => e.reproduction?.reproduced).length;
  const integrity = exps.filter((e) => e.integrity?.detection_events_match && e.integrity?.observables_match).length;
  const maxGap = exps.reduce((m, e) => {
    const a = e.methods?.pymatching_circuit?.rate;
    const b = e.methods?.google_pymatching?.rate;
    return a === undefined || b === undefined ? m : Math.max(m, Math.abs(a - b));
  }, 0);
  return (
    <div className="col gap-lg fade-in">
      <section className="hero grid-bg">
        <HeroArt />
        <div style={{ position: "relative" }}>
          <div className="page-kicker">Q-Hack India 2026 · Quantum error correction</div>
          <h1>Understand quantum errors. <em>Explain recovery decisions.</em></h1>
          <p className="tagline">
            Optimize resources. Benchmark on real quantum hardware. QRecall AutoQEC turns error correction into an
            inspectable experiment — from a three-qubit lab you can step through, to genuine shots measured on Google's
            superconducting processor.
          </p>
          <div className="row wrap" style={{ marginTop: 22 }}>
            <a className="btn primary" href={href("/lab")}><FlaskConical />Open the QEC Lab</a>
            <a className="btn teal" href={href("/shots", { exp: "surface_code_bZ_d3_r05_center_3_5", shot: 7 })}><Orbit />Explore a real Google shot</a>
            <a className="btn" href={href("/methodology")}><ShieldCheck />Methodology & provenance</a>
          </div>
        </div>
      </section>

      <div className="grid g4">
        <Metric tone="teal" label="Real experiments" value={exps.length || "—"} hint={status?.active_layout === "full" ? "full official archive" : "deployable subset of real shots"} />
        <Metric tone="teal" label="Hardware shots decoded" value={shots ? int(shots) : "—"} hint="every shot of every experiment, PyMatching ×3 configurations" />
        <Metric tone="cyan" label="Raw-data integrity" value={exps.length ? `${integrity}/${exps.length}` : "—"} hint="detection events re-derived from measurements match exactly" />
        <Metric tone="violet" label="Shot-exact PyMatching reproduction" value={exps.length ? `${reproduced}/${exps.length}` : "—"}
          hint={exps.length ? `others differ only on near-degenerate shots; max failure-rate difference ${pct(maxGap, 2)}` : "see Decoder Benchmarks"} />
      </div>

      {repro?.distance_5 && (
        <Callout tone="hw">
          <b>Published result reproduced from raw hardware data.</b> Fitting Google's tensor-network predictions gives a logical
          error per round of <b>{pct(repro.distance_5, 3)}</b> at distance 5 versus <b>{pct(repro.distance_3, 3)}</b> at distance 3
          (Nature 2023 reports 2.914% and 3.028%). <a href={href("/hw-benchmarks")}>See the decoder benchmarks</a>
        </Callout>
      )}

      <div className="grid g2">
        <section className="module-card">
          <div className="row"><span className="badge sim">Module 1 · Simulation</span><span className="num-badge">6 pages</span></div>
          <h3>QEC Interactive Studio</h3>
          <p style={{ marginTop: 6 }}>Shows <b style={{ color: "var(--text)" }}>how decoding works</b>: a three-qubit bit-flip code, an explicit likelihood (energy) decoder with exact references, and resource-aware circuit selection.</p>
          <div className="col" style={{ gap: 2, marginTop: 12 }}>
            {M1.map((p) => {
              const I = p.icon;
              return <a key={p.path} className="page-link" href={href(p.path)}><I /><span style={{ minWidth: 150, color: "var(--text)" }}>{p.label}</span><span className="muted" style={{ fontSize: 12 }}>{p.text}</span></a>;
            })}
          </div>
        </section>
        <section className="module-card">
          <div className="row"><span className="badge hw">Module 2 · Experimental data</span><span className="num-badge">5 pages</span></div>
          <h3>Google Hardware QEC Analyzer</h3>
          <p style={{ marginTop: 6 }}>Shows <b style={{ color: "var(--text)" }}>how decoding performs on real hardware</b>: Google's published surface-code memory experiments (Zenodo 10.5281/zenodo.6804040), decoded and explained shot by shot.</p>
          <div className="col" style={{ gap: 2, marginTop: 12 }}>
            {M2.map((p) => {
              const I = p.icon;
              return <a key={p.path} className="page-link" href={href(p.path)}><I /><span style={{ minWidth: 150, color: "var(--text)" }}>{p.label}</span><span className="muted" style={{ fontSize: 12 }}>{p.text}</span></a>;
            })}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-body">
          <div className="grid g3" style={{ alignItems: "stretch" }}>
            <div className="col" style={{ gap: 8 }}>
              <div className="page-kicker" style={{ marginBottom: 0 }}>The problem</div>
              <p>Physical qubits suffer bit and phase flips. Error correction measures stabilizer parities — <b style={{ color: "var(--text)" }}>syndromes</b> — and a decoder must infer a correction. Decoders rarely explain themselves, can disagree, and compete for qubits, gates, depth and time.</p>
            </div>
            <div className="col" style={{ gap: 8 }}>
              <div className="page-kicker" style={{ marginBottom: 0, color: "var(--violet)" }}>Our engineering contribution</div>
              <p>Interactive decision traces, energy-ranked explanations with ambiguity indicators tested on held-out data, resource-aware circuit selection, an integrated real-data benchmark, failure investigation, reproducibility and an evidence-only configuration advisor.</p>
            </div>
            <div className="col" style={{ gap: 8 }}>
              <div className="page-kicker" style={{ marginBottom: 0, color: "var(--amber)" }}>What we do not claim</div>
              <p>No quantum advantage, no hardware speedup, no new decoding algorithm. Surface codes, matching, Ising/energy formulations and noise-aware likelihoods are prior research. Where PyMatching wins, the benchmarks say so.</p>
            </div>
          </div>
        </div>
      </section>

      <Callout tone="info">
        <b>Two modules, one vocabulary.</b> Both modules use the same terms (syndrome, detector, candidate, energy = negative
        log-likelihood, gap, logical outcome) and the same provenance badges:{" "}
        <span className="badge sim">Simulation</span> <span className="badge hw"><Cpu />Google hardware data</span>{" "}
        <span className="badge live">Computed live</span> <span className="badge rec">Recorded run</span>.
        <a href={href("/lab")} style={{ marginLeft: 8 }}>Start in the QEC Lab <ArrowRight style={{ width: 13, height: 13, verticalAlign: -2 }} /></a>
      </Callout>
    </div>
  );
}
