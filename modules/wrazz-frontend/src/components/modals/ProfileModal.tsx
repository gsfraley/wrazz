import { FormEvent, useState } from "react";
import type { CurrentUser } from "../../api/auth";
import { updateSelf } from "../../api/user";
import Modal from "./Modal";
import styles from "./ProfileModal.module.css";
import { cx } from "../../lib/utils";

export interface ProfileModalProps {
  user: CurrentUser;
  onClose: () => void;
  onUpdated: (user: CurrentUser) => void;
}

export default function ProfileModal({ user, onClose, onUpdated }: ProfileModalProps) {
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
      <div className={styles.body}>
        <p className={styles.profileName}>{user.display_name}</p>
        <div className={styles.profileFields}>
          <div className={styles.profileField}>
            <span className={styles.profileLabel}>Account ID</span>
            <span className={cx(styles.profileValue, styles.profileValueMono)}>{user.id}</span>
          </div>
          <div className={styles.profileField}>
            <span className={styles.profileLabel}>Member Since</span>
            <span className={styles.profileValue}>{memberSince}</span>
          </div>
          <div className={styles.profileField}>
            <span className={styles.profileLabel}>Role</span>
            <span className={styles.profileValue}>{user.is_admin ? "Admin" : "Member"}</span>
          </div>

          <form className={styles.profileEmailForm} onSubmit={handleSaveEmail}>
            <div className={styles.profileField}>
              <label className={styles.profileLabel} htmlFor="profile-email">Email</label>
              <div className={styles.profileEmailRow}>
                <input
                  id="profile-email"
                  className={styles.profileEmailInput}
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
                  className={styles.profileEmailSave}
                  disabled={busy || email.trim() === (user.email ?? "")}
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
              {error && <p className={cx(styles.profileEmailMsg, styles.profileEmailMsgError)}>{error}</p>}
              {success && <p className={cx(styles.profileEmailMsg, styles.profileEmailMsgOk)}>{success}</p>}
            </div>
          </form>
        </div>
      </div>
    </Modal>
  );
}
