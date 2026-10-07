# QRecall scientific conventions

This document specifies the implemented model and decision rules. The scientific core is independent of React and Three.js. Renderers consume computed events; they do not update solver states themselves. Primary references and inspected APIs are recorded in [docs/SOURCES.md](docs/SOURCES.md).

## Encoding, weights and energy

Pixels are spins `s_i ∈ {−1,+1}`. Bits are `x_i ∈ {0,1}`, with `s_i = 1 − 2x_i`. A filled pixel is **+1 / bit 0**. Row-major global pixel index is `i = row × cols + col`.

For stored spin patterns `ξ^μ` on `n = rows × cols` pixels:

```text
W_ij = (1/n) Σ_μ ξ_i^μ ξ_j^μ    for i ≠ j
W_ii = 0
E(s) = −½ sᵀWs − bᵀs
     = −Σ_{i<j} W_ij s_i s_j − Σ_i b_i s_i
```

`W` is symmetric with a zero diagonal. The normalization always uses the original total pixel count `n`, including when a cue leaves fewer free variables. There is no normalization by memory count or free-variable count. The optional base bias `b` defaults to zero. Energy and temperature use arbitrary normalized energy units, with Boltzmann's constant absorbed into the temperature convention.

The API permits up to 16 total pixels, eight memories and eight free variables. The interactive demos use a 4×4 masked system or a 2×4 whole system. Exact state enumeration has at most `2^8 = 256` states.

## Trusted observations and soft noisy cues

Let `C` be the trusted observed indices and `F` the ordered complement. Trusted pixels keep their cue spin `y_j` throughout every method. Eliminating them produces:

```text
h_i = b_i + Σ_{j∈C} W_ij y_j                 for i∈F
E_const = −½ y_Cᵀ W_CC y_C − b_Cᵀ y_C
E_F(s_F) = E_const − Σ_{i<j∈F} W_ij s_i s_j − Σ_{i∈F} h_i s_i
```

Every enumerated reduced-state energy equals the energy of its reconstructed full clamped state. The same weights, fields and constant feed Hopfield, Gibbs, QAOA and exact references. With no free pixels, the cue returns directly: no circuit is executed, actual circuit shots are zero, and there is no measurement accumulation trace.

In noisy mode, every pixel is free. On observed indices `O`, the full bias becomes:

```text
b_i' = b_i + λ r_i y_i        if i∈O
b_i' = b_i                   otherwise
```

Reliability `r_i` is a model weight between zero and one; it is not a calibrated confidence score. `λ` is the cue-strength parameter. Soft noisy cues are never clamped. Missing observations contribute no cue field. Input corruption, thermal temperature and quantum device error are separate controls.

Known cue spins initialize observed pixels, including untrusted noisy observations. Missing initial spins are sampled from the seed. Initialization, random Hopfield order and Gibbs draws use separate seeded streams; none use the generating memory's identity.

## Asynchronous Hopfield updates

For a selected free pixel, using the current spins:

```text
u_i = Σ_j W_ij s_j + b_i'
s_i' = +1 if u_i > 0
s_i' = −1 if u_i < 0
s_i' = s_i if u_i = 0
ΔE = −(s_i' − s_i) u_i ≤ 0
```

Updates are asynchronous: each committed spin change affects the next field calculation. Sequential or seeded random order is explicit in the configuration. A zero-field tie retains the current spin. A sweep with no changes establishes convergence. A bounded run that reaches its sweep limit returns its last state with `converged=false` and a warning; it does not claim convergence.

Trace events contain the actual selected pixel, before/after states, neighbor contributions, local field and energy change. Trusted pixels are never selected. The recall decision is the final Hopfield state, with convergence status retained.

## Gibbs sampling and exact thermal reference

At strictly positive temperature `τ`, a selected free pixel is drawn using:

```text
P(s_i'=+1 | s_{−i}) = sigmoid(2u_i/τ)
s_i' = +1 if seeded uniform draw < P(+1), else −1
P_exact(s_F) = exp(−E_F(s_F)/τ) / Σ_t exp(−E_F(t)/τ)
```

