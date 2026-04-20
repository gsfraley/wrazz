import { useState, useEffect, useCallback } from "react";
import { FileEntry, listFiles, createFile, updateFile, deleteFile } from "./api/files";
import { CurrentUser, getCurrentUser, logout } from "./api/auth";
import { AppStatus } from "./types";
import FileList from "./components/FileList";
import Editor, { Draft } from "./components/Editor";
import StatusBar from "./components/StatusBar";
import LoginPage from "./components/LoginPage";

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);

  // Probe the session once on mount.
  useEffect(() => {
    getCurrentUser()
      .then((u) => setUser(u))
      .finally(() => setAuthChecked(true));
  }, []);

  const activeFile = files.find((f) => f.id === activeId) ?? null;

  // Re-fetches the file list. On auth failure, clears state (triggers login page).
  const reload = useCallback(async () => {
    try {
      const fetched = await listFiles();
      setFiles(fetched);
    } catch {
      const u = await getCurrentUser().catch(() => null);
      if (!u) {
        setUser(null);
        setFiles([]);
        setActiveId(null);
        setDraft(null);
        setStatus(null);
      } else {
        setStatus({ kind: "error", message: "Failed to load files." });
      }
    }
  }, []);

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  function handleSelect(id: string) {
    const file = files.find((f) => f.id === id);
    if (!file) return;
    setActiveId(file.id);
    setDraft({ title: file.title, content: file.content, tags: file.tags });
    setStatus(null);
  }

  async function handleNew() {
    try {
      const file = await createFile("Untitled", "", []);
      await reload();
      setActiveId(file.id);
      setDraft({ title: file.title, content: file.content, tags: file.tags });
      setStatus({ kind: "ok", message: "Created" });
    } catch {
      setStatus({ kind: "error", message: "Could not create file." });
    }
  }

  async function handleSave() {
    if (!activeId || !draft) return;
    try {
      await updateFile(activeId, draft.title, draft.content, draft.tags);
      await reload();
      setStatus({ kind: "ok", message: "Saved" });
    } catch {
      setStatus({ kind: "error", message: "Save failed." });
    }
  }

  async function handleDelete() {
    if (!activeId) return;
    try {
      await deleteFile(activeId);
      await reload();
      setActiveId(null);
      setDraft(null);
      setStatus({ kind: "ok", message: "Deleted" });
    } catch {
      setStatus({ kind: "error", message: "Delete failed." });
    }
  }

  async function handleLogout() {
    await logout();
    setUser(null);
    setFiles([]);
    setActiveId(null);
    setDraft(null);
    setStatus(null);
  }

  if (!authChecked) return null;

  if (!user) {
    return <LoginPage onLogin={setUser} />;
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
          user={user}
          onLogout={handleLogout}
        />
      </div>
      <StatusBar title={draft?.title ?? null} status={status} />
    </div>
  );
}
