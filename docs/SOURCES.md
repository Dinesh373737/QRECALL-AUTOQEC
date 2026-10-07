# Sources and implementation references

The mathematical conventions are defined in [MATH_SPEC.md](../MATH_SPEC.md) and checked by independent tests. These primary references support the implemented model and library usage.

| Source | Relevance |
|---|---|
| [Hopfield (1982), PNAS](https://www.pnas.org/doi/10.1073/pnas.79.8.2554) | Content-addressable memory, symmetric interactions and asynchronous dynamics. |
| [Ackley, Hinton and Sejnowski (1985)](https://www.cs.toronto.edu/~hinton/absps/cogscibm.pdf) | Stochastic binary units and temperature; QRecall uses Gibbs sampling of fixed Hebbian energy rather than a trained hidden-unit Boltzmann machine. |
| [Farhi, Goldstone and Gutmann (2014)](https://arxiv.org/abs/1411.4028) | QAOA alternating cost/mixer unitaries and expected-energy objectives. MaxCut bounds are not applied to memory recall. |
| [IBM QAOA tutorial](https://quantum.cloud.ibm.com/docs/en/tutorials/quantum-approximate-optimization-algorithm) | Ising mapping, variational circuits and sampling. Execution here uses local simulation, not a hardware session. |
| [Qiskit circuit API](https://quantum.cloud.ibm.com/docs/en/api/qiskit/circuit) | Actual circuit construction. |
| [RZZGate](https://quantum.cloud.ibm.com/docs/en/api/qiskit/qiskit.circuit.library.RZZGate) | Rotation convention checked against independent gate/unitary calculations. |
| [Statevector](https://quantum.cloud.ibm.com/docs/en/api/qiskit/qiskit.quantum_info.Statevector) | Complex amplitudes and actual gate-by-gate evolution. |
| [AerSimulator](https://qiskit.github.io/qiskit-aer/stubs/qiskit_aer.AerSimulator.html), [NoiseModel](https://qiskit.github.io/qiskit-aer/stubs/qiskit_aer.noise.NoiseModel.html) | Finite-shot simulation and optional depolarizing/readout noise. |
| [FastAPI request bodies](https://fastapi.tiangolo.com/tutorial/body/) | Typed, bounded HTTP contracts. |
| [React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/introduction) | React/Three.js integration. |
| [KaTeX API](https://katex.org/docs/api) | Formula rendering and error handling. |

## Scientific and reuse boundaries

The shared energy, clamping assumptions, gate signs and basis mapping follow the repository's explicit tested conventions. Finite-shot simulation is not quantum hardware execution. No hardware speedup or quantum-advantage evidence is established.

Scenes are original Three.js/SVG implementations. No third-party creator code, video footage, paper figures or animation assets are embedded. Libraries retain their own dependency licenses. External links are references rather than required runtime services.
