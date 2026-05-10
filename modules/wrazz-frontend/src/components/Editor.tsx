import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { WrazzEditor } from "wrazz-editor";
import { pathToDisplayTitle, cx } from "@/lib/utils";
import styles from "@/components/Editor.module.css";

export default function Editor() {
  const { activeFile, draft, activePath, isDirty, changeDraft, saveFile } = useDocumentStore();
  const { setActiveCtx } = useUIStore();

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      void saveFile();
    }
  }

  return (
    <main className={styles.editor} onKeyDown={handleKeyDown} onClick={() => setActiveCtx("editor")}>
      <div className={cx(styles.editorUnsavedBar, isDirty && activeFile && styles.isDirty)}>
        {isDirty && activeFile && <span className={styles.editorUnsavedMsg}>Unsaved changes</span>}
      </div>
      {!activeFile || !draft ? (
        <div className={styles.editorEmpty}>Select a file or create a new one.</div>
      ) : (
        <div className={styles.editorBody}>
          <div className={styles.editorTitleRow}>
            <input
              className={styles.editorTitle}
              value={draft.title}
              onChange={(e) => changeDraft({ ...draft, title: e.target.value })}
              placeholder={activePath ? pathToDisplayTitle(activePath) : "Title"}
            />
          </div>
          <WrazzEditor
            value={draft.content}
            onChange={(content) => changeDraft({ ...draft, content })}
            placeholder="Start writing…"
          />
        </div>
      )}
    </main>
  );
}
