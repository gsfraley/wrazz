import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentUser, logout } from "@/api/auth";
import type { CurrentUser } from "@/api/auth";
import { useDocumentStore } from "@/stores/documentStore";
import { useDraftStore } from "@/stores/draftStore";
import { useTreeStore } from "@/stores/treeStore";
import { useUIStore, SIDEBAR_DEFAULT } from "@/stores/uiStore";
import FileTree from "@/components/FileTree";
import type { FileTreeHandle } from "@/components/FileTree";
import Editor from "@/components/Editor";
import CommandBar from "@/components/CommandBar";
import StatusBar from "@/components/StatusBar";
import LoginPage from "@/components/LoginPage";
import ContextMenu from "@/components/ContextMenu";
import { registerAction } from "@/lib/actions";
import { triggerDownload } from "@/lib/triggerDownload";
import { Save, RotateCcw, FilePlus, FolderPlus, Download } from "@/icons";
import styles from "@/App.module.css";

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 520;

function ContextMenuPortal() {
  const ctxMenu = useUIStore((s) => s.ctxMenu);
  if (!ctxMenu) return null;
  return <ContextMenu {...ctxMenu} />;
}

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const fileTreeRef = useRef<FileTreeHandle>(null);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u);
        if (u) {
          void useTreeStore.getState().reload();
          void useDraftStore.getState().initializeDraftPaths();
        }
      })
      .finally(() => setAuthChecked(true));
  }, []);

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
    const unregs = [
      registerAction({
        id: "core:save",
        label: "Save",
        keywords: ["save", "write"],
        icon: Save,
        contexts: ["editor"],
        handler: () => useDocumentStore.getState().saveFile(),
      }),
      registerAction({
        id: "core:discard",
        label: "Discard changes",
        keywords: ["discard", "revert", "reset"],
        icon: RotateCcw,
        contexts: ["editor"],
        handler: () => useDocumentStore.getState().discardChanges(),
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
          const p = useDocumentStore.getState().activePath;
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

  async function handleLogout() {
    await logout();
    setUser(null);
    useDocumentStore.getState().closeFile();
  }

  if (!authChecked) return null;
  if (!user) return (
    <LoginPage
      onLogin={(u) => {
        setUser(u);
        void useTreeStore.getState().reload();
        void useDraftStore.getState().initializeDraftPaths();
      }}
    />
  );

  return (
    <div className={styles.app}>
      <div className={styles.workspace}>
        <FileTree ref={fileTreeRef} width={sidebarWidth} />
        <div className={styles.sidebarResizer} onMouseDown={onResizerMouseDown} />
        <div className={styles.editorColumn}>
          <CommandBar user={user} onLogout={handleLogout} onUserUpdated={setUser} />
          <Editor />
        </div>
      </div>
      <StatusBar />
      <ContextMenuPortal />
    </div>
  );
}
