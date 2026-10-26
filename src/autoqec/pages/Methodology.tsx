import { Fingerprint, FlaskConical, Cpu, Scale, Sigma } from "lucide-react";
import { useApi } from "../lib/api";
import { fix, int } from "../lib/format";
import { Callout, Card, Eq, Kv, Loading, PageHead, ProvenanceBadge } from "../components/ui";

export default function Methodology() {
  const prov = useApi<any>("/provenance");
  const summary = useApi<any>("/google/benchmarks/summary");
  const probe = summary.data?.baseline?.probe;
  const ds = prov.data?.dataset;
  return (
    <div className="fade-in">
      <PageHead module={0} kicker="Evidence" title="Methodology & Provenance"
        lede="How every number in AutoQEC is produced: the models, the data, the splits, the statistics and the exact software versions — and which numbers are simulated versus measured on hardware." />
      <div className="grid g2">
        <Card title="Module 1 · simulation" icon={<FlaskConical />} tone="violet">
          <p>Three-qubit (and, in benchmarks, 5- and 7-qubit) bit-flip repetition codes. Independent Bernoulli X flips with probability p<sub>i</sub> per data qubit and syndrome readout flips with probability q<sub>j</sub> per check, drawn from separate seeded PCG64 streams. Quantum states are Qiskit statevectors evolved gate by gate; circuit metrics are recursive Qiskit counts; the optimizer's p<sub>L</sub> comes from Aer under a declared noise model.</p>
          <div className="row wrap" style={{ marginTop: 10 }}><ProvenanceBadge kind="simulation" /><span className="chip">no hardware execution</span></div>
        </Card>
        <Card title="Module 2 · real hardware data" icon={<Cpu />} tone="teal">
          <p>Google Quantum AI's published surface-code memory experiments on a Sycamore processor (distance 3 at four patch locations, distance 5, X and Z bases, 1–25 rounds, 50,000 shots each; plus a distance-25 repetition code with 500,000 shots). Detection events, recorded logical flips and Google's decoder predictions are read from the official archive.</p>
          <div className="row wrap" style={{ marginTop: 10 }}><ProvenanceBadge kind="hardware" /><span className="chip">DOI 10.5281/zenodo.6804040</span></div>
        </Card>
      </div>

      <h2 className="section-title"><Sigma />Models</h2>
      <div className="grid g2">
        <Card title="Explainable energy decoder (Module 1)">
          <Eq tex={String.raw`E(e\mid y) = -\sum_i\big[e_i\ln p_i + (1-e_i)\ln(1-p_i)\big] - \sum_j\big[d_j\ln q_j + (1-d_j)\ln(1-q_j)\big],\ \ d = y\oplus He`} />
          <p>All 2<sup>n</sup> candidates are enumerated. Ranking ties break on energy (rounded to 10⁻¹²), Hamming weight, then the binary string. ΔE = E₍₂₎ − E₍₁₎. The exact reference maximizes P(logical value survives | y) using direct probability products (an independent implementation).</p>
          <p><b>Recovery convention.</b> The residual r = e ⊕ ê is judged after an ideal final round (noiseless readout + majority): r = 0 restores the codeword; weight(r) ≤ (n−1)/2 keeps the logical value; otherwise a logical X̄ occurred. We do not use an even/odd-weight rule, which would misclassify a single leftover flip.</p>
        </Card>
        <Card title="Syndrome-constrained Ising/QUBO decoder (Module 2)">
          <Eq tex={String.raw`\min_{x\in\{0,1\}^M}\ \sum_i w_i x_i \ \ \text{s.t.}\ \ \sum_{i\in N(j)} x_i \equiv s_j \pmod 2\ \ \forall j,\qquad w_i = \ln\frac{1-p_i}{p_i}`} />
          <p>Variables are fault mechanisms of Google's detector error model; each mechanism's full detector set is the XOR of stim's suggested decomposition (hyperedges kept, duplicates merged by independent XOR). The prediction is the observable parity of the minimizer — most-likely-error decoding. With spins s = 1 − 2x each parity constraint is a multi-body Ising condition; the equivalent QUBO uses binary slack variables and a penalty above Σ|w|. We solve it exactly with HiGHS branch-and-bound (10 s limit per solve; never reported as optimal if unproven). <b>Uniform</b> weighting sets w<sub>i</sub> = 1.</p>
          <Eq tex={String.raw`\text{complementary gap} = \min_{x:\,L x = 1-\hat\ell} E(x) - \min_x E(x)`} />
        </Card>
      </div>

      <h2 className="section-title"><Scale />Splits, fairness and statistics</h2>
      <div className="grid g3">
        <Card title="No train/test leakage">
          <p>Google's pij models were estimated from detection events of one shot parity. Noise-aware Ising, PyMatching (pij) and correlated PyMatching decode odd shots with <code>pij_from_even_for_odd.dem</code> and even shots with <code>pij_from_odd_for_even.dem</code>. Observable flips are used only to score.</p>
        </Card>
        <Card title="Identical shots">
          <p>Every comparison uses the same shot indices for every method (shot-index alignment is checked when loading). Differences are tested with the exact McNemar test and a seeded paired bootstrap; a method is called better only at p &lt; 0.05.</p>
        </Card>
        <Card title="Held-out thresholds">
          <p>Ambiguity thresholds (energy gap, complementary gap) are chosen on validation data — a separate seed in Module 1, even shots in Module 2 — and frozen before the held-out set (odd shots / a new seed) is evaluated.</p>
        </Card>
      </div>

      <h2 className="section-title"><Fingerprint />Reproduction of Google's PyMatching predictions</h2>
      <Card>
        <p>For all 131 experiments, detection events and observable flips were re-derived from raw measurements and sweep bits with Stim and matched Google's files bit-for-bit. Re-running PyMatching ({prov.data?.versions?.pymatching}) with <code>circuit_detector_error_model.dem</code> reproduces Google's published predictions shot-for-shot in {summary.data?.baseline?.reproduced_exactly ?? "…"} experiments. In the longer runs a small number of shots differ (at most {int(summary.data?.baseline?.max_disagreements)} of 50,000).</p>
        {probe ? (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data">
              <thead><tr><th>Probed experiment</th><th className="num">disagreeing shots</th><th className="num">probed</th><th className="num">ours = exact optimum</th><th className="num">Google = exact optimum</th><th className="num">median gap (disagree / agree)</th></tr></thead>
              <tbody>{probe.map((p: any) => (
                <tr key={p.experiment}><td className="num">{p.experiment}</td><td className="num">{p.disagreements}</td><td className="num">{p.probed}</td><td className="num">{p.ours_equals_exact_optimum}</td><td className="num">{p.google_equals_exact_optimum}</td><td className="num">{fix(p.gap_disagreeing_median, 3)} / {fix(p.gap_agreeing_median, 3)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Callout tone="info">Probe artifact not recorded yet (python -m backend.hardware.pipeline probe).</Callout>}
        <div className="field-help" style={{ marginTop: 8 }}>The probe solves the matching problem exactly (MILP on PyMatching's own float edge weights). Disagreeing shots are near-degenerate, and our run returns the exact optimum on them — consistent with an implementation/version difference in Google's 2022 run, not a data-handling error.</div>
      </Card>

      <h2 className="section-title"><Fingerprint />Software and artifacts</h2>
      {!prov.data ? <Loading /> : (
        <div className="grid g2">
          <Card title="Versions">
            <Kv rows={Object.entries(prov.data.versions).map(([k, v]) => [k, String(v)])} />
            {ds && <div className="divider" />}
            {ds && <Kv rows={[["dataset", ds.title], ["DOI", ds.doi], ["archive MD5", ds.archive.md5], ["active layout", ds.active_layout ?? "none"]]} />}
          </Card>
          <Card title="Recorded artifacts" sub="SHA-256 of every result file served by the API">
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
              <table className="data">
                <thead><tr><th>File</th><th className="num">bytes</th><th>sha256</th></tr></thead>
                <tbody>{prov.data.artifacts.map((a: any) => <tr key={a.path}><td className="num">{a.path}</td><td className="num">{int(a.bytes)}</td><td className="num" style={{ fontSize: 11 }}>{a.sha256.slice(0, 16)}…</td></tr>)}</tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
      <Callout tone="info">Regenerate everything with <code>python -m backend.hardware.pipeline all</code> (Module 2) and <code>python -m backend.generate_qec_results</code> (Module 1). Seeds, shot ranges, partitions and versions are written into every artifact.</Callout>
    </div>
  );
}
