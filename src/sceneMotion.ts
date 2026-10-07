import type { Spin } from "./types";

/** Visual tweening never creates an additional solver event or numerical result. */
export function sceneProgress(
  progress: number,
  playing: boolean,
  reduced: boolean,
) {
  if (!playing || reduced) return 1;
  return Math.max(0, Math.min(1, progress));
}

export function tweenValue(before: number, after: number, progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * (3 - 2 * t);
  return before + (after - before) * eased;
}

/** A missing phase stays missing; zero-amplitude states never gain a fake dial. */
export function tweenPhase(
  before: number | null,
  after: number | null,
  progress: number,
) {
  if (after === null) return null;
  if (before === null || progress >= 1) return after;
  const delta = Math.atan2(Math.sin(after - before), Math.cos(after - before));
  return before + tweenValue(0, delta, progress);
}

export function probabilityHeight(
  probability: number,
  maximum: number,
  height = 3,
) {
  return maximum > 0 ? (probability / maximum) * height : 0;
}

/** A shared, linear axis over actual endpoints also bounds every convex tween. */
export function probabilityScale(snapshots: readonly (readonly number[])[]) {
  return snapshots.reduce(
    (maximum, values) => Math.max(maximum, ...values),
    1e-12,
  );
}

/** A Gray-coded layout places bit-neighbor states nearby; height is not involved. */
export function basisGridPosition(
  index: number,
  qubits: number,
): [number, number] {
  const xbits = Math.ceil(qubits / 2);
  const mask = (1 << xbits) - 1;
  const inverseGray = (gray: number) => {
    let binary = gray;
    while ((gray >>= 1)) binary ^= gray;
    return binary;
  };
  const x = inverseGray(index & mask);
  const z = inverseGray(index >> xbits);
  const nx = 1 << xbits;
  const nz = 1 << (qubits - xbits);
  return [
    nx > 1 ? (x / (nx - 1) - 0.5) * 7 : 0,
    nz > 1 ? (z / (nz - 1) - 0.5) * 6 : 0,
  ];
}

export function stateBasisIndex(states: Spin[][], state: Spin[]) {
  return states.findIndex((candidate) =>
    candidate.every((spin, i) => spin === state[i]),
  );
}
