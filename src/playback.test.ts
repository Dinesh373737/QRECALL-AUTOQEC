import { describe, it, expect } from "vitest";
import {
  boundedStep,
  playbackProgress,
  playbackTransition,
  responseIsCurrent,
} from "./playback";
import { formulas } from "./components";
import katex from "katex";
describe("playback integrity", () => {
  it("clamps navigation at both boundaries", () => {
    expect(boundedStep(0, 3, -1)).toBe(0);
    expect(boundedStep(2, 3, 1)).toBe(2);
    expect(boundedStep(0, 0, 1)).toBe(0);
  });
  it("rejects an older experiment revision", () => {
    expect(responseIsCurrent(3, 4)).toBe(false);
    expect(responseIsCurrent(4, 4)).toBe(true);
  });
  it("replays a finished trace from its first computed event", () => {
    expect(
      playbackTransition({ index: 3, playing: false }, 4, { type: "play" }),
    ).toEqual({ index: 0, playing: true });
    expect(
      playbackTransition({ index: 3, playing: false }, 4, { type: "toggle" }),
    ).toEqual({ index: 0, playing: true });
  });
  it("cannot start an empty or single-event narrative", () => {
    for (const length of [0, 1]) {
      expect(
        playbackTransition({ index: 0, playing: false }, length, {
          type: "play",
        }),
      ).toEqual({ index: 0, playing: false });
    }
  });
  it("pauses and resumes the selected event without rewinding mid-trace", () => {
    const paused = playbackTransition({ index: 2, playing: true }, 8, {
      type: "toggle",
    });
    expect(paused).toEqual({ index: 2, playing: false });
    expect(playbackTransition(paused, 8, { type: "play" })).toEqual({
      index: 2,
      playing: true,
    });
  });
  it("manual seek and step pause and clamp to real trace boundaries", () => {
    expect(
      playbackTransition({ index: 2, playing: true }, 4, {
        type: "seek",
        index: 99,
      }),
    ).toEqual({ index: 3, playing: false });
    expect(
      playbackTransition({ index: 2, playing: true }, 4, {
        type: "seek",
        index: -10,
      }),
    ).toEqual({ index: 0, playing: false });
    expect(
      playbackTransition({ index: 0, playing: true }, 4, {
        type: "step",
        delta: -1,
      }),
    ).toEqual({ index: 0, playing: false });
  });
  it("shortened traces clamp old selections and stop at their terminal event", () => {
    expect(
      playbackTransition({ index: 25, playing: true }, 4, {
        type: "reconcile",
      }),
    ).toEqual({ index: 3, playing: false });
    expect(
      playbackTransition({ index: 1, playing: true }, 4, { type: "reconcile" }),
    ).toEqual({ index: 1, playing: true });
  });
  it("advances exactly once and stops on the final computed event", () => {
    expect(
      playbackTransition({ index: 1, playing: true }, 4, { type: "advance" }),
    ).toEqual({ index: 2, playing: true });
    expect(
      playbackTransition({ index: 2, playing: true }, 4, { type: "advance" }),
    ).toEqual({ index: 3, playing: false });
    expect(
      playbackTransition({ index: 1, playing: false }, 4, { type: "advance" }),
    ).toEqual({ index: 1, playing: false });
  });
  it("reset returns the first event and pauses", () => {
    expect(
      playbackTransition({ index: 3, playing: true }, 8, { type: "reset" }),
    ).toEqual({ index: 0, playing: false });
  });
  it("freezes and resumes the same within-event animation position", () => {
    const running = { index: 2, playing: true };
    const paused = playbackTransition(running, 8, { type: "pause" });
    expect(playbackProgress(0.43, running, paused, { type: "pause" })).toBe(
      0.43,
    );
    const resumed = playbackTransition(paused, 8, { type: "play" });
    expect(playbackProgress(0.43, paused, resumed, { type: "play" })).toBe(
      0.43,
    );
  });
  it("manual navigation shows a settled event and replay starts a new animation", () => {
    const running = { index: 2, playing: true };
    const settled = playbackTransition(running, 8, { type: "seek", index: 7 });
    expect(
      playbackProgress(0.43, running, settled, { type: "seek", index: 7 }),
    ).toBe(1);
    const replay = playbackTransition(settled, 8, { type: "play" });
    expect(playbackProgress(1, settled, replay, { type: "play" })).toBe(0);
  });
});
it("all chapter equations parse", () => {
  for (const formula of Object.values(formulas))
    expect(() =>
      katex.renderToString(formula, { throwOnError: true }),
    ).not.toThrow();
});
