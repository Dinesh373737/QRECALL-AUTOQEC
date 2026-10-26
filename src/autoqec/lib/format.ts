export function pct(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function fix(x: number | null | undefined, digits = 3): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

export function sci(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 0.01 && a < 1e4) return x.toPrecision(digits + 1).replace(/\.?0+$/, "");
  return x.toExponential(digits);
}

export function int(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return Math.round(x).toLocaleString("en-US");
}

export function ci(c: [number, number] | number[] | null | undefined, digits = 2): string {
  if (!c || c.length < 2) return "—";
  return `[${pct(c[0], digits)}, ${pct(c[1], digits)}]`;
}

export function us(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "not measured";
  if (x < 1000) return `${x.toFixed(x < 10 ? 2 : 1)} µs`;
  if (x < 1e6) return `${(x / 1000).toFixed(x < 1e4 ? 2 : 1)} ms`;
  return `${(x / 1e6).toFixed(2)} s`;
}

export function signedPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${x > 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

export function expLabel(id: string): string {
  const m = id.match(/^(surface_code|repetition_code)_b([XZ])_d(\d+)_r(\d+)_center_(\d+)_(\d+)$/);
  if (!m) return id;
  const code = m[1] === "surface_code" ? "Surface" : "Repetition";
  return `${code} d=${m[3]} · ${m[2]}-basis · ${Number(m[4])} rounds · @(${m[5]},${m[6]})`;
}

export function shortExp(id: string): string {
  const m = id.match(/^(surface_code|repetition_code)_b([XZ])_d(\d+)_r(\d+)_center_(\d+)_(\d+)$/);
  if (!m) return id;
  return `${m[1] === "surface_code" ? "SC" : "RC"} d${m[3]} ${m[2]} r${Number(m[4])} (${m[5]},${m[6]})`;
}

export const METHOD_COLORS: Record<string, string> = {
  pymatching_circuit: "#7aa7ff",
  pymatching_pij: "#5ad8ef",
  pymatching_correlated: "#3fd0b0",
  google_pymatching: "#9db6e8",
  google_correlated_matching: "#f3b867",
  google_belief_matching: "#f08fc0",
  google_tensor_network_contraction: "#f47c80",
  ising_noise_aware: "#a58bff",
  ising_uniform: "#c7b8ff",
  unprotected: "#f47c80",
  none: "#8191ab",
  lookup: "#f3b867",
  energy: "#5ad8ef",
  exact: "#a58bff",
};

export const METHOD_SHORT: Record<string, string> = {
  pymatching_circuit: "PyMatching · circuit DEM",
  pymatching_pij: "PyMatching · pij DEM",
  pymatching_correlated: "PyMatching correlated",
  google_pymatching: "Google · PyMatching",
  google_correlated_matching: "Google · correlated matching",
  google_belief_matching: "Google · belief matching",
  google_tensor_network_contraction: "Google · tensor network",
  ising_noise_aware: "Ising · noise-aware",
  ising_uniform: "Ising · uniform",
  unprotected: "Unprotected qubit",
  none: "No correction",
  lookup: "Lookup table",
  energy: "Energy (likelihood)",
  exact: "Exact Bayes reference",
};

export function methodColor(m: string) {
  return METHOD_COLORS[m] ?? "#b9c5d9";
}

export function methodLabel(m: string) {
  return METHOD_SHORT[m] ?? m;
}
