import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  readonly status?: number;
  readonly code: string;
  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function isAbort(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error && (error as Error).name === "AbortError";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError(
      "Cannot reach the AutoQEC scientific engine. Start it with `npm run dev` (or the container) and retry.",
      "connection_unavailable",
    );
  }
  if ([502, 503, 504].includes(res.status) && !res.headers.get("content-type")?.includes("json")) {
    throw new ApiError("The scientific engine is unavailable. Keep the local server running and retry.", "connection_unavailable", res.status);
  }
  let data: any;
  try {
    data = await res.json();
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError("The engine returned an unreadable response.", "invalid_response", res.status);
  }
  if (!res.ok) {
    const detail = data?.error ?? data?.detail ?? data;
    const message = typeof detail === "string" ? detail : detail?.message ?? "The request failed.";
    throw new ApiError(message, detail?.code ?? "request_failed", res.status);
  }
  return data as T;
}

export const post = <T,>(path: string, body: unknown, signal?: AbortSignal) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body), signal });
export const get = <T,>(path: string, signal?: AbortSignal) => api<T>(path, { signal });

export interface Job<T = any> {
  id: string;
  kind: string;
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
  progress: number;
  phase: string;
  created_at: string;
  result: T | null;
  error: { message: string } | null;
}

/** Fetch on dependency change with abort, loading and error state. */
export function useApi<T>(path: string | null, body?: unknown, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(!!path);
  const [nonce, setNonce] = useState(0);
  const bodyKey = body === undefined ? "" : JSON.stringify(body);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    const req = body === undefined ? get<T>(path, ctrl.signal) : post<T>(path, body, ctrl.signal);
    req
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (isAbort(e)) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, bodyKey, nonce, ...deps]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

/** Submit a background job and poll it until a terminal state. */
export function useJob<T>() {
  const [job, setJob] = useState<Job<T> | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const poll = useCallback((id: string) => {
    const tick = async () => {
      try {
        const j = await get<Job<T>>(`/qec/jobs/${id}`);
        setJob(j);
        if (j.status === "queued" || j.status === "running") timer.current = window.setTimeout(tick, 650);
        else if (j.status === "failed") setError(j.error?.message ?? "The job failed.");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
  }, []);
  const start = useCallback(
    async (path: string, body: unknown) => {
      stop();
      setError("");
      try {
        const j = await post<Job<T>>(path, body);
        setJob(j);
        poll(j.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [poll],
  );
  const cancel = useCallback(async () => {
    if (!job) return;
    stop();
    try {
      setJob(await api<Job<T>>(`/qec/jobs/${job.id}`, { method: "DELETE" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [job]);
  const running = job?.status === "queued" || job?.status === "running";
  return { job, error, start, cancel, running, result: job?.status === "completed" ? job.result : null };
}

export function downloadText(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadJson(name: string, value: unknown) {
  downloadText(name, JSON.stringify(value, null, 2));
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
