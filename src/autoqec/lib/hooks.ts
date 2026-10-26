import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export function useWidth<T extends HTMLElement>(fallback = 640): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(120, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches || document.documentElement.classList.contains("reduce-motion"));
    on();
    mq.addEventListener("change", on);
    const obs = new MutationObserver(on);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      mq.removeEventListener("change", on);
      obs.disconnect();
    };
  }, []);
  return reduced;
}

export function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* storage unavailable: keep in memory only */
      }
    },
    [key],
  );
  return [value, set];
}

/** Step through 0..count-1 with play/pause; respects reduced motion by stepping instantly. */
export function usePlayer(count: number, intervalMs = 900) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (index >= count - 1) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setIndex((i) => Math.min(count - 1, i + 1)), intervalMs);
    return () => window.clearTimeout(t);
  }, [playing, index, count, intervalMs]);
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, count - 1)));
  }, [count]);
  return {
    index,
    playing,
    setIndex: (i: number) => setIndex(Math.max(0, Math.min(count - 1, i))),
    play: () => {
      if (index >= count - 1) setIndex(0);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    toggle: () => {
      if (playing) setPlaying(false);
      else {
        if (index >= count - 1) setIndex(0);
        setPlaying(true);
      }
    },
    next: () => setIndex((i) => Math.min(count - 1, i + 1)),
    prev: () => setIndex((i) => Math.max(0, i - 1)),
    reset: () => {
      setPlaying(false);
      setIndex(0);
    },
    end: () => {
      setPlaying(false);
      setIndex(count - 1);
    },
  };
}

export function useKey(handler: (e: KeyboardEvent) => void, deps: unknown[] = []) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      handler(e);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
