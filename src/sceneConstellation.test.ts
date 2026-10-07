import { describe, expect, it } from "vitest";
import {
  orbitIsActive,
  orbitalStatePosition,
  probabilityRadius,
  singleBitEdges,
  stateConstellationPosition,
} from "./sceneConstellation";

describe("alternative scientific views", () => {
  it("links every one-bit neighbor once without adding unavailable states", () => {
    const edges = singleBitEdges(
      Array.from({ length: 256 }, (_, index) => index),
      8,
    );
    expect(edges).toHaveLength(1024);
    expect(new Set(edges.map(([a, b]) => `${a}:${b}`)).size).toBe(1024);
    expect(
      edges.every(([a, b]) => ((a ^ b) & ((a ^ b) - 1)) === 0 && a < b),
    ).toBe(true);
    expect(singleBitEdges([0, 1, 4], 3)).toEqual([
      [0, 1],
      [0, 4],
    ]);
    expect(singleBitEdges([0, 1, 2, 3], 2, [1])).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });
  it("keeps bounded layout coordinates and handles no free variables", () => {
    expect(stateConstellationPosition(0, 0)).toEqual([0, 0]);
    expect(orbitalStatePosition(0, 1)).toEqual([0, 0, 0]);
    for (let qubits = 1; qubits <= 8; qubits++) {
      for (let index = 0; index < 2 ** qubits; index++) {
        expect(
          stateConstellationPosition(index, qubits).every(
            (value) => Number.isFinite(value) && Math.abs(value) <= 3.500001,
          ),
        ).toBe(true);
        const [x, y, z] = orbitalStatePosition(index, 2 ** qubits);
        expect(Math.abs(y)).toBeLessThanOrEqual(2.65);
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(3.700001);
      }
    }
  });
  it("makes volume ratios match probability ratios and keeps zero empty", () => {
    expect(probabilityRadius(0, 1)).toBe(0);
    const half = probabilityRadius(0.5, 1),
      full = probabilityRadius(1, 1);
    expect((half / full) ** 3).toBeCloseTo(0.5);
    expect(probabilityRadius(0, 0)).toBe(0);
  });
  it("stops cinematic motion when paused, reduced, disabled or manually moved", () => {
    expect(orbitIsActive(true, false, true, false)).toBe(true);
    expect(orbitIsActive(false, false, true, false)).toBe(false);
    expect(orbitIsActive(true, true, true, false)).toBe(false);
    expect(orbitIsActive(true, false, false, false)).toBe(false);
    expect(orbitIsActive(true, false, true, true)).toBe(false);
  });
});
