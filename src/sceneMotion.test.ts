import { describe, expect, it } from "vitest";
import {
  basisGridPosition,
  probabilityHeight,
  probabilityScale,
  sceneProgress,
  stateBasisIndex,
  tweenPhase,
  tweenValue,
} from "./sceneMotion";

describe("computed scene presentation", () => {
  it("settles paused and reduced-motion scenes at the actual event endpoint", () => {
    expect(sceneProgress(0.2, false, false)).toBe(1);
    expect(sceneProgress(0.2, true, true)).toBe(1);
    expect(sceneProgress(0.2, true, false)).toBe(0.2);
    expect(sceneProgress(2, true, false)).toBe(1);
    expect(sceneProgress(-1, true, false)).toBe(0);
  });
  it("keeps exact probability endpoints and does not lift zero probabilities", () => {
    expect(probabilityHeight(0, 0.5)).toBe(0);
    expect(probabilityHeight(0.25, 0.5)).toBe(1.5);
    expect(probabilityHeight(0.5, 0.5)).toBe(3);
    expect(probabilityHeight(0, 0)).toBe(0);
    expect(tweenValue(0.1, 0.9, 0)).toBe(0.1);
    expect(tweenValue(0.1, 0.9, 1)).toBe(0.9);
    expect(tweenValue(0.1, 0.9, 0.5)).toBeCloseTo(0.5);
  });
  it("takes the short phase arc but preserves the exported endpoint", () => {
    expect(tweenPhase(3.1, -3.1, 0.5)).toBeCloseTo(Math.PI);
    expect(tweenPhase(3.1, -3.1, 1)).toBe(-3.1);
    expect(tweenPhase(1, null, 0.5)).toBeNull();
    expect(tweenPhase(null, 2, 0.5)).toBe(2);
  });
  it("uses one actual endpoint axis so intermediate columns stay in bounds", () => {
    const before = [0.7, 0.3];
    const after = [0.4, 0.6];
    const scale = probabilityScale([before, after]);
    expect(scale).toBe(0.7);
    for (let step = 0; step <= 10; step++) {
      const probabilities = before.map((value, index) =>
        tweenValue(value, after[index], step / 10),
      );
      expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(
        1,
      );
      expect(
        probabilities.every((value) => probabilityHeight(value, scale) <= 3),
      ).toBe(true);
    }
    expect(before).toEqual([0.7, 0.3]);
    expect(after).toEqual([0.4, 0.6]);
  });
  it("assigns every bounded basis state a unique grid point", () => {
    for (let qubits = 0; qubits <= 8; qubits++) {
      const points = Array.from({ length: 2 ** qubits }, (_, index) =>
        basisGridPosition(index, qubits),
      );
      expect(new Set(points.map((point) => point.join(","))).size).toBe(
        2 ** qubits,
      );
      expect(
        points.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)),
      ).toBe(true);
    }
  });
  it("locates a full computed state without assuming contiguous free pixels", () => {
    const states: (-1 | 1)[][] = [
      [1, 1, -1, 1],
      [1, -1, -1, 1],
    ];
    expect(stateBasisIndex(states, [1, -1, -1, 1])).toBe(1);
    expect(stateBasisIndex(states, [-1, -1, -1, 1])).toBe(-1);
    expect(states).toEqual([
      [1, 1, -1, 1],
      [1, -1, -1, 1],
    ]);
  });
});
