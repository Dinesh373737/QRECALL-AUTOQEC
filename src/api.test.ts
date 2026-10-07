import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, isConnectionError, request } from "./api";

afterEach(() => vi.unstubAllGlobals());

async function failure(path: string): Promise<ApiError> {
  try {
    await request(path);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("Expected an ApiError from the mocked response.");
}

describe("scientific API responses", () => {
  it("preserves successful data, cancellation signals and caller headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    expect(
      await request("/health", {
        signal,
        headers: new Headers({ "X-Request-ID": "test" }),
      }),
    ).toEqual({ status: "ok" });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/health");
    expect(options.signal).toBe(signal);
    expect(options.headers.get("Content-Type")).toBe("application/json");
    expect(options.headers.get("X-Request-ID")).toBe("test");
  });

  it("identifies unavailable local servers with useful guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    const error = await failure("/health");
    expect(error).toBeInstanceOf(ApiError);
    expect(isConnectionError(error)).toBe(true);
    expect(error.code).toBe("connection_unavailable");
    expect(error.message).toMatch(/local server running/);
  });

  it.each([502, 503, 504])(
    "classifies proxy status %i without parsing its HTML",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("<html>Unavailable</html>", { status }),
          ),
      );
      const error = await failure("/experiment");
      expect(isConnectionError(error)).toBe(true);
      expect(error.status).toBe(status);
    },
  );

  it("turns malformed responses into recoverable connection errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>Wrong server</html>", { status: 200 }),
        ),
    );
    const error = await failure("/health");
    expect(error.code).toBe("invalid_response");
    expect(error.message).toMatch(/Restart the QRecall local server/);
    expect(isConnectionError(error)).toBe(true);
  });

  it("preserves actionable validation messages without treating them as disconnections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "invalid_configuration",
              message: "At most 8 free qubits are supported.",
            },
          }),
          { status: 422 },
        ),
      ),
    );
    const error = await failure("/experiment");
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.code).toBe("invalid_configuration");
    expect(error.message).toBe("At most 8 free qubits are supported.");
    expect(isConnectionError(error)).toBe(false);
  });

  it("preserves computation failures as computation errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "computation_failed",
              message: "The scientific computation failed.",
            },
          }),
          { status: 500 },
        ),
      ),
    );
    const error = await failure("/experiment");
    expect(error.code).toBe("computation_failed");
    expect(isConnectionError(error)).toBe(false);
  });

  it("uses a clear fallback for empty error payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("null", { status: 400 })),
    );
    const error = await failure("/experiment");
    expect(error.message).toBe("The scientific request failed. Try again.");
    expect(isConnectionError(error)).toBe(false);
  });

  it("passes an aborted fetch through unchanged", async () => {
    const aborted = new DOMException("Cancelled", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));
    await expect(request("/health")).rejects.toBe(aborted);
  });

  it("passes cancellation during response reading through unchanged", async () => {
    const aborted = new DOMException("Cancelled", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          status: 200,
          ok: true,
          json: vi.fn().mockRejectedValue(aborted),
        }),
    );
    await expect(request("/health")).rejects.toBe(aborted);
  });
});
