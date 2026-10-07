/** Presentation selection never changes a solver state or its computed trace. */
export function selectedNeuronPair(
  pair: [number, number],
  neuron: number,
): [number, number] {
  return [neuron, pair[0] === neuron ? pair[1] : pair[0]];
}

export function visibleBasisStates(
  probabilities: number[],
  limit: number,
  selected: number,
) {
  const states = probabilities
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, Math.max(1, limit));
  if (
    selected >= 0 &&
    selected < probabilities.length &&
    !states.some((state) => state.index === selected)
  ) {
    states.pop();
    states.push({ index: selected, value: probabilities[selected] });
  }
  return states;
}
