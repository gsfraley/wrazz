import { apiFetch, ApiError } from "@/lib/apiError";
import type { CurrentUser } from "@/api/v1/auth";

export async function updateSelf(email: string | null): Promise<CurrentUser> {
  try {
    const resp = await apiFetch("/api/v1/user/self", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return resp.json();
  } catch (err) {
    if (err instanceof ApiError && err.isConflict) {
      throw new Error("That email is already in use.");
    }
    throw err;
  }
}
