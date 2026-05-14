import { useState, useEffect, useRef } from "react";
import Modal from "@/components/modals/Modal";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { apiFetch } from "@/lib/apiError";
import { HardDrive, Server, Plus, Trash2, Link } from "@/icons";
import type { WorkspaceSummary } from "@/api/workspaces";
import styles from "@/components/modals/DesktopSettingsModal.module.css";

export interface DesktopSettingsModalProps {
  onClose: () => void;
}

export default function DesktopSettingsModal({ onClose }: DesktopSettingsModalProps) {
  const { workspaces, load, deleteWorkspace } = useWorkspaceStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Clean up any dangling event listener when the modal unmounts.
  useEffect(() => () => { unlistenRef.current?.(); }, []);

  async function handleOpenLocal() {
    setError(null);
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path: string | null = await invoke("pick_folder");
      if (!path) return;
      const name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
      await apiFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "local", path, name }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open folder.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect() {
    const url = connectUrl.trim();
    if (!url) return;
    setError(null);
    setConnecting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

      // Listen for the workspace-connected event emitted by the desktop
      // server's /connect/callback handler once the loopback redirect lands.
      unlistenRef.current?.();
      unlistenRef.current = await listen("workspace-connected", async () => {
        unlistenRef.current?.();
        unlistenRef.current = null;
        await load();
        setConnecting(false);
        setConnectUrl("");
      });

      await invoke("begin_connect", { server_url: url, name: "Desktop" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start connection.");
      setConnecting(false);
    }
  }

  async function handleRemove(ws: WorkspaceSummary) {
    setError(null);
    try {
      await deleteWorkspace(ws.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove workspace.");
    }
  }

  const localWorkspaces = workspaces.filter((w) => !w.kind || w.kind === "local");
  const remoteWorkspaces = workspaces.filter((w) => w.kind === "remote");

  return (
    <Modal title="Workspaces" onClose={onClose} narrow>
      <div className={styles.body}>

        {/* ── Local workspaces ─────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <HardDrive size={13} />
            <span className={styles.sectionTitle}>Local</span>
            <button
              className={styles.addBtn}
              onClick={() => { void handleOpenLocal(); }}
              disabled={busy}
              title="Open a local folder as a workspace"
            >
              <Plus size={12} /> Open folder
            </button>
          </div>
          <WorkspaceList workspaces={localWorkspaces} onRemove={handleRemove} />
        </section>

        {/* ── Remote workspaces ────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Server size={13} />
            <span className={styles.sectionTitle}>Remote (wrazz Server)</span>
          </div>
          <WorkspaceList workspaces={remoteWorkspaces} onRemove={handleRemove} />
          <div className={styles.connectRow}>
            <input
              className={styles.connectInput}
              type="url"
              value={connectUrl}
              onChange={(e) => setConnectUrl(e.target.value)}
              placeholder="https://wrazz.example.com"
              disabled={connecting}
              onKeyDown={(e) => { if (e.key === "Enter") void handleConnect(); }}
            />
            <button
              className={styles.connectBtn}
              onClick={() => { void handleConnect(); }}
              disabled={connecting || !connectUrl.trim()}
              title="Authorize connection to a wrazz server"
            >
              <Link size={12} />
              {connecting ? "Connecting…" : "Connect"}
            </button>
          </div>
        </section>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}

function WorkspaceList({
  workspaces,
  onRemove,
}: {
  workspaces: WorkspaceSummary[];
  onRemove: (ws: WorkspaceSummary) => void;
}) {
  if (workspaces.length === 0) {
    return <p className={styles.empty}>None configured.</p>;
  }
  return (
    <ul className={styles.wsList}>
      {workspaces.map((ws) => (
        <li key={ws.id} className={styles.wsItem}>
          <div className={styles.wsInfo}>
            <span className={styles.wsName}>{ws.name}</span>
            {ws.path && <span className={styles.wsDetail}>{ws.path}</span>}
            {ws.server_url && <span className={styles.wsDetail}>{ws.server_url}</span>}
          </div>
          <button
            className={styles.removeBtn}
            onClick={() => onRemove(ws)}
            title="Remove workspace"
          >
            <Trash2 size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}
