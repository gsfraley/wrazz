import { useState, useRef, useEffect } from "react";
import Modal from "@/components/modals/Modal";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { Link } from "@/icons";
import styles from "@/components/modals/DesktopSettingsModal.module.css";

export interface ConnectModalProps {
  onClose: () => void;
}

export default function ConnectModal({ onClose }: ConnectModalProps) {
  const { load, setActive } = useWorkspaceStore();
  const [connectUrl, setConnectUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { unlistenRef.current?.(); }, []);

  async function handleConnect() {
    const url = connectUrl.trim();
    if (!url) return;
    setError(null);
    setConnecting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      unlistenRef.current?.();
      unlistenRef.current = await listen<string>("workspace-connected", async (event) => {
        unlistenRef.current?.();
        unlistenRef.current = null;
        await load();
        setActive(event.payload);
        setConnecting(false);
        onClose();
      });
      await invoke("begin_connect", { serverUrl: url, name: "Desktop" });
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to start connection.");
      setConnecting(false);
    }
  }

  return (
    <Modal title="Connect to Server" onClose={onClose} narrow>
      <div className={styles.body}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-muted)" }}>
          Enter the URL of your wrazz server. A browser window will open to authorize the connection.
        </p>
        <div className={styles.connectRow}>
          <input
            className={styles.connectInput}
            type="url"
            placeholder="https://wrazz.example.com"
            value={connectUrl}
            onChange={(e) => setConnectUrl(e.target.value)}
            disabled={connecting}
            onKeyDown={(e) => { if (e.key === "Enter") void handleConnect(); }}
            autoFocus
          />
          <button
            className={styles.connectBtn}
            onClick={() => void handleConnect()}
            disabled={connecting || !connectUrl.trim()}
          >
            <Link size={12} />
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}
