export const formulas = {
  store: String.raw`\begin{aligned}W_{ij}&=\frac{1}{n}\sum_{\mu=1}^{M}\xi_i^{(\mu)}\xi_j^{(\mu)}\quad(i\ne j)\\[0.35em]W_{ii}&=0\end{aligned}`,
  damage: String.raw`h_i=b_i+\sum_{j\in C}W_{ij}y_j`,
  hopfield: String.raw`u_i=\sum_{\substack{j\in F\\j\ne i}}W_{ij}s_j+h_i`,
  thermal: String.raw`P(s_i=+1\mid s_{-i})=\sigma\!\left(\frac{2u_i}{\tau}\right)`,
  quantum: String.raw`\begin{aligned}U_{C,k}&=e^{-i\gamma_k H_C}\\[0.35em]U_{M,k}&=e^{-i\beta_k\sum_a X_a}\\[0.35em]|\psi_k\rangle&=U_{M,k}U_{C,k}|\psi_{k-1}\rangle\end{aligned}`,
  hamiltonian: String.raw`\begin{aligned}H_C&=E_{\rm const}I\\[-0.1em]&\quad-\sum_{a<b}W_{F[a],F[b]}Z_aZ_b\\[-0.1em]&\quad-\sum_a h_{F[a]}Z_a\end{aligned}`,
  measure: String.raw`P(x)=|\langle x|\psi\rangle|^2`,
  compare: String.raw`\Delta E=E(s_{\rm recovered})-E_{\rm exact\ min}`,
  export: String.raw`\begin{aligned}s_i&=1-2x_i\\[0.35em]j&=\sum_a x_a2^a\end{aligned}`,
  pauli: String.raw`Z_a|x\rangle=(1-2x_a)|x\rangle`,
  amplitude: String.raw`\begin{aligned}\alpha_j&=\operatorname{Re}(\alpha_j)+i\operatorname{Im}(\alpha_j)\\[0.4em]&=|\alpha_j|e^{i\theta_j}\\[0.4em]P_j&=|\alpha_j|^2\end{aligned}`,
  normalization: String.raw`\begin{aligned}\|\psi\|^2&=\sum_j|\alpha_j|^2\\[0.4em]&=\sum_jP_j=1\end{aligned}`,
  expectation: String.raw`\langle H_C\rangle=\sum_jP_jE_j`,
  variance: String.raw`\operatorname{Var}(H_C)=\sum_jP_j(E_j-\langle H_C\rangle)^2`,
  entropy: String.raw`S_{\rm basis}=-\sum_{j:P_j>0}P_j\log_2 P_j`,
  participation: String.raw`N_{\rm eff}=\frac{1}{\sum_jP_j^2}`,
};

export type FormulaSymbol = { symbol: string; meaning: string };
export type FormulaPresentation = {
  title: string;
  description?: string;
  tex: string;
  symbols?: FormulaSymbol[];
};

const chapterDetails: Record<
  keyof typeof formulas,
  Omit<FormulaPresentation, "tex">
