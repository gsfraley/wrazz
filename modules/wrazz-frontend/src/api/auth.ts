import { apiFetch, ApiError } from "@/lib/apiError";

export interface CurrentUser {
  id: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  email: string | null;
}

/// Returns the current user if a valid session cookie exists, otherwise null.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const resp = await apiFetch("/api/v1/user/self");
    return resp.json();
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) return null;
    throw err;
  }
}

/// POSTs credentials to /api/v1/auth/login. Returns the logged-in user on success.
/// Throws on network error; returns null on invalid credentials (401).
export async function login(
  username: string,
  password: string,
): Promise<CurrentUser | null> {
  try {
    await apiFetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return getCurrentUser();
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) return null;
    throw err;
  }
}

/// POSTs to /api/v1/auth/logout. Always resolves (even if session was absent).
export async function logout(): Promise<void> {
  await apiFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => {});
}
