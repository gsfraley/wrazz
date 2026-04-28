import { FormEvent, useState } from "react";
import type { CurrentUser } from "../../api/auth";
import { updateSelf } from "../../api/user";
import Modal from "./Modal";

interface Props {
  user: CurrentUser;
  onClose: () => void;
  onUpdated: (user: CurrentUser) => void;
}

export default function ProfileModal({ user, onClose, onUpdated }: Props) {
  const [email, setEmail] = useState(user.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const memberSince = new Date(user.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  async function handleSaveEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateSelf(email.trim() || null);
      onUpdated(updated);
      setEmail(updated.email ?? "");
      setSuccess("Email saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Profile" onClose={onClose}>
      <div className="modal-body">
        <p className="profile-name">{user.display_name}</p>
        <div className="profile-fields">
          <div className="profile-field">
            <span className="profile-label">Account ID</span>
            <span className="profile-value profile-value--mono">{user.id}</span>
          </div>
          <div className="profile-field">
            <span className="profile-label">Member Since</span>
            <span className="profile-value">{memberSince}</span>
          </div>
          <div className="profile-field">
            <span className="profile-label">Role</span>
            <span className="profile-value">{user.is_admin ? "Admin" : "Member"}</span>
          </div>

          <form className="profile-email-form" onSubmit={handleSaveEmail}>
            <div className="profile-field">
              <label className="profile-label" htmlFor="profile-email">Email</label>
              <div className="profile-email-row">
                <input
                  id="profile-email"
                  className="profile-email-input"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                    setSuccess(null);
                  }}
                  placeholder="you@example.com"
                  disabled={busy}
                />
                <button
                  type="submit"
                  className="profile-email-save"
                  disabled={busy || email.trim() === (user.email ?? "")}
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
              {error && <p className="profile-email-msg profile-email-msg--error">{error}</p>}
              {success && <p className="profile-email-msg profile-email-msg--ok">{success}</p>}
            </div>
          </form>
        </div>
      </div>
    </Modal>
  );
}
