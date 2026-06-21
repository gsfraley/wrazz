import { useState } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUIStore } from "@/stores/uiStore";
import { isDesktop } from "@/lib/api";
import { apiFetch } from "@/lib/apiError";
import { FilePlus, FolderPlus, HardDrive, Link } from "@/icons";
import { buildTargetForPath } from "@/lib/buildContext";
import type { WorkspaceSummary } from "@/api/workspaces";
import type { RootEntry } from "@/lib/plugin";
import styles from "@/components/WelcomePage.module.css";

export default function WelcomePage() {
  const { activeWorkspaceId, load, setActive } = useWorkspaceStore();
  const { openModal } = useUIStore();
  const hasWorkspace = activeWorkspaceId !== null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpenLocalFolder() {
    setError(null);
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path: string | null = await invoke("pick_folder");
      if (!path) return;
      const name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
      const resp = await apiFetch("/api/v1/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "local", path, name }),
      });
      const ws = await resp.json() as WorkspaceSummary;
      await load();
      setActive(ws.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open folder.");
    } finally {
      setBusy(false);
    }
  }

  async function handleNewFile() {
    const target = buildTargetForPath("/");
    if (target.kind === "root") await (target as RootEntry).newFile();
  }

  async function handleNewDir() {
    const target = buildTargetForPath("/");
    if (target.kind === "root") await (target as RootEntry).newDir();
  }

  if (!hasWorkspace) {
    return (
      <div className={styles.welcome}>
        <div className={styles.inner}>
          <p className={styles.hint}>No workspace open</p>
          {isDesktop() ? (
            <div className={styles.actions}>
              <button className={styles.actionBtn} onClick={() => void handleOpenLocalFolder()} disabled={busy}>
                <HardDrive size={14} />
                Open local folder
              </button>
              <button className={styles.actionBtn} onClick={() => openModal("connect")}>
                <Link size={14} />
                Connect to server
              </button>
            </div>
          ) : (
            <div className={styles.actions}>
              <button
                className={styles.actionBtn}
                onClick={() => {
                  const name = window.prompt("Workspace name:");
                  if (!name?.trim()) return;
                  void useWorkspaceStore.getState().createWorkspace(name.trim()).then((ws) => {
                    setActive(ws.id);
                  });
                }}
              >
                Create workspace
              </button>
            </div>
          )}
          {error && <p className={styles.errorMsg}>{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.welcome}>
      <div className={styles.inner}>
        <div className={styles.fileActions}>
          <button className={styles.fileActionBtn} onClick={() => void handleNewFile()}>
            <FilePlus size={15} />
            New file
          </button>
          <button className={styles.fileActionBtn} onClick={() => void handleNewDir()}>
            <FolderPlus size={15} />
            New folder
          </button>
        </div>
      </div>
    </div>
  );
}
