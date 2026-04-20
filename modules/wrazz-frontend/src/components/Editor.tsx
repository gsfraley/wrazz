import { FileEntry } from "../api/files";
import { CurrentUser } from "../api/auth";
import { WrazzEditor } from "wrazz-editor";

export interface Draft {
  title: string;
  content: string;
  tags: string[];
}

interface Props {
  file: FileEntry | null;
  draft: Draft | null;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onDelete: () => void;
  user: CurrentUser;
  onLogout: () => void;
}

export default function Editor({
  file,
  draft,
  onChange,
  onSave,
  onDelete,
  user,
  onLogout,
}: Props) {
  return (
    <main className="editor">
      <div className="editor-header">
        <details className="user-menu">
          <summary className="user-menu-trigger">{user.display_name}</summary>
          <div className="user-menu-dropdown">
            <button onClick={onLogout}>Sign out</button>
          </div>
        </details>
      </div>

      {!file || !draft ? (
        <div className="editor-empty">Select a file or create a new one.</div>
      ) : (
        <>
          <div className="editor-title-row">
            <input
              className="editor-title"
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              placeholder="Title"
            />
            <div className="editor-doc-actions">
              <button className="btn-bare" onClick={onSave}>Save</button>
              <button className="btn-bare btn-bare--danger" onClick={onDelete}>Delete</button>
            </div>
          </div>
          <WrazzEditor
            value={draft.content}
            onChange={(content) => onChange({ ...draft, content })}
            placeholder="Start writing…"
          />
        </>
      )}
    </main>
  );
}
