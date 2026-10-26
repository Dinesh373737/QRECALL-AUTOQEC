import { useEffect, useState } from "react";

export type Query = Record<string, string | number | boolean | undefined | null>;
export interface Route {
  path: string;
  query: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, search = ""] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(search) };
}

export function href(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {}))
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const s = params.toString();
  return `#${path}${s ? `?${s}` : ""}`;
}

export function navigate(path: string, query?: Query) {
  const next = href(path, query);
  if (window.location.hash !== next) window.location.hash = next;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => {
      setRoute(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function qNum(q: URLSearchParams, key: string, fallback: number): number {
  const v = q.get(key);
  if (v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function qStr(q: URLSearchParams, key: string, fallback: string): string {
  return q.get(key) ?? fallback;
}
