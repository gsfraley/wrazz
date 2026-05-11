import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentUser } from "@/api/auth";
import { useDraftStore } from "@/stores/draftStore";
import { useTreeStore } from "@/stores/treeStore";
import { useUIStore } from "@/stores/uiStore";
import FileTree from "@/components/FileTree";
import Editor from "@/components/Editor";
import CommandBar from "@/components/CommandBar";
import StatusBar from "@/components/StatusBar";
import LoginPage from "@/components/LoginPage";
import ContextMenu from "@/components/ContextMenu";
import ConfirmModal from "@/components/modals/ConfirmModal";
import { registerPlugin } from "@/lib/pluginRegistry";
import { hooksForKeyboard } from "@/lib/pluginRegistry";
import { buildContext } from "@/lib/buildContext";
import { corePlugin } from "@/plugins/core";
import { accountPlugin } from "@/plugins/account";
import { fileTreePlugin } from "@/plugins/fileTree";
import styles from "@/App.module.css";

function ContextMenuPortal() {
  const ctxMenu = useUIStore((s) => s.ctxMenu);
  if (!ctxMenu) return null;
  return <ContextMenu {...ctxMenu} />;
}

function ConfirmPortal() {
  const { confirmRequest, closeConfirm } = useUIStore();
  if (!confirmRequest) return null;
  return (
    <ConfirmModal
      message={confirmRequest.message}
      confirmLabel="Confirm"
      onConfirm={() => closeConfirm(true)}
      onClose={() => closeConfirm(false)}
    />
  );
}

export default function App() {
  const { user, setUser, sidebarWidth, setSidebarWidth } = useUIStore();
  const [authChecked, setAuthChecked] = useState(false);
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

  useEffect(() => {
    const unregs = [
      registerPlugin(corePlugin),
      registerPlugin(accountPlugin),
      registerPlugin(fileTreePlugin),
    ];
    return () => unregs.forEach((f) => f());
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const ctx = buildContext();
      if (!ctx) return;
      const hooks = hooksForKeyboard(e);
      if (hooks.length > 0) {
        e.preventDefault();
        hooks.forEach((h) => { void h.run(ctx); });
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const onResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: sidebarWidth };
    function onMove(ev: MouseEvent) {
      if (!dragState.current) return;
      setSidebarWidth(dragState.current.startWidth + ev.clientX - dragState.current.startX);
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
  }, [sidebarWidth, setSidebarWidth]);

  if (!authChecked) return null;
  if (!user) {
    return (
      <LoginPage
        onLogin={(u) => {
          setUser(u);
          void useTreeStore.getState().reload();
          void useDraftStore.getState().initializeDraftPaths();
        }}
      />
    );
  }

  return (
    <div className={styles.app}>
      <div className={styles.workspace}>
        <FileTree width={sidebarWidth} />
        <div className={styles.sidebarResizer} onMouseDown={onResizerMouseDown} />
        <div className={styles.editorColumn}>
          <CommandBar />
          <Editor />
        </div>
      </div>
      <StatusBar />
      <ContextMenuPortal />
      <ConfirmPortal />
    </div>
  );
}
