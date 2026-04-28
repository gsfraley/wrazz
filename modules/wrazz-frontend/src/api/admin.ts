/// Sentinel returned in the client_secret field when a secret is already stored.
/// Send this value back unchanged to preserve the existing secret on PUT.
export const SECRET_REDACTED = "••••";

export interface OidcConfig {
  active: boolean;
  /** True when all four WRAZZ_OIDC_* env vars are set. Fields are read-only in this state. */
  env_configured: boolean;
  issuer_url: string;
  client_id: string;
  /** `SECRET_REDACTED` when a secret is stored; empty string when unconfigured. */
  client_secret: string;
  redirect_uri: string;
  enabled: boolean;
  suggested_redirect_uri: string | null;
}

export interface OidcStatus {
  enabled: boolean;
}

export async function getOidcConfig(): Promise<OidcConfig> {
  const resp = await fetch("/api/admin/oidc");
  if (!resp.ok) throw new Error(`get oidc config failed: ${resp.status}`);
  return resp.json();
}

export async function saveOidcConfig(
  config: Pick<OidcConfig, "issuer_url" | "client_id" | "client_secret" | "redirect_uri" | "enabled">
): Promise<OidcConfig> {
  const resp = await fetch("/api/admin/oidc", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `save failed: ${resp.status}`);
  }
  return resp.json();
}

export async function deleteOidcConfig(): Promise<void> {
  const resp = await fetch("/api/admin/oidc", { method: "DELETE" });
  if (!resp.ok) throw new Error(`delete oidc config failed: ${resp.status}`);
}

export async function getOidcStatus(): Promise<OidcStatus> {
  const resp = await fetch("/api/auth/oidc/status");
  if (!resp.ok) return { enabled: false };
  return resp.json();
}

export interface AdminUser {
  id: string;
  display_name: string;
  email: string | null;
  is_admin: boolean;
  created_at: string;
}

export async function listUsers(): Promise<AdminUser[]> {
  const resp = await fetch("/api/admin/users");
  if (!resp.ok) throw new Error(`list users failed: ${resp.status}`);
  return resp.json();
}

export async function deleteUser(id: string): Promise<void> {
  const resp = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`delete user failed: ${resp.status}`);
}
