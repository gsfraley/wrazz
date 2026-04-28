export interface CurrentUser {
  id: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  email: string | null;
}

/// Returns the current user if a valid session cookie exists, otherwise null.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const resp = await fetch("/api/user/self");
  if (resp.status === 401) return null;
  if (!resp.ok) throw new Error(`user/self failed: ${resp.status}`);
  return resp.json();
}

/// POSTs credentials to /api/auth/login. Returns the logged-in user on success.
/// Throws on network error; returns null on invalid credentials (401).
export async function login(
  username: string,
  password: string
): Promise<CurrentUser | null> {
  const resp = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (resp.status === 401) return null;
  if (!resp.ok) throw new Error(`login failed: ${resp.status}`);
  // Session cookie is now set; fetch the user record.
  return getCurrentUser();
}

/// POSTs to /api/auth/logout. Always resolves (even if session was absent).
export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
