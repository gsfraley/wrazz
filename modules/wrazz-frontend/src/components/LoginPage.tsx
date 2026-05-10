import { useState, useEffect, type FormEvent } from "react";
import { login } from "@/api/auth";
import { getOidcStatus } from "@/api/admin";
import type { CurrentUser } from "@/api/auth";
import styles from "@/components/LoginPage.module.css";

export interface LoginPageProps {
  onLogin: (user: CurrentUser) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);

  useEffect(() => {
    getOidcStatus().then((s) => setOidcEnabled(s.enabled));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = await login(username, password);
      if (!user) {
        setError("Invalid username or password.");
      } else {
        onLogin(user);
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.loginPage}>
      <div className={styles.loginCard}>
        <h1 className={styles.loginTitle}>wrazz</h1>
        <form className={styles.loginForm} onSubmit={handleSubmit}>
          <label className={styles.loginLabel} htmlFor="login-username">
            Username
          </label>
          <input
            id="login-username"
            className={styles.loginInput}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            required
          />
          <label className={styles.loginLabel} htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className={styles.loginInput}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
          {error && <p className={styles.loginError}>{error}</p>}
          <button className={styles.loginSubmit} type="submit" disabled={busy}>
            {busy ? "signing in…" : "sign in"}
          </button>
        </form>

        {oidcEnabled && (
          <>
            <div className={styles.loginDivider}>
              <span className={styles.loginDividerLabel}>or</span>
            </div>
            <a className={styles.loginSso} href="/api/auth/oidc/redirect">
              sign in with SSO
            </a>
          </>
        )}
      </div>
    </div>
  );
}
