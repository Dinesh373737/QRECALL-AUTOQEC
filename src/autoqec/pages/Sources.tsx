import { BookOpen, TriangleAlert } from "lucide-react";
import { Callout, Card, PageHead } from "../components/ui";

const SOURCES = [
  ["Google Quantum AI (2023)", "Suppressing quantum errors by scaling a surface code logical qubit. Nature 614, 676–681.", "https://doi.org/10.1038/s41586-022-05434-1", "Experiments analysed in Module 2; published per-round error rates shown for orientation."],
  ["Google Quantum AI (2022)", "Data for the paper above. Zenodo record 6804040, CC-BY-4.0.", "https://doi.org/10.5281/zenodo.6804040", "The mandatory real-hardware dataset (archive MD5 verified)."],
  ["Gidney (2021)", "Stim: a fast stabilizer circuit simulator. Quantum 5, 497.", "https://github.com/quantumlib/Stim", "Circuit/DEM parsing, measurement-to-detection conversion."],
  ["Higgott & Gidney (2025)", "Sparse Blossom: correcting a million errors per core second with minimum-weight matching. Quantum 9, 1600 (PyMatching 2).", "https://pymatching.readthedocs.io/", "Matching baseline, including enable_correlations in PyMatching 2.4."],
  ["Fujisaki et al. (2023)", "Quantum error correction with an Ising machine under circuit-level noise. arXiv:2308.00369.", "https://arxiv.org/abs/2308.00369", "Precedent for Ising-model decoding formulations."],
  ["Higgott, Bohdanowicz, Kubica, Flammia, Campbell", "Improved decoding of circuit noise and fragile boundaries of tailored surface codes (belief matching). arXiv:2203.04948.", "https://arxiv.org/abs/2203.04948", "Background for Google's belief-matching predictions."],
  ["Huggins, Khattar, Xu, Harrigan, Kang, Low, Fowler, Rubin, Babbush (2025)", "The FLuid Allocation of Surface code Qubits (FLASQ) cost model for early fault-tolerant quantum algorithms. arXiv:2511.08508.", "https://arxiv.org/abs/2511.08508", "Investigated; implemented in Qualtran (qualtran/surface_code/flasq). Not used: it prices lattice-surgery spacetime volume of FT algorithms."],
  ["IBM Quantum", "Repetition codes tutorial.", "https://quantum.cloud.ibm.com/docs/tutorials/repetition-codes", "Repetition-code conventions and circuits."],
  ["Qiskit / Qiskit Aer", "Circuit construction, transpilation, statevector and noisy simulation.", "https://www.ibm.com/quantum/qiskit", "Module 1 circuits, optimizer candidates and p_L estimates."],
  ["Huangfu & Hall (2018)", "HiGHS: parallelizing the dual revised simplex method; MILP solver used via SciPy.", "https://highs.dev/", "Exact solver for the Ising/QUBO decoding problem."],
  ["Bombín, Pant, Roberts, Seetharam (2024)", "Fault-tolerant post-selection for low-overhead magic state preparation. PRX Quantum 5, 010302 (arXiv:2212.00813).", "https://arxiv.org/abs/2212.00813", "Motivation for the complementary-gap ambiguity indicator."],
];

const LIMITS = [
  "Module 1 is simulation only: independent X and readout noise on a repetition code. It does not model leakage, crosstalk, correlated or non-Pauli noise, and the bit-flip code cannot correct Z errors.",
  "The energy gap and complementary gap are model-based ambiguity indicators. They are informative on held-out data here, but they are not calibrated probabilities and degrade under model mismatch.",
  "The exact Ising/QUBO decoder is evaluated on the first 5,000 (d = 3) or 2,000 (d = 5) real shots of every surface-code experiment with at most 5 rounds; longer experiments use PyMatching and Google's decoders only. Exact MILP decoding is far too slow for real-time use.",
  "Timings are software measurements on one laptop CPU, not real-time decoder hardware. Google's internal decoders have no published timings, so they cannot satisfy latency constraints in the advisor.",
  "The optimizer's p_L estimates come from Aer under a declared, simplified noise model (depolarizing gates, idle noise per layer, readout error). Compilation choices are not validated on hardware.",
  "Re-decoding Google's fixed historical measurements does not change the processor's qubit count, gates or depth; the advisor only ranks tested configurations and never extrapolates.",
  "Shot-level PyMatching reproduction is exact for 73 of 131 experiments; remaining differences occur on near-degenerate shots and are attributed (by probe) to the 2022 decoder implementation.",
  "The deployable subset contains real shots only; aggregate benchmarks were computed on the full archive and are served as recorded artifacts with checksums.",
];

export default function Sources() {
  return (
    <div className="fade-in">
      <PageHead module={0} kicker="Evidence" title="Sources & Limitations"
        lede="What we build on, what we claim, and what we explicitly do not claim." />
      <div className="grid g3">
        <Card title="Existing research we use" tone="teal"><p>Surface codes and repetition codes; matching decoders (PyMatching); Ising/energy formulations of decoding; noise-aware likelihood weights; detector error models; belief-matching and tensor-network decoders (Google's predictions).</p></Card>
        <Card title="Our engineering work" tone="cyan"><p>Interactive, computed decision traces; ambiguity indicators tested on held-out data; resource-aware circuit selection with verification; an integrated, reproducible real-data benchmark; failure investigation; and an evidence-only configuration advisor.</p></Card>
        <Card title="Claims we do not make" tone="red"><p>No quantum advantage. No hardware speedup from a classical solver. No new decoding algorithm. No physically verified hardware optimization. No perfect recovery. No unique physical diagnosis from a syndrome.</p></Card>
      </div>
      <h2 className="section-title"><BookOpen />Sources</h2>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Source</th><th>Work</th><th>How it is used</th></tr></thead>
          <tbody>{SOURCES.map(([who, what, url, use]) => (
            <tr key={url}><td style={{ color: "var(--text)", minWidth: 180 }}>{who}</td><td><a href={url} target="_blank" rel="noreferrer">{what}</a></td><td>{use}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <h2 className="section-title"><TriangleAlert />Known limitations</h2>
      <Card>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, color: "var(--text-2)" }}>{LIMITS.map((l, i) => <li key={i}>{l}</li>)}</ol>
      </Card>
      <Callout tone="info">The original QRecall associative-memory laboratory (Hopfield, Gibbs, QAOA) is preserved unchanged at <a href="/legacy.html">/legacy.html</a>.</Callout>
    </div>
  );
}
