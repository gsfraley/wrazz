import { useState, useEffect } from "react";
import styles from "@/components/ConnectPage.module.css";

interface ConnectParams {
  name: string;
  redirectUri: string;
  state: string;
  workspaces: string;
}

interface WorkspaceSummary {
  id: string;
  name: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "needs-auth"; oidcEnabled: boolean }
  | { kind: "approval"; displayName: string; workspaces: WorkspaceSummary[] }
  | { kind: "error"; message: string };

function parseParams(): ConnectParams | null {
  const q = new URLSearchParams(window.location.search);
  const name = q.get("name");
  const redirectUri = q.get("redirect_uri");
  const state = q.get("state");
  if (!name || !redirectUri || !state) return null;
  return { name, redirectUri, state, workspaces: q.get("workspaces") ?? "" };
}

export default function ConnectPage() {
  const params = parseParams();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [allWorkspaces, setAllWorkspaces] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!params) {
      setPhase({ kind: "error", message: "Missing required connect parameters." });
      return;
    }
    void checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const userResp = await fetch("/api/v1/user/self", { credentials: "include" });
      if (userResp.ok) {
        const user = await userResp.json() as { display_name: string };
        const wsResp = await fetch("/api/v1/workspaces", { credentials: "include" });
        const workspaces: WorkspaceSummary[] = wsResp.ok ? await wsResp.json() : [];
        setPhase({ kind: "approval", displayName: user.display_name, workspaces });
        return;
      }
    } catch { /* not logged in */ }

    try {
      const oidcResp = await fetch("/api/v1/auth/oidc/status");
      const oidcData = oidcResp.ok ? await oidcResp.json() as { enabled: boolean } : { enabled: false };
      setPhase({ kind: "needs-auth", oidcEnabled: oidcData.enabled });
    } catch {
      setPhase({ kind: "needs-auth", oidcEnabled: false });
    }
  }

  function handleSso() {
    const next = encodeURIComponent(window.location.href);
    window.location.href = `/api/v1/auth/oidc/redirect?next=${next}`;
  }

  async function handlePasswordLogin() {
    setLoginError(null);
    setLoggingIn(true);
    try {
      const resp = await fetch("/api/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (resp.ok) {
        setPhase({ kind: "loading" });
        void checkAuth();
        return;
      }
      setLoginError("Invalid username or password.");
    } catch {
      setLoginError("Connection failed. Is the server reachable?");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleApprove() {
    if (!params) return;
    const workspacesValue = allWorkspaces ? "*" : [...selectedIds].join(",");

    const body = new URLSearchParams({
      name: params.name,
      redirect_uri: params.redirectUri,
      state: params.state,
      workspaces: workspacesValue,
    });

    const resp = await fetch("/api/v1/connect", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (resp.ok) {
      const { callback_url } = await resp.json() as { callback_url: string };
      window.location.href = callback_url;
    }
  }

  function handleDeny() {
    if (!params) return;
    window.location.href =
      `${params.redirectUri}?error=access_denied&state=${encodeURIComponent(params.state)}`;
  }

  function toggleWorkspace(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  if (phase.kind === "loading") {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.hint}>Checking authorization…</p>
        </div>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h2 className={styles.title}>Error</h2>
          <p className={styles.hint}>{phase.message}</p>
        </div>
      </div>
    );
  }

  if (phase.kind === "needs-auth") {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h2 className={styles.title}>Sign in to wrazz</h2>
          <p className={styles.hint}>
            Log in to authorize <strong>{params?.name}</strong>.
          </p>
          {phase.oidcEnabled ? (
            <button className={styles.primaryBtn} onClick={handleSso}>
              Sign in with SSO
            </button>
          ) : (
            <div className={styles.loginForm}>
              <label className={styles.fieldLabel}>
                Username
                <input
                  className={styles.input}
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") document.getElementById("connect-pw")?.focus();
                  }}
                />
              </label>
              <label className={styles.fieldLabel}>
                Password
                <input
                  id="connect-pw"
                  className={styles.input}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handlePasswordLogin(); }}
                />
              </label>
              {loginError && <p className={styles.error}>{loginError}</p>}
              <button
                className={styles.primaryBtn}
                disabled={loggingIn}
                onClick={() => void handlePasswordLogin()}
              >
                {loggingIn ? "Signing in…" : "Sign in"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // approval phase
  const canApprove = allWorkspaces || selectedIds.size > 0;
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h2 className={styles.title}>Authorize wrazz Desktop</h2>
        <p className={styles.hint}>
          <strong>{params?.name}</strong> is requesting access to your workspaces.
          <br />
          Logged in as <strong>{phase.displayName}</strong>.
        </p>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Workspace access</legend>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={allWorkspaces}
              onChange={(e) => setAllWorkspaces(e.target.checked)}
            />
            All workspaces <span className={styles.recommended}>(recommended)</span>
          </label>
          {!allWorkspaces && phase.workspaces.length > 0 && (
            <div className={styles.workspaceList}>
              {phase.workspaces.map((ws) => (
                <label key={ws.id} className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(ws.id)}
                    onChange={(e) => toggleWorkspace(ws.id, e.target.checked)}
                  />
                  {ws.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className={styles.actions}>
          <button
            className={styles.primaryBtn}
            onClick={() => void handleApprove()}
            disabled={!canApprove}
          >
            Authorize
          </button>
          <button className={styles.secondaryBtn} onClick={handleDeny}>
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
