import { FileEntry } from "../api/files";
import { Draft } from "../types";
import { WrazzEditor } from "wrazz-editor";
import { useActiveContext } from "../lib/context";
import { pathToDisplayTitle } from "../lib/utils";
import styles from "./Editor.module.css";
import { cx } from "../lib/utils";

export type { Draft };

export interface EditorProps {
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
}: EditorProps) {
  const { setCtx } = useActiveContext();

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      onSave();
    }
  }

  return (
    <main className={styles.editor} onKeyDown={handleKeyDown} onClick={() => setCtx("editor")}>
      <div className={cx(styles.editorUnsavedBar, isDirty && file && styles.isDirty)}>
        {isDirty && file && <span className={styles.editorUnsavedMsg}>Unsaved changes</span>}
      </div>
      {!file || !draft ? (
        <div className={styles.editorEmpty}>Select a file or create a new one.</div>
      ) : (
        <div className={styles.editorBody}>
          <div className={styles.editorTitleRow}>
            <input
              className={styles.editorTitle}
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
