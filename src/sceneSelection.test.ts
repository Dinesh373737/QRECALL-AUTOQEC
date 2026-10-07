import { describe, expect, it } from "vitest";
import { selectedNeuronPair, visibleBasisStates } from "./sceneSelection";

describe("scene inspection", () => {
  it("retains the other endpoint when reselecting the first neuron", () => {
    expect(selectedNeuronPair([1, 2], 1)).toEqual([1, 2]);
    expect(selectedNeuronPair([1, 2], 2)).toEqual([2, 1]);
    expect(selectedNeuronPair([1, 2], 7)).toEqual([7, 1]);
  });
  it("keeps an inspected state visible even outside the top probabilities", () => {
    const probabilities = [0.5, 0.3, 0.2, 0];
    expect(visibleBasisStates(probabilities, 2, 3)).toEqual([
      { index: 0, value: 0.5 },
      { index: 3, value: 0 },
    ]);
    expect(probabilities).toEqual([0.5, 0.3, 0.2, 0]);
  });
  it("show-all displays every computed state, including zero probability", () => {
    const probabilities = Array.from({ length: 256 }, (_, index) =>
      index === 1 ? 1 : 0,
    );
    const visible = visibleBasisStates(
      probabilities,
      probabilities.length,
      255,
    );
    expect(visible).toHaveLength(256);
    expect(new Set(visible.map((state) => state.index)).size).toBe(256);
    expect(visible.find((state) => state.index === 255)).toEqual({
      index: 255,
      value: 0,
    });
  });
});
