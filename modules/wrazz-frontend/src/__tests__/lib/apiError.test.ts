import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError, apiFetch } from "@/lib/apiError";

describe("ApiError", () => {
  it("exposes status and convenience getters", () => {
    const err = new ApiError(404, "not found");
    expect(err.isNotFound).toBe(true);
    expect(err.isConflict).toBe(false);
    expect(err.isUnauthorized).toBe(false);
    expect(err.isServerError).toBe(false);
    expect(err.name).toBe("ApiError");
  });

  it("identifies conflict", () => {
    const err = new ApiError(409, "conflict");
    expect(err.isConflict).toBe(true);
    expect(err.isNotFound).toBe(false);
  });

  it("identifies server errors", () => {
    const err = new ApiError(500, "oops");
    expect(err.isServerError).toBe(true);
  });

  it("identifies 503 as server error", () => {
    const err = new ApiError(503, "unavailable");
    expect(err.isServerError).toBe(true);
  });
});

describe("apiFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns response on ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hello: "world" }),
    }));
    const resp = await apiFetch("/api/test");
    expect(resp.ok).toBe(true);
  });

  it("throws ApiError on non-ok response with JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    }));
    await expect(apiFetch("/api/test")).rejects.toThrow(ApiError);
    await expect(apiFetch("/api/test")).rejects.toMatchObject({ status: 404 });
  });

  it("throws ApiError on non-ok response with text body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error("not json"); },
      text: async () => "internal error",
    }));
    await expect(apiFetch("/api/test")).rejects.toMatchObject({ status: 500 });
  });

  it("passes through fetch options", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", mockFetch);
    await apiFetch("/api/test", { method: "POST" });
    expect(mockFetch).toHaveBeenCalledWith("/api/test", { method: "POST" });
  });
});
