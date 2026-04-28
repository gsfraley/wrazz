import { FormEvent, useEffect, useState } from "react";
import Modal from "./Modal";
import {
  OidcConfig,
  SECRET_REDACTED,
  deleteOidcConfig,
  getOidcConfig,
  saveOidcConfig,
} from "../../api/admin";

type AdminPage = "info" | "sso";

interface Props {
  onClose: () => void;
}

export default function AdminModal({ onClose }: Props) {
  const [page, setPage] = useState<AdminPage>("info");

  return (
    <Modal title="Administration" onClose={onClose} wide>
      <div className="admin-modal-inner">
        <nav className="admin-nav">
          <button
            className={`admin-nav-item${page === "info" ? " active" : ""}`}
            onClick={() => setPage("info")}
          >
            Info
          </button>
          <button
            className={`admin-nav-item${page === "sso" ? " active" : ""}`}
            onClick={() => setPage("sso")}
          >
            SSO
          </button>
        </nav>
        <div className="admin-section">
          {page === "info" && <InfoPage />}
          {page === "sso" && <SsoPage />}
        </div>
      </div>
    </Modal>
  );
}

function InfoPage() {
  return (
    <div className="admin-info">
      <p className="admin-info-name">wrazz</p>
      <p className="admin-info-version">version 0.1.2</p>
      <p className="admin-info-desc">
        Self-hosted personal journal built around plain Markdown files.
      </p>
      <div className="admin-info-links">
        <a
          className="admin-info-link"
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

    // Redirect URI is always derived from WRAZZ_PUBLIC_URL; block if it's absent.
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
    if (!window.confirm("Remove the stored SSO configuration?")) return;
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
    <form className="sso-form" onSubmit={handleSave}>
      <div className="sso-status">
        <span className={`sso-status-dot${config?.active ? " sso-status-dot--active" : ""}`} />
        <span className="sso-status-label">
          {config === null ? "Loading…" : config.active ? "Active" : "Inactive"}
        </span>
      </div>

      {isReadOnly && (
        <p className="sso-env-notice">
          Configured via <code>WRAZZ_OIDC_*</code> environment variables. Unset them to manage SSO here.
        </p>
      )}

      <div className="sso-fields">
        <div className="sso-field">
          <label className="sso-label" htmlFor="sso-issuer">Issuer URL</label>
          <input
            id="sso-issuer"
            className="sso-input"
            type="url"
            value={form.issuer_url}
            onChange={(e) => field("issuer_url", e.target.value)}
            placeholder="https://auth.example.com/application/o/wrazz/"
            disabled={busy || isReadOnly}
            required={form.enabled}
          />
        </div>

        <div className="sso-field">
          <label className="sso-label" htmlFor="sso-client-id">Client ID</label>
          <input
            id="sso-client-id"
            className="sso-input"
            type="text"
            value={form.client_id}
            onChange={(e) => field("client_id", e.target.value)}
            disabled={busy || isReadOnly}
            required={form.enabled}
          />
        </div>

        <div className="sso-field">
          <label className="sso-label" htmlFor="sso-secret">Client Secret</label>
          <div className="sso-secret-row">
            <input
              id="sso-secret"
              className="sso-input"
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
              className="sso-secret-toggle"
              onClick={() => setShowSecret((s) => !s)}
              disabled={busy}
            >
              {showSecret ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <div className="sso-field">
          <label className="sso-label">Redirect URI</label>
          {config?.suggested_redirect_uri ? (
            <p className="sso-redirect-uri">{config.suggested_redirect_uri}</p>
          ) : (
            <p className="sso-redirect-uri sso-redirect-uri--missing">
              Set <code>WRAZZ_PUBLIC_URL</code> on the server to compute this.
            </p>
          )}
        </div>

        <label className="sso-enabled-row">
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
          <span className="sso-enabled-label">Enable SSO</span>
        </label>
      </div>

      {error && <p className="sso-message sso-message--error">{error}</p>}
      {success && <p className="sso-message sso-message--ok">{success}</p>}

      {!isReadOnly && (
        <div className="sso-actions">
          <button type="submit" className="sso-btn sso-btn--primary" disabled={busy || config === null}>
            {busy ? "Saving…" : "Save"}
          </button>
          {isConfigured && (
            <button
              type="button"
              className="sso-btn sso-btn--danger"
              onClick={handleDisconnect}
              disabled={busy}
            >
              Disconnect
            </button>
          )}
        </div>
      )}
    </form>
  );
}
