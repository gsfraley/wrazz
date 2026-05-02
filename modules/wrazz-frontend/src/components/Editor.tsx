import { FileEntry } from "../api/files";
import { WrazzEditor } from "wrazz-editor";
import { useActiveContext } from "../lib/context";
import { pathToDisplayTitle } from "../App";

export interface Draft {
  title: string;
  content: string;
  tags: string[];
}

interface Props {
  file: FileEntry | null;
  draft: Draft | null;
  activePath: string | null;
  isDirty: boolean;
  onChange: (draft: Draft) => void;
  onSave: () => void;
}

export default function Editor({
  file,
  draft,
  activePath,
  isDirty,
  onChange,
  onSave,
}: Props) {
  const { setCtx } = useActiveContext();

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      onSave();
    }
  }

  return (
    <main className="editor" onKeyDown={handleKeyDown} onClick={() => setCtx("editor")}>

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
        </div>
      )}
    </main>
  );
}
