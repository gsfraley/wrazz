import { useState, useEffect, useRef, useCallback } from "react";
import { FileEntry, getFile, getFileContent, updateFile } from "./api/files";
import { CurrentUser, getCurrentUser, logout } from "./api/auth";
import { AppStatus } from "./types";
import FileTree from "./components/FileTree";
import Editor, { Draft } from "./components/Editor";
import StatusBar from "./components/StatusBar";
import LoginPage from "./components/LoginPage";

// ── Title helpers ──────────────────────────────────────────────────────────

export function pathToDisplayTitle(path: string): string {
  const filename = path.split("/").filter(Boolean).pop() ?? path;
  return filename.replace(/\.md$/i, "").replace(/[-_]/g, " ");
}

// ── App ────────────────────────────────────────────────────────────────────

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 240;

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<FileEntry | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: sidebarWidth };

    function onMove(ev: MouseEvent) {
      if (!dragState.current) return;
      const delta = ev.clientX - dragState.current.startX;
      setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragState.current.startWidth + delta)));
    }
    function onUp() {
      dragState.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarWidth]);

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
    if (activePath === path || activePath.startsWith(path)) {
      setActivePath(null);
      setActiveFile(null);
      setDraft(null);
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
          width={sidebarWidth}
        />
        <div className="sidebar-resizer" onMouseDown={onResizerMouseDown} />
        <Editor
          file={activeFile}
          draft={draft}
          activePath={activePath}
          onChange={setDraft}
          onSave={handleSave}
          user={user}
          onLogout={handleLogout}
          onUserUpdated={setUser}
        />
      </div>
      <StatusBar title={draft?.title || (activePath ? pathToDisplayTitle(activePath) : null)} status={status} />
    </div>
  );
}
