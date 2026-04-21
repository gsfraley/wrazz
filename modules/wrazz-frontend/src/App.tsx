import { useState, useEffect } from "react";
import { FileEntry, getFile, getFileContent, updateFile, deleteEntry } from "./api/files";
import { CurrentUser, getCurrentUser, logout } from "./api/auth";
import { AppStatus } from "./types";
import FileTree from "./components/FileTree";
import Editor, { Draft } from "./components/Editor";
import StatusBar from "./components/StatusBar";
import LoginPage from "./components/LoginPage";

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<FileEntry | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then((u) => setUser(u))
      .finally(() => setAuthChecked(true));
  }, []);

  function reload() {
    setReloadKey((k) => k + 1);
  }

  async function handleOpen(path: string) {
    try {
      const [file, { content }] = await Promise.all([
        getFile(path),
        getFileContent(path),
      ]);
      setActivePath(path);
      setActiveFile(file);
      setDraft({ title: file.title, content, tags: file.tags });
      setStatus(null);
    } catch {
      setStatus({ kind: "error", message: "Could not load file." });
    }
  }

  async function handleSave() {
    if (!activePath || !draft) return;
    try {
      const updated = await updateFile(activePath, draft.title, draft.tags, draft.content);
      setActiveFile(updated);
      reload();
      setStatus({ kind: "ok", message: "Saved" });
    } catch {
      setStatus({ kind: "error", message: "Save failed." });
    }
  }

  function handleTreeDeleted(path: string) {
    if (!activePath) return;
    // Clear editor if the active file was deleted directly or lived inside a deleted dir.
    if (activePath === path || activePath.startsWith(path)) {
      setActivePath(null);
      setActiveFile(null);
      setDraft(null);
    }
  }

  async function handleDelete() {
    if (!activePath) return;
    try {
      await deleteEntry(activePath);
      setActivePath(null);
      setActiveFile(null);
      setDraft(null);
      reload();
      setStatus({ kind: "ok", message: "Deleted" });
    } catch {
      setStatus({ kind: "error", message: "Delete failed." });
    }
  }

  async function handleLogout() {
    await logout();
    setUser(null);
    setActivePath(null);
    setActiveFile(null);
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
        <FileTree
          activePath={activePath}
          onOpen={handleOpen}
          onDeleted={handleTreeDeleted}
          reloadKey={reloadKey}
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