> = {
  store: {
    title: "Hebbian memory weights",
    description:
      "Each stored pattern contributes to a shared pair weight. Normalize by the total pixel count and remove self-connections.",
    symbols: [
      {
        symbol: String.raw`W_{ij}`,
        meaning: "Weight connecting pixels i and j",
      },
      { symbol: "n", meaning: "Total pixels, including trusted pixels" },
      { symbol: "M", meaning: "Number of stored memories" },
      {
        symbol: String.raw`\xi_i^{(\mu)}`,
        meaning: "Spin at pixel i in stored memory μ",
      },
    ],
  },
  damage: {
    title: "Field from trusted pixels",
    description:
      "Trusted cue pixels stay fixed. Their connections contribute a field on each free pixel.",
    symbols: [
      { symbol: "C", meaning: "Trusted pixel indices" },
      { symbol: "y_j", meaning: "Observed cue spin at pixel j" },
      { symbol: "b_i", meaning: "Base bias at pixel i" },
      { symbol: "h_i", meaning: "Conditioned field on free pixel i" },
    ],
  },
  hopfield: {
    title: "Local field",
    description:
      "Use the current spins of the other free pixels, plus the conditioned field from trusted observations.",
    symbols: [
      { symbol: "F", meaning: "Free pixel indices" },
      { symbol: "s_j", meaning: "Current spin at pixel j, +1 or −1" },
      { symbol: "h_i", meaning: "Conditioned field on pixel i" },
      { symbol: "u_i", meaning: "Local field driving the next update" },
    ],
  },
  thermal: {
    title: "Thermal update probability",
    description:
      "Draw the next spin from this conditional probability. Positive temperature permits uphill energy moves.",
    symbols: [
      { symbol: "u_i", meaning: "Current local field" },
      {
        symbol: String.raw`\tau`,
        meaning: "Positive temperature in normalized energy units",
      },
      { symbol: String.raw`\sigma(z)`, meaning: "Sigmoid: 1 / (1 + exp(−z))" },
      { symbol: "s_{-i}", meaning: "All current spins except pixel i" },
    ],
  },
  quantum: {
    title: "One QAOA layer",
    description:
      "Apply the cost operation first, then the mixer. The rightmost operator acts first.",
    symbols: [
      {
        symbol: "H_C",
        meaning: "Cost Hamiltonian built from the shared energy",
      },
      {
        symbol: String.raw`\gamma_k`,
        meaning: "Cost angle at layer k, in radians",
      },
      {
        symbol: String.raw`\beta_k`,
        meaning: "Mixer angle at layer k, in radians",
      },
      { symbol: "X_a", meaning: "Pauli X operator on local free qubit a" },
      {
        symbol: String.raw`|\psi_k\rangle`,
        meaning: "Quantum state after layer k",
      },
    ],
  },
  hamiltonian: {
    title: "Conditioned cost Hamiltonian",
    description:
      "The same conditioned energy becomes a diagonal quantum operator. Its constant stays in every objective.",
    symbols: [
      { symbol: "F[a]", meaning: "Global pixel represented by local qubit a" },
      {
        symbol: "Z_a",
        meaning: "Pauli Z; its eigenvalue equals that pixel’s spin",
      },
      { symbol: "h_{F[a]}", meaning: "Conditioned field on that free pixel" },
      {
        symbol: String.raw`E_{\rm const}`,
        meaning: "Energy of the eliminated trusted pixels",
      },
      { symbol: "I", meaning: "Identity operator" },
    ],
  },
  measure: {
    title: "Probability from amplitude",
    description:
      "An ideal basis probability is the squared magnitude of its complex amplitude. Finite measured frequencies are separate.",
    symbols: [
      { symbol: "x", meaning: "A computational basis bit pattern" },
      {
        symbol: String.raw`\langle x|\psi\rangle`,
        meaning: "Complex amplitude of that pattern",
      },
      { symbol: "P(x)", meaning: "Ideal probability, between zero and one" },
    ],
  },
  compare: {
    title: "Gap to exact minimum",
    description:
      "A lower energy need not recover the generating memory. Evaluate energy and memory recovery separately.",
  },
  export: {
    title: "Spin and basis encoding",
    description:
      "A filled pixel is spin +1 and bit 0. In the basis sum, xₐ is the bit of local free qubit a, representing global pixel F[a].",
    symbols: [
      { symbol: "s_i", meaning: "Pixel spin, +1 or −1" },
      { symbol: "x_i", meaning: "Pixel bit, 0 or 1" },
      { symbol: "x_a", meaning: "Local free-qubit bit in the basis sum" },
      {
        symbol: "j",
        meaning: "Basis integer; local qubit zero is the least significant bit",
      },
    ],
  },
  pauli: {
    title: "Pauli Z and pixel spin",
    description:
      "Local qubit a represents free pixel F[a]. Z has eigenvalue +1 for bit 0 and −1 for bit 1, exactly matching the spin convention.",
    symbols: [
      { symbol: "Z_a", meaning: "Pauli Z on local qubit a" },
      { symbol: "x_a", meaning: "Local bit, zero or one" },
      { symbol: "F[a]", meaning: "Corresponding global pixel index" },
    ],
  },
  amplitude: {
    title: "Complex amplitude",
    description:
      "The Argand plane shows the exported real and imaginary components. θ is its raw polar angle; playback relative phases use the first nonzero amplitude as their reference.",
    symbols: [
      {
        symbol: String.raw`\alpha_j`,
        meaning: "Complex amplitude for basis integer j",
      },
      { symbol: "i", meaning: "Imaginary unit, with i² = −1" },
      {
        symbol: String.raw`|\alpha_j|`,
        meaning: "Amplitude magnitude; its square is probability",
      },
      { symbol: String.raw`\theta_j`, meaning: "Raw phase angle in radians" },
    ],
  },
  normalization: {
    title: "State normalization",
    description:
      "Every ideal statevector snapshot has unit norm, so its exported basis probabilities sum to one within numerical precision.",
    symbols: [
      { symbol: String.raw`|\psi\rangle`, meaning: "Ideal pure-state vector" },
      { symbol: String.raw`\alpha_j`, meaning: "Complex basis amplitude" },
      { symbol: "P_j", meaning: "Ideal probability of basis integer j" },
    ],
  },
  expectation: {
    title: "Expected energy",
    description:
      "Weight each exact conditioned basis energy by its ideal statevector probability. This expectation is not the energy of the modal measured state.",
    symbols: [
      { symbol: "P_j", meaning: "Ideal probability of basis integer j" },
      {
        symbol: "E_j",
        meaning: "Conditioned energy of that full reconstructed state",
      },
      {
        symbol: String.raw`\langle H_C\rangle`,
        meaning: "Expected cost energy in the current ideal snapshot",
      },
    ],
  },
  variance: {
    title: "Energy variance",
    description:
      "The ideal distribution’s probability-weighted spread around expected energy, in squared normalized energy units. This is not an uncertainty interval for memory recovery.",
  },
  entropy: {
    title: "Basis distribution entropy",
    description:
      "Shannon entropy of measurement probabilities in the computational basis, measured in bits. It describes basis spread; it is not entanglement entropy.",
    symbols: [
      { symbol: "P_j", meaning: "Ideal basis probability" },
      {
        symbol: String.raw`\log_2`,
        meaning: "Base-two logarithm; zero-probability terms contribute zero",
      },
    ],
  },
  participation: {
    title: "Effective basis states",
    description:
      "The inverse participation ratio is one for a single certain basis state and equals the full basis count for a uniform distribution. It does not measure entanglement.",
  },
};

