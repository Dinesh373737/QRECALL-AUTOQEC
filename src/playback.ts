import { useCallback, useEffect, useRef, useState } from "react";

export function boundedStep(index: number, length: number, delta: number) {
  return Math.max(0, Math.min(Math.max(0, length - 1), index + delta));
}

export function responseIsCurrent(
  responseRevision: number,
  currentRevision: number,
) {
  return responseRevision === currentRevision;
}

export interface PlaybackState {
  index: number;
  playing: boolean;
}
export type PlaybackAction =
  | { type: "play" | "pause" | "toggle" | "reset" | "advance" | "reconcile" }
  | { type: "seek"; index: number }
  | { type: "step"; delta: number };

/** Transport rules do not modify any computed scientific event. */
export function playbackTransition(
  state: PlaybackState,
  length: number,
  action: PlaybackAction,
): PlaybackState {
  const index = boundedStep(state.index, length, 0);
  const canPlay = length > 1;
  switch (action.type) {
    case "reset":
      return { index: 0, playing: false };
    case "pause":
      return { index, playing: false };
    case "seek":
      return { index: boundedStep(action.index, length, 0), playing: false };
    case "step":
      return {
        index: boundedStep(index, length, action.delta),
        playing: false,
      };
    case "reconcile":
      return { index, playing: canPlay && index < length - 1 && state.playing };
    case "toggle":
      if (state.playing) return { index, playing: false };
    // Fall through to the same replay rule as an explicit play command.
    case "play":
      return {
        index: canPlay && index === length - 1 ? 0 : index,
        playing: canPlay,
      };
    case "advance": {
      if (!canPlay || !state.playing) return { index, playing: false };
      const next = boundedStep(index, length, 1);
      return { index: next, playing: next < length - 1 };
    }
  }
}

export function playbackProgress(
  progress: number,
  previous: PlaybackState,
  next: PlaybackState,
  action: PlaybackAction,
) {
  if (action.type === "reconcile") return next.playing ? 0 : 1;
  if (
    action.type === "reset" ||
    action.type === "seek" ||
    action.type === "step"
  )
    return 1;
  if (
    next.playing &&
    !previous.playing &&
    (previous.index !== next.index || progress >= 1)
  )
    return 0;
  if (action.type === "advance") return next.playing ? 0 : 1;
  return progress;
}

export function usePlayback(length: number, revision: number, chapter: number) {
  const progressRef = useRef(1);
  const [state, setState] = useState<PlaybackState>({
    index: 0,
    playing: false,
  });
  const [speed, setSpeed] = useState(1);
  const stateRef = useRef(state);
  stateRef.current = state;

  const apply = useCallback(
    (action: PlaybackAction) => {
      const previous = stateRef.current;
      const next = playbackTransition(previous, length, action);
      stateRef.current = next;
      progressRef.current = playbackProgress(
        progressRef.current,
        previous,
        next,
        action,
      );
      setState(next);
    },
    [length],
  );

  useEffect(() => {
    apply({ type: "reset" });
  }, [revision, chapter]);
  useEffect(() => {
    apply({ type: "reconcile" });
  }, [length]);
  useEffect(() => {
    if (!state.playing || length < 2) return;
    let raf = 0;
    let last = 0;
    const frame = (time: number) => {
      if (last)
        progressRef.current = Math.min(
          1,
          progressRef.current + ((time - last) * speed) / 1000,
        );
      last = time;
      if (progressRef.current >= 1) apply({ type: "advance" });
      if (stateRef.current.playing) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state.playing, length, speed, apply]);

  return {
    progressRef,
    index: state.index,
    playing: state.playing,
    speed,
    canPlay: length > 1,
    setSpeed,
    play: () => apply({ type: "play" }),
    pause: () => apply({ type: "pause" }),
    toggle: () => apply({ type: "toggle" }),
    seek: (index: number) => apply({ type: "seek", index }),
    step: (delta: number) => apply({ type: "step", delta }),
    reset: () => apply({ type: "reset" }),
    setIndex: (index: number) => apply({ type: "seek", index }),
    setPlaying: (playing: boolean) =>
      apply({ type: playing ? "play" : "pause" }),
  };
}