The implementation uses a stable sigmoid and a shifted log-sum-exp normalization for the exact distribution. Large temperature approaches a uniform distribution; decreasing temperature concentrates exact Gibbs mass on ground states, including tied minima.

One Gibbs sweep updates every free variable once. Burn-in counts complete initial sweeps that are discarded. Thinning `k` retains a state after each `k` subsequent sweeps; `samples` counts retained states. The modal state among retained counts is the reconstruction. The final chain state is also exported but does not decide recall. The API bounds complete trace generation to 8192 individual updates per request.

Trace events retain actual probabilities, seeded random draws and energy changes, including genuine uphill updates. Retained draws from one chain may be correlated; they are not counted as independent benchmark trials. Exact Gibbs is a visible analytic diagnostic and does not replace the sampler.

## Ising mapping and QAOA operator order

Local qubit `a` represents global free pixel `F[a]`; Pauli `Z_a` has the same eigenvalue as that pixel's spin. The cost Hamiltonian is:

```text
H_C = E_const I − Σ_{a<b} W_{F[a],F[b]} Z_a Z_b − Σ_a h_{F[a]} Z_a
H_M = Σ_a X_a
|ψ_0⟩ = |+⟩^|F|
|ψ_k⟩ = exp(−i β_k H_M) exp(−i γ_k H_C) |ψ_{k−1}⟩
```

Each layer applies cost and then mixer. With Qiskit's rotation definitions, the actual gates are:

```text
RZZ_ab(−2 γ_k W_{F[a],F[b]})
RZ_a(−2 γ_k h_{F[a]})
RX_a(2 β_k)
```

The conditioning constant contributes global phase `−γ_k E_const` to the circuit and remains in every reported objective. Cost gates change relative phases while preserving every basis probability. Mixer gates mix amplitudes and can redistribute probabilities through interference. Circuit parameters `β_k` are distinct from thermal temperature `τ`. QAOA does not generally prepare a Gibbs distribution.

Qiskit Statevector evolves the actual gate operations. Playback exports initialization, each cost/mixer gate and layer-boundary snapshots, including complex amplitudes, probabilities, relative phases, gate angles and local/global qubit indices. Relative phase is measured from the first amplitude whose magnitude exceeds `1e−12`; smaller amplitudes have undefined phase (`null`). Statevector probabilities must remain normalized. Independent tests compare Hamiltonian diagonals and gate unitaries with the classical model, typically at absolute tolerance `1e−12`.

## Basis order, finite shots and measurement playback

For local bits `x_a`, the statevector basis integer is:

```text
j = Σ_a x_a 2^a
```

The UI lists logical free-pixel bits from lowest local index first. Qiskit measurement strings list the highest local index first. The tested `counts_to_integers` utility is the conversion boundary; algorithms and plots use integer-string count keys such as `"2"`.

For example, if `F=[1,5]`, Qiskit's count string `"10"` is integer 2. Its logical bits are `[0,1]`: pixel 1 has spin +1 and pixel 5 has spin −1. Trusted pixels are restored from the cue when reconstructing the full pattern.

Finite shots come from the measured Aer circuit with an explicit simulator seed. Aer also returns one shot-memory string per shot. Measurement playback counts prefixes of that actual returned memory order, in at most 16 batches. Each prefix contains its true shot count, histogram, modal state, tie list and full reconstructed pattern. The last prefix exactly equals the final exported counts and output. No artificial measurement ordering is generated.

Gibbs and QAOA choose the modal sampled basis state. If several states have the same largest count, the lowest integer wins; the tied states remain reported. Neither the source-memory identity nor the lowest sampled energy resolves this tie. Ideal probability and empirical shot frequency are exported separately; neither is correctness confidence.

## Bounded optimization and optional noise

QAOA supports depths one to three. Angle optimization uses one seeded COBYLA run on the ideal expected conditioned energy `Σ_j P(j) E_F(j)`. It does not optimize recovery of a named memory. Initial `γ` values are drawn uniformly from `[−π,π]` and `β` from `[−π/2,π/2]`; the same intervals bound the search.

