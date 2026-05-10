import { type FormEvent, useEffect, useState } from "react";
import Modal from "@/components/modals/Modal";
import ConfirmModal from "@/components/modals/ConfirmModal";
import styles from "@/components/modals/AdminModal.module.css";
import { cx } from "@/lib/utils";
import {
  type AdminUser,
  type OidcConfig,
  SECRET_REDACTED,
  deleteOidcConfig,
  deleteUser,
  getOidcConfig,
  listUsers,
  saveOidcConfig,
} from "@/api/admin";

type AdminPage = "info" | "sso" | "users";

export interface AdminModalProps {
  onClose: () => void;
  currentUserId: string;
}

export default function AdminModal({ onClose, currentUserId }: AdminModalProps) {
  const [page, setPage] = useState<AdminPage>("info");

  return (
    <Modal title="Administration" onClose={onClose} wide>
      <div className={styles.adminModalInner}>
        <nav className={styles.adminNav}>
          <button
            className={cx(styles.adminNavItem, page === "info" && styles.active)}
            onClick={() => setPage("info")}
          >
            Info
          </button>
          <button
            className={cx(styles.adminNavItem, page === "sso" && styles.active)}
            onClick={() => setPage("sso")}
          >
            SSO
          </button>
          <button
            className={cx(styles.adminNavItem, page === "users" && styles.active)}
            onClick={() => setPage("users")}
          >
            Users
          </button>
        </nav>
        <div className={styles.adminSection}>
          {page === "info" && <InfoPage />}
          {page === "sso" && <SsoPage />}
          {page === "users" && <UsersPage currentUserId={currentUserId} />}
        </div>
      </div>
    </Modal>
  );
}

function InfoPage() {
  return (
    <div>
      <p className={styles.adminInfoName}>wrazz</p>
      <p className={styles.adminInfoVersion}>version 0.1.6</p>
      <p className={styles.adminInfoDesc}>
        Self-hosted personal journal built around plain Markdown files.
      </p>
      <div className={styles.adminInfoLinks}>
        <a
          className={styles.adminInfoLink}
          href="https://github.com/gsfraley/wrazz"
          target="_blank"
          rel="noreferrer"
        >
          github.com/gsfraley/wrazz
        </a>
      </div>
    </div>
  );
}

