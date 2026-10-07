/** These layouts represent computed states; their spacing is illustrative. */
export function stateConstellationPosition(
  index: number,
  qubits: number,
): [number, number] {
  if (!qubits) return [0, 0];
  let x = 0,
    z = 0,
    xBound = 0,
    zBound = 0;
  for (let bit = 0; bit < qubits; bit++) {
    const angle = bit * Math.PI * (3 - Math.sqrt(5));
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    const sign = index & (1 << bit) ? 1 : -1;
    x += sign * cos;
    z += sign * sin;
    xBound += Math.abs(cos);
    zBound += Math.abs(sin);
  }
  return [(3.5 * x) / (xBound || 1), (3.5 * z) / (zBound || 1)];
}

export function orbitalStatePosition(
  index: number,
  count: number,
): [number, number, number] {
  if (count <= 1) return [0, 0, 0];
  const y = 1 - (2 * (index + 0.5)) / count;
  const radius = Math.sqrt(1 - y * y);
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return [
    3.7 * radius * Math.cos(angle),
    y * 2.65,
    3.7 * radius * Math.sin(angle),
  ];
}

/** Each undirected edge differs in exactly one logical free-pixel bit. */
export function singleBitEdges(
  indices: readonly number[],
  qubits: number,
  bits?: readonly number[],
) {
  const shown = new Set(indices);
  const bitIndices =
    bits ?? Array.from({ length: qubits }, (_, index) => index);
  const edges: [number, number][] = [];
  for (const state of indices)
    for (const bit of bitIndices) {
      const neighbor = state ^ (1 << bit);
      if (state < neighbor && shown.has(neighbor))
        edges.push([state, neighbor]);
    }
  return edges;
}

/** Sphere volume, rather than radius, is proportional to actual probability. */
export function probabilityRadius(
  probability: number,
  maximum: number,
  largestRadius = 0.52,
) {
  return maximum > 0 ? largestRadius * Math.cbrt(probability / maximum) : 0;
}

export function orbitIsActive(
  playing: boolean,
  reduced: boolean,
  cinematic: boolean,
  manipulated: boolean,
) {
  return playing && !reduced && cinematic && !manipulated;
}
