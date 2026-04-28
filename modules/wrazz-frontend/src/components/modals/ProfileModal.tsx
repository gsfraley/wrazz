import type { CurrentUser } from "../../api/auth";
import Modal from "./Modal";

interface Props {
  user: CurrentUser;
  onClose: () => void;
}

export default function ProfileModal({ user, onClose }: Props) {
  const memberSince = new Date(user.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
        </div>
      </div>
    </Modal>
  );
}
