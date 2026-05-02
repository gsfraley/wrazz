import { useRef, useState } from "react";
import { FileEntry } from "../api/files";
import { CurrentUser } from "../api/auth";
import { WrazzEditor } from "wrazz-editor";
import { Save, RotateCcw } from "../icons";
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
  isDirty: boolean;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onDiscard: () => void;
  user: CurrentUser;
  onLogout: () => void;
  onUserUpdated: (user: CurrentUser) => void;
}

export default function Editor({
  file,
  draft,
  activePath,
  isDirty,
  onChange,
  onSave,
  onDiscard,
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      onSave();
    }
  }

  return (
    <main className="editor" onKeyDown={handleKeyDown}>
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

      <div className={`editor-unsaved-bar${isDirty && file ? " is-dirty" : ""}`}>
        {isDirty && file && <span className="editor-unsaved-msg">Unsaved changes</span>}
      </div>
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
          {isDirty && (
            <button className="btn-icon editor-discard-btn" onClick={onDiscard} aria-label="Discard changes">
              <RotateCcw size={14} />
            </button>
          )}
          <button className="btn-icon editor-save-btn" onClick={onSave} aria-label="Save">
            <Save />
          </button>
        </div>
      )}
    </main>
  );
}