const supplementary: Record<string, FormulaPresentation> = {
  [String.raw`E(s)=-\frac12s^TWs-b^Ts`]: {
    title: "Shared memory energy",
    tex: String.raw`E(s)=-\frac12s^TWs-b^Ts`,
    description:
      "The one-half counts each symmetric pair once. Noisy observations modify the configured bias b to b′ before recovery.",
    symbols: [
      { symbol: "s", meaning: "Full vector of pixel spins" },
      { symbol: "b", meaning: "Bias vector" },
    ],
  },
  [String.raw`b'_i=b_i+\lambda r_i y_i`]: {
    title: "Soft cue bias",
    tex: String.raw`b'_i=b_i+\lambda r_i y_i`,
    description:
      "Apply this field on observed pixels. Missing observations add no cue field; noisy observations remain free.",
    symbols: [
      { symbol: String.raw`\lambda`, meaning: "Cue strength" },
      { symbol: "r_i", meaning: "Reliability weight, from zero to one" },
      { symbol: "y_i", meaning: "Observed cue spin" },
    ],
  },
  [String.raw`E_{\rm cue}(s)=E(s)-\lambda\sum_{i\in O}r_i y_i s_i`]: {
    title: "Energy with a soft cue",
    tex: String.raw`\begin{aligned}E_{\rm cue}(s)&=E(s)\\[-0.1em]&\quad-\lambda\sum_{i\in O}r_i y_i s_i\end{aligned}`,
    description:
      "Observed noisy pixels add a reliability-weighted preference. Every spin stays free to change.",
    symbols: [
      { symbol: "O", meaning: "Observed pixel indices" },
      { symbol: String.raw`\lambda`, meaning: "Cue strength" },
      { symbol: "r_i", meaning: "Reliability weight, from zero to one" },
      { symbol: "y_i", meaning: "Observed cue spin" },
    ],
  },
  [String.raw`s'_i=\operatorname{sign}(u_i),\qquad \Delta E=-(s'_i-s_i)u_i\le0`]:
    {
      title: "Hopfield update and energy change",
      tex: String.raw`\begin{aligned}s'_i&=\begin{cases}+1&u_i>0\\-1&u_i<0\\s_i&u_i=0\end{cases}\\[0.6em]\Delta E&=-(s'_i-s_i)u_i\le0\end{aligned}`,
      description:
        "A zero local field preserves the previous spin. Each asynchronous update can only keep or reduce the shared energy.",
    },
  [String.raw`\sigma(z)=\frac{1}{1+e^{-z}},\quad s'_i=+1\ \text{if }r<P(+1)`]: {
    title: "Seeded thermal draw",
    tex: String.raw`\begin{aligned}\sigma(z)&=\frac{1}{1+e^{-z}}\\[0.45em]s'_i&=\begin{cases}+1&r<P(+1)\\-1&r\ge P(+1)\end{cases}\end{aligned}`,
    description:
      "Here r is the actual seeded uniform random draw. It is distinct from the cue reliability weight rᵢ.",
  },
  [String.raw`\operatorname{RZZ}(-2\gamma W_{ij}),\quad \operatorname{RZ}(-2\gamma h_i),\quad \operatorname{RX}(2\beta)`]:
    {
      title: "Gate angles",
      tex: String.raw`\begin{aligned}\text{Pair cost: }&\operatorname{RZZ}(-2\gamma W_{ij})\\[0.4em]\text{Field cost: }&\operatorname{RZ}(-2\gamma h_i)\\[0.4em]\text{Mixer: }&\operatorname{RX}(2\beta)\end{aligned}`,
      description:
        "Angles use Qiskit’s rotation conventions, in radians. Cost gates rotate phases; mixer gates can redistribute probabilities.",
    },
  [String.raw`f(x)=\frac{N_x}{N_{\rm shots}},\qquad \hat x=\arg\max_x N_x`]: {
    title: "Measured frequency and decision",
    tex: String.raw`\begin{aligned}f(x)&=\frac{N_x}{N_{\rm shots}}\\[0.45em]\hat x&=\arg\max_x N_x\end{aligned}`,
    description:
      "The largest observed count decides recovery. Equal largest counts select the lowest basis integer.",
    symbols: [
      { symbol: "N_x", meaning: "Measured count for basis pattern x" },
      {
        symbol: String.raw`N_{\rm shots}`,
        meaning: "Actual total circuit shots",
      },
    ],
  },
};

export function formulaPresentation(tex: string): FormulaPresentation {
  const chapter = (Object.keys(formulas) as (keyof typeof formulas)[]).find(
    (key) => formulas[key] === tex,
  );
  if (chapter) return { ...chapterDetails[chapter], tex };
  return supplementary[tex] || { title: "Formula", tex };
}

export const supplementaryFormulas = Object.keys(supplementary);
