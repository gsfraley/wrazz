import { useRef, useState } from "react";
import { FileEntry } from "../api/files";
import { CurrentUser } from "../api/auth";
import { WrazzEditor } from "wrazz-editor";
import { Save } from "../icons";
import ProfileModal from "./modals/ProfileModal";
import AdminModal from "./modals/AdminModal";
import { pathToDisplayTitle } from "../App";

export interface Draft {
  title: string;
  content: string;
  tags: string[];
}

type Modal = "profile" | "admin" | null;

interface Props {
  file: FileEntry | null;
  draft: Draft | null;
  activePath: string | null;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  user: CurrentUser;
  onLogout: () => void;
  onUserUpdated: (user: CurrentUser) => void;
}

export default function Editor({
  file,
  draft,
  activePath,
  onChange,
  onSave,
  user,
  onLogout,
  onUserUpdated,
}: Props) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [modal, setModal] = useState<Modal>(null);

  function openModal(m: Modal) {
    if (menuRef.current) menuRef.current.open = false;
    setModal(m);
  }

  return (
    <main className="editor">
      <div className="editor-header">
        <details ref={menuRef} className="user-menu">
          <summary className="user-menu-trigger">{user.display_name}</summary>
          <div className="user-menu-dropdown">
            <button onClick={() => openModal("profile")}>Profile</button>
            {user.is_admin && (
              <button onClick={() => openModal("admin")}>Administration</button>
            )}
            <div className="user-menu-divider" />
            <button onClick={onLogout}>Sign out</button>
          </div>
        </details>
      </div>
      {modal === "profile" && (
        <ProfileModal
          user={user}
          onClose={() => setModal(null)}
          onUpdated={(u) => { onUserUpdated(u); }}
        />
      )}
      {modal === "admin" && (
        <AdminModal onClose={() => setModal(null)} currentUserId={user.id} />
      )}

      {!file || !draft ? (
        <div className="editor-empty">Select a file or create a new one.</div>
      ) : (
        <div className="editor-body">
          <div className="editor-title-row">
            <input
              className="editor-title"
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              placeholder={activePath ? pathToDisplayTitle(activePath) : "Title"}
            />
          </div>
          <WrazzEditor
            value={draft.content}
            onChange={(content) => onChange({ ...draft, content })}
            placeholder="Start writing…"
          />
          {/* After WrazzEditor in DOM so tab order is: title → editor → save */}
          <button className="btn-icon editor-save-btn" onClick={onSave} aria-label="Save">
            <Save />
          </button>
        </div>
      )}
    </main>
  );
}
