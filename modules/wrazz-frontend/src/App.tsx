import { useState, useEffect, useRef, useCallback } from "react";
import { FileEntry, getFile, getFileContent, updateFile } from "./api/files";
import { CurrentUser, getCurrentUser, logout } from "./api/auth";
import { AppStatus } from "./types";
import FileTree from "./components/FileTree";
import type { FileTreeHandle } from "./components/FileTree";
import Editor, { Draft } from "./components/Editor";
import CommandBar from "./components/CommandBar";
import StatusBar from "./components/StatusBar";
import LoginPage from "./components/LoginPage";
import { getDraft, saveDraft, clearDraft, getAllDraftPaths } from "./lib/drafts";
import { ActiveContextCtx } from "./lib/context";
import type { ActionContext } from "./lib/actions";
import { registerAction } from "./lib/actions";
import { Save, RotateCcw, FilePlus, FolderPlus, Download } from "./icons";

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
  const [isDirty, setIsDirty] = useState(false);
  const [draftPaths, setDraftPaths] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<AppStatus | null>(null);

  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activePath;
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeCtx, setActiveCtx] = useState<ActionContext | null>(null);
  const fileTreeRef = useRef<FileTreeHandle>(null);

  // Stable handler refs — updated each render so action closures never go stale
  const handleSaveRef = useRef<() => void>(() => {});
  const handleDiscardRef = useRef<() => void>(() => {});

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
    getAllDraftPaths()
      .then((paths) => setDraftPaths(new Set(paths)))
      .catch(() => {});
  }, []);

  function reload() {
    setReloadKey((k) => k + 1);
  }

  async function handleOpen(path: string) {
    try {
      const [file, { content }, stored] = await Promise.all([
        getFile(path),
        getFileContent(path),
        getDraft(path),
      ]);
      setActivePath(path);
      setActiveFile(file);
      if (stored) {
        setDraft({ title: stored.title, content: stored.content, tags: stored.tags });
        setIsDirty(true);
      } else {
        setDraft({ title: file.title ?? "", content, tags: file.tags });
        setIsDirty(false);
      }
      setStatus(null);
    } catch {
      setStatus({ kind: "error", message: "Could not load file." });
    }
  }

  function handleChange(newDraft: Draft) {
    setDraft(newDraft);
    setIsDirty(true);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const path = activePathRef.current;
      if (path) {
        saveDraft(path, newDraft.title, newDraft.content, newDraft.tags).catch(() => {});
        setDraftPaths((prev) => prev.has(path) ? prev : new Set([...prev, path]));
      }
    }, 500);
  }

  async function handleSave() {
    if (!activePath || !draft) return;
    try {
      const updated = await updateFile(activePath, draft.title.trim() || null, draft.tags, draft.content);
      setActiveFile(updated);
      await clearDraft(activePath);
      setIsDirty(false);
      setDraftPaths((prev) => { const s = new Set(prev); s.delete(activePath); return s; });
      reload();
      setStatus({ kind: "ok", message: "Saved" });
    } catch {
      setStatus({ kind: "error", message: "Save failed." });
    }
  }

  async function handleDiscard() {
    if (!activePath) return;
    await clearDraft(activePath);
    await handleOpen(activePath);
  }

  function handleTreeDeleted(path: string) {
    if (!activePath) return;
    if (activePath === path || activePath.startsWith(path)) {
      clearDraft(path).catch(() => {});
      setDraftPaths((prev) => { const s = new Set(prev); s.delete(path); return s; });
      setActivePath(null);
      setActiveFile(null);
      setDraft(null);
      setIsDirty(false);
    }
  }

  async function handleLogout() {
    await logout();
    setUser(null);
    setActivePath(null);
    setActiveFile(null);
    setDraft(null);
    setIsDirty(false);
    setStatus(null);
  }

  // Keep handler refs current every render
  handleSaveRef.current = handleSave;
  handleDiscardRef.current = handleDiscard;

  // Register palette actions once on mount; refs keep handlers fresh
  useEffect(() => {
    function triggerDownload(url: string) {
      const a = document.createElement("a");
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    const unregs = [
      registerAction({
        id: "core:save",
        label: "Save",
        keywords: ["save", "write"],
        icon: Save,
        contexts: ["editor"],
        handler: () => handleSaveRef.current(),
      }),
      registerAction({
        id: "core:discard",
        label: "Discard changes",
        keywords: ["discard", "revert", "reset"],
        icon: RotateCcw,
        contexts: ["editor"],
        handler: () => handleDiscardRef.current(),
      }),
      registerAction({
        id: "core:new-file",
        label: "New file",
        keywords: ["create", "file", "new"],
        icon: FilePlus,
        contexts: ["file-tree"],
        handler: () => fileTreeRef.current?.newFile(),
      }),
      registerAction({
        id: "core:new-folder",
        label: "New folder",
        keywords: ["create", "folder", "directory", "new"],
        icon: FolderPlus,
        contexts: ["file-tree"],
        handler: () => fileTreeRef.current?.newDir(),
      }),
      registerAction({
        id: "core:export-file",
        label: "Export file",
        keywords: ["export", "download"],
        icon: Download,
        contexts: ["editor"],
        handler: () => {
          const p = activePathRef.current;
          if (p) triggerDownload(`/api/export/file/${p.replace(/^\/|\/$/g, "")}`);
        },
      }),
      registerAction({
        id: "core:export-workspace",
        label: "Export workspace",
        keywords: ["export", "download", "zip", "all"],
        icon: Download,
        handler: () => triggerDownload("/api/export/dir"),
      }),
    ];
    return () => unregs.forEach((f) => f());
  }, []);

  if (!authChecked) return null;

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  return (
    <ActiveContextCtx.Provider value={{ ctx: activeCtx, setCtx: setActiveCtx }}>
      <div className="app">
        <div className="workspace">
          <FileTree
            ref={fileTreeRef}
            activePath={activePath}
            onOpen={handleOpen}
            onDeleted={handleTreeDeleted}
            reloadKey={reloadKey}
            width={sidebarWidth}
            draftPaths={draftPaths}
          />
          <div className="sidebar-resizer" onMouseDown={onResizerMouseDown} />
          <div className="editor-column">
            <CommandBar
              user={user}
              onLogout={handleLogout}
              onUserUpdated={setUser}
              onOpenFile={handleOpen}
              reloadKey={reloadKey}
              hasActiveFile={activeFile !== null}
              isDirty={isDirty}
              editorTitle={draft?.title || (activePath ? pathToDisplayTitle(activePath) : null)}
            />
            <Editor
              file={activeFile}
              draft={draft}
              activePath={activePath}
              isDirty={isDirty}
              onChange={handleChange}
              onSave={handleSave}
            />
          </div>
        </div>
        <StatusBar title={draft?.title || (activePath ? pathToDisplayTitle(activePath) : null)} status={status} />
      </div>
    </ActiveContextCtx.Provider>
  );
}
