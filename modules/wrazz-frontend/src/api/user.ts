import type { CurrentUser } from "./auth";

export async function updateSelf(email: string | null): Promise<CurrentUser> {
  const resp = await fetch("/api/user/self", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (resp.status === 409) throw new Error("That email is already in use.");
  if (!resp.ok) throw new Error(`update failed: ${resp.status}`);
  return resp.json();
}
