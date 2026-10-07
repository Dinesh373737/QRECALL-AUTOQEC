import type { Config, Evaluation, Result } from "./types";

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

export function isConnectionError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.code === "connection_unavailable" ||
      error.code === "invalid_response")
  );
}

function aborted(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...options, headers });
  } catch (error) {
    if (aborted(error)) throw error;
    throw new ApiError(
      "Cannot reach the local scientific engine. Keep the QRecall local server running, then retry.",
      "connection_unavailable",
    );
  }
  if ([502, 503, 504].includes(res.status)) {
    throw new ApiError(
      "The local scientific engine is unavailable. Keep the QRecall local server running, then retry.",
      "connection_unavailable",
      res.status,
    );
  }
  let data: any;
  try {
    data = await res.json();
  } catch (error) {
    if (aborted(error)) throw error;
    throw new ApiError(
      "The local scientific engine returned an unreadable response. Restart the QRecall local server, then retry.",
      "invalid_response",
      res.status,
    );
  }
  if (!res.ok) {
    const detail = data?.error || data?.detail || data;
    throw new ApiError(
      typeof detail === "string"
        ? detail
        : detail?.message || "The scientific request failed. Try again.",
      typeof detail?.code === "string" ? detail.code : "request_failed",
      res.status,
    );
  }
  return data as T;
}
export const compute = (config: Config, signal: AbortSignal) =>
  request<Result>("/experiment", {
    method: "POST",
    body: JSON.stringify(config),
    signal,
  });
export const evaluate = (
  config: Config,
  target_index: number,
  signal: AbortSignal,
) =>
  request<Evaluation>("/evaluate", {
    method: "POST",
    body: JSON.stringify({ config, target_index }),
    signal,
  });
export function download(
  name: string,
  value: unknown,
  type = "application/json",
) {
  const content =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
