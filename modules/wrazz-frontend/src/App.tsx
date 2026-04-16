import { useState, useEffect, useCallback } from "react";
import { FileEntry, listFiles, createFile, updateFile, deleteFile } from "./api/files";
import FileList from "./components/FileList";
import Editor, { Draft } from "./components/Editor";
import StatusBar from "./components/StatusBar";

export default function App() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const activeFile = files.find((f) => f.id === activeId) ?? null;

  // Re-fetches the file list from the backend.
  const reload = useCallback(async () => {
    const fetched = await listFiles();
    setFiles(fetched);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function handleSelect(id: string) {
    const file = files.find((f) => f.id === id);
    if (!file) return;
    setActiveId(file.id);
    setDraft({ title: file.title, content: file.content, tags: file.tags });
    setStatus(null);
  }

  async function handleNew() {
    // TODO: error handling — evolve once UI has structured error state
    const file = await createFile("Untitled", "", []);
    await reload();
    setActiveId(file.id);
    setDraft({ title: file.title, content: file.content, tags: file.tags });
    setStatus("Created");
  }

  async function handleSave() {
    if (!activeId || !draft) return;
    // TODO: error handling — evolve once UI has structured error state
    await updateFile(activeId, draft.title, draft.content, draft.tags);
    await reload();
    setStatus("Saved");
  }

  async function handleDelete() {
    if (!activeId) return;
    // TODO: error handling — evolve once UI has structured error state
    await deleteFile(activeId);
    await reload();
    setActiveId(null);
    setDraft(null);
    setStatus("Deleted");
  }

  return (
    <div className="app">
      <div className="workspace">
        <FileList
          files={files}
          activeId={activeId}
          onSelect={handleSelect}
          onNew={handleNew}
        />
        <Editor
          file={activeFile}
          draft={draft}
          onChange={setDraft}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      </div>
      <StatusBar activeId={activeId} message={status} />
    </div>
  );
}