The fixed evaluation budget is between 4 and 128 and must be at least `2p+2`. Initial angles, every objective evaluation, best-so-far value, actual evaluation count and stop reason are returned. Manual angles remain supported. Compilation, simulation, optimization time, gate count, circuit depth, qubits and shots are separate resource fields. Equal numeric resource counts across methods do not imply equal computational budgets.

Optional Aer noise applies the configured depolarizing parameter to one-qubit `H/RZ/RX` gates and two-qubit `RZZ` gates, plus a symmetric readout-error probability. No hardware calibration is claimed. Noise runs sample a density-matrix simulation at the actual small problem width. Optimization still uses the ideal expectation and is labeled accordingly.

The noisy sampled histogram represents the noisy circuit. Amplitude and phase playback remains explicitly the ideal pure-state lesson; it is not described as the phase of a noisy mixed state. Ideal expected energy and noisy sampled energy are distinct outputs.

## Derived mathematical diagnostics

The backend derives lesson data from the exported ideal snapshots without changing or renormalizing solver outputs:

```text
amplitude_norm = sqrt(Σ_j |α_j|²)
probability_sum = Σ_j P_j
⟨H_C⟩ = Σ_j P_j E_j
Var(H_C) = Σ_j P_j (E_j − ⟨H_C⟩)²
S_basis = −Σ_{j:P_j>0} P_j log₂(P_j)
N_effective = 1 / Σ_j P_j²
```

Norm and probability sum should be one within numerical tolerance. The centered variance avoids cancellation from subtracting large squared moments; if a second moment exceeds finite numerical range it is explicitly unavailable (`null`). Basis Shannon entropy and inverse participation describe spread in the computational basis, not entanglement or memory-recovery confidence. A uniform distribution on q free qubits has S_basis = q bits and N_effective = 2^q. A single occupied basis state has zero entropy/energy variance and one effective state.

Each enumerated state's conditioned energy is also exported as the trusted-pixel constant, free-pair contribution and free-field contribution. Their sum equals the already-computed state energy. These diagnostics accept no evaluation target. Optional noisy shots remain separate from every ideal-state summary. Raw complex amplitudes on the Argand plane include global phase; playback relative phase still uses the reference convention above. A fully observed cue has a singleton mathematical state and no circuit execution or measured histogram.

## Evaluation, references and reproducibility

Only the evaluator accepts the source-memory index. Solver configurations reject target/source identity. Exact recovery means the full reconstruction equals the generating memory; bit error is reported over all pixels and separately over free pixels. Constraint violations, unintended stored memories, spurious states, expected/sample energies, optimum gaps and source-state probabilities are separate metrics.

Nearest-memory matching uses only observed pixels, with reliability-weighted Hamming distance in noisy mode. Equal scores retain all tied bank indices and select the lowest bank index. Exact minimum energy and exact Gibbs remain visible diagnostics; exact energy ties select the lowest local basis integer. A lower energy does not imply successful source recovery.

Each benchmark trial generates a cue and an independent solver seed before evaluation. The unit of repetition is a generated cue case, not an individual correlated Gibbs draw or circuit shot. Recovery intervals use the Wilson score method across cases. Preset curation and reported benchmark seeds are separate, and benchmark configurations are not chosen after seeing their outcomes.

Exports record schema version, configuration, seeds, free/global mapping, weights, fields, circuit metadata, counts, package versions and timing provenance. Scientific source digests accompany recorded benchmark artifacts. A meaningful configuration edit increments the frontend revision; results from an older revision are ignored. Recorded replay is labeled and retains its original computation metadata.

The [source notes](docs/SOURCES.md), [benchmark definitions](docs/BENCHMARK.md) and [actual results](results/benchmark.json) provide the remaining context. Statevector calculation is a classical simulation with exponential state space; these deliberately small experiments provide no quantum-advantage or hardware-speedup evidence.
