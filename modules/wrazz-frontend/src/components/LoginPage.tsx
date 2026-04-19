import { useState, FormEvent } from "react";
import { login } from "../api/auth";
import type { CurrentUser } from "../api/auth";

interface Props {
  onLogin: (user: CurrentUser) => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">wrazz</h1>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="login-username">
            Username
          </label>
          <input
            id="login-username"
            className="login-input"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            required
          />
          <label className="login-label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="login-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
          {error && <p className="login-error">{error}</p>}
          <button className="login-submit" type="submit" disabled={busy}>
            {busy ? "signing in…" : "sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
