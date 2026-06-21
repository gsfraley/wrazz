import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentUser } from "@/api/auth";
import { isDesktop } from "@/lib/api";
import { useDraftStore } from "@/stores/draftStore";
import { useTreeStore } from "@/stores/treeStore";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import FileTree from "@/components/FileTree";
import Editor from "@/components/Editor";
import CommandBar from "@/components/CommandBar";
import StatusBar from "@/components/StatusBar";
import LoginPage from "@/components/LoginPage";
import ContextMenu from "@/components/ContextMenu";
import ConfirmModal from "@/components/modals/ConfirmModal";
import ConnectModal from "@/components/modals/ConnectModal";
import DesktopSettingsModal from "@/components/modals/DesktopSettingsModal";
import { registerPlugin } from "@/lib/pluginRegistry";
import { hooksForKeyboard } from "@/lib/pluginRegistry";
import { buildContext } from "@/lib/buildContext";
import { corePlugin } from "@/plugins/core";
import { accountPlugin } from "@/plugins/account";
import { fileTreePlugin } from "@/plugins/fileTree";
import type { DesktopPrefs } from "@/types";
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

function ConnectPortal() {
  const { activeModal, closeModal } = useUIStore();
  if (activeModal !== "connect") return null;
  return <ConnectModal onClose={closeModal} />;
}

function DesktopSettingsPortal() {
  const { activeModal, closeModal } = useUIStore();
  if (activeModal !== "desktop-settings") return null;
  return <DesktopSettingsModal onClose={closeModal} />;
}

export default function App() {
  const { user, setUser, sidebarWidth, setSidebarWidth } = useUIStore();
  const [authChecked, setAuthChecked] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (isDesktop()) {
      // Desktop mode: no server-side auth. Use a synthetic local user.
      setUser({ id: "__desktop__", display_name: "Desktop", is_admin: false, created_at: new Date().toISOString(), email: null });
      useWorkspaceStore.getState().load().then(() => {
        void useTreeStore.getState().reload();
        void useDraftStore.getState().initializeDraftPaths();
      });
      // Fetch detected desktop preferences (button side etc.).
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke<DesktopPrefs>("get_desktop_prefs")
          .then((prefs) => useUIStore.getState().setDesktopPrefs(prefs))
          .catch(() => {});
      });
      // Rounded corners: set immediately for non-maximized start, then track changes.
      document.documentElement.style.setProperty("--window-radius", "8px");
      setAuthChecked(true);
      return;
    }

    getCurrentUser()
      .then(async (u) => {
        setUser(u);
        if (u) {
          await useWorkspaceStore.getState().load();
          if (useWorkspaceStore.getState().workspaces.length === 0) {
            // First run with no workspaces — bootstrap a Default workspace.
            await useWorkspaceStore.getState().createWorkspace("Default");
            await useWorkspaceStore.getState().load();
          }
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

  // Track maximized state to toggle rounded corners.
  useEffect(() => {
    if (!isDesktop()) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const applyCorners = (max: boolean) => {
        document.documentElement.style.setProperty("--window-radius", max ? "0px" : "8px");
      };
      void win.isMaximized().then(applyCorners);
      void win.onResized(() => { void win.isMaximized().then(applyCorners); }).then((u) => { unlisten = u; });
    });
    return () => { unlisten?.(); };
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
  if (!user && !isDesktop()) {
    return (
      <LoginPage
        onLogin={async (u) => {
          setUser(u);
          await useWorkspaceStore.getState().load();
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
      <ConnectPortal />
      <DesktopSettingsPortal />
    </div>
  );
}
