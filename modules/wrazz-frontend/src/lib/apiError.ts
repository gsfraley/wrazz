export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get isNotFound(): boolean { return this.status === 404; }
  get isConflict(): boolean { return this.status === 409; }
  get isUnauthorized(): boolean { return this.status === 401; }
  get isServerError(): boolean { return this.status >= 500; }
}

import { apiBase } from "@/lib/api";

export async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const url = input.startsWith("/") ? `${apiBase()}${input}` : input;
  const resp = await fetch(url, init);
  if (!resp.ok) {
    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      try {
        body = await resp.text();
      } catch {
        body = undefined;
      }
    }
    throw new ApiError(resp.status, `HTTP ${resp.status}`, body);
  }
  return resp;
}