function SsoPage() {
  const [config, setConfig] = useState<OidcConfig | null>(null);
  const [form, setForm] = useState({
    issuer_url: "",
    client_id: "",
    client_secret: "",
    enabled: true,
  });
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState(false);

  useEffect(() => {
    getOidcConfig()
      .then((c) => {
        setConfig(c);
        setForm({
          issuer_url: c.issuer_url,
          client_id: c.client_id,
          client_secret: c.client_secret,
          enabled: c.enabled || !c.issuer_url,
        });
      })
      .catch(() => setError("Could not load SSO configuration."));
  }, []);

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
    setSuccess(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();

    if (form.enabled && !config?.suggested_redirect_uri) {
      setError("Set WRAZZ_PUBLIC_URL on the server to compute the redirect URI.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await saveOidcConfig({
        ...form,
        redirect_uri: config?.suggested_redirect_uri ?? "",
      });
      setConfig(updated);
      setForm({
        issuer_url: updated.issuer_url,
        client_id: updated.client_id,
        client_secret: updated.client_secret,
        enabled: updated.enabled,
      });
      setSuccess(updated.active ? "SSO enabled." : "Configuration saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteOidcConfig();
      const fresh = await getOidcConfig();
      setConfig(fresh);
      setForm({ issuer_url: "", client_id: "", client_secret: "", enabled: true });
      setSuccess("SSO configuration removed.");
    } catch {
      setError("Could not remove SSO configuration.");
    } finally {
      setBusy(false);
    }
  }

  const isConfigured = Boolean(config?.issuer_url);
  const isReadOnly = Boolean(config?.env_configured);

  return (
    <>
      <form className={styles.ssoForm} onSubmit={handleSave}>
        <div className={styles.ssoStatus}>
          <span className={cx(styles.ssoStatusDot, config?.active && styles.ssoStatusDotActive)} />
          <span className={styles.ssoStatusLabel}>
            {config === null ? "Loading…" : config.active ? "Active" : "Inactive"}
          </span>
        </div>

        {isReadOnly && (
          <p className={styles.ssoEnvNotice}>
            Configured via <code>WRAZZ_OIDC_*</code> environment variables. Unset them to manage SSO here.
          </p>
        )}

        <div className={styles.ssoFields}>
          <div className={styles.ssoField}>
            <label className={styles.ssoLabel} htmlFor="sso-issuer">Issuer URL</label>
            <input
              id="sso-issuer"
              className={styles.ssoInput}
              type="url"
              value={form.issuer_url}
              onChange={(e) => field("issuer_url", e.target.value)}
              placeholder="https://auth.example.com/application/o/wrazz/"
              disabled={busy || isReadOnly}
              required={form.enabled}
            />
          </div>

          <div className={styles.ssoField}>
            <label className={styles.ssoLabel} htmlFor="sso-client-id">Client ID</label>
            <input
              id="sso-client-id"
              className={styles.ssoInput}
              type="text"
              value={form.client_id}
              onChange={(e) => field("client_id", e.target.value)}
              disabled={busy || isReadOnly}
              required={form.enabled}
            />
          </div>

          <div className={styles.ssoField}>
            <label className={styles.ssoLabel} htmlFor="sso-secret">Client Secret</label>
            <div className={styles.ssoSecretRow}>
              <input
                id="sso-secret"
                className={styles.ssoInput}
                type={showSecret ? "text" : "password"}
                value={form.client_secret}
                onFocus={() => {
                  if (!isReadOnly && form.client_secret === SECRET_REDACTED) {
                    field("client_secret", "");
                  }
                }}
                onChange={(e) => field("client_secret", e.target.value)}
                placeholder={isConfigured ? "Leave blank to keep existing" : ""}
                disabled={busy || isReadOnly}
                required={form.enabled && !isConfigured}
              />
              <button
                type="button"
                className={styles.ssoSecretToggle}
                onClick={() => setShowSecret((s) => !s)}
                disabled={busy}
              >
                {showSecret ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className={styles.ssoField}>
            <label className={styles.ssoLabel}>Redirect URI</label>
            {config?.suggested_redirect_uri ? (
              <p className={styles.ssoRedirectUri}>{config.suggested_redirect_uri}</p>
            ) : (
              <p className={styles.ssoRedirectUriMissing}>
                Set <code>WRAZZ_PUBLIC_URL</code> on the server to compute this.
              </p>
            )}
          </div>

          <label className={styles.ssoEnabledRow}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => {
                setForm((f) => ({ ...f, enabled: e.target.checked }));
                setError(null);
                setSuccess(null);
              }}
              disabled={busy || isReadOnly}
            />
            <span className={styles.ssoEnabledLabel}>Enable SSO</span>
          </label>
        </div>

        {error && <p className={cx(styles.ssoMessage, styles.ssoMessageError)}>{error}</p>}
        {success && <p className={cx(styles.ssoMessage, styles.ssoMessageOk)}>{success}</p>}

        {!isReadOnly && (
          <div className={styles.ssoActions}>
            <button type="submit" className={cx(styles.ssoBtn, styles.ssoBtnPrimary)} disabled={busy || config === null}>
              {busy ? "Saving…" : "Save"}
            </button>
            {isConfigured && (
              <button
                type="button"
                className={cx(styles.ssoBtn, styles.ssoBtnDanger)}
                onClick={() => setPendingDisconnect(true)}
                disabled={busy}
              >
                Disconnect
              </button>
            )}
          </div>
        )}
      </form>

      {pendingDisconnect && (
        <ConfirmModal
          message="Remove the stored SSO configuration?"
          onConfirm={() => { void handleDisconnect(); }}
          onClose={() => setPendingDisconnect(false)}
        />
      )}
    </>
  );
}

function UsersPage({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch(() => setError("Could not load users."));
  }, []);

  async function handleDelete(userId: string) {
    setDeleting(userId);
    try {
      await deleteUser(userId);
      setUsers((u) => u?.filter((x) => x.id !== userId) ?? null);
    } catch {
      setError("Could not delete user.");
    } finally {
      setDeleting(null);
    }
  }

  if (error) return <p className={styles.adminUsersError}>{error}</p>;
  if (!users) return <p className={styles.adminUsersLoading}>Loading…</p>;

  const pendingUser = pendingDeleteId ? users.find((u) => u.id === pendingDeleteId) : null;

  return (
    <>
      <div className={styles.adminUsers}>
        {users.map((u) => (
          <div key={u.id} className={styles.adminUserRow}>
            <div className={styles.adminUserInfo}>
              <span className={styles.adminUserName}>{u.display_name}</span>
              {u.is_admin && <span className={styles.adminUserBadge}>Admin</span>}
              <span className={styles.adminUserEmail}>
                {u.email ?? <em className={styles.adminUserEmailUnset}>no email set</em>}
              </span>
            </div>
            {u.id !== currentUserId && (
              <button
                className={styles.adminUserDelete}
                onClick={() => setPendingDeleteId(u.id)}
                disabled={deleting === u.id}
                aria-label={`Delete ${u.display_name}`}
              >
                {deleting === u.id ? "…" : "Delete"}
              </button>
            )}
          </div>
        ))}
      </div>

      {pendingUser && (
        <ConfirmModal
          message={`Delete account "${pendingUser.display_name}"? This cannot be undone.`}
          onConfirm={() => { void handleDelete(pendingUser.id); }}
          onClose={() => setPendingDeleteId(null)}
        />
      )}
    </>
  );
}
