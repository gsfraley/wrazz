import { FileEntry } from "../api/files";

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
}

export default function Editor({ file, draft, onChange, onSave, onDelete }: Props) {
  if (!file || !draft) {
    return (
      <main className="editor">
        <div className="editor-empty">Select a file or create a new one.</div>
      </main>
    );
  }

  return (
    <main className="editor">
      <div className="editor-toolbar">
        <button onClick={onSave}>Save</button>
        <button onClick={onDelete}>Delete</button>
      </div>
      <input
        className="editor-title"
        value={draft.title}
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
        placeholder="Title"
      />
      <textarea
        className="editor-body"
        value={draft.content}
        onChange={(e) => onChange({ ...draft, content: e.target.value })}
        placeholder="Start writing…"
      />
    </main>
  );
}
