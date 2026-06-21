import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import App from "@/App.tsx";

async function init() {
  // In desktop (Tauri) mode, resolve the embedded server port before mounting
  // so that all API calls in the initial render already have the base URL.
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    window.__WRAZZ_API_PORT__ = await invoke<number>("get_api_port");
  }

  const root = document.getElementById("root")!;

  // The /connect path is a standalone popup page — mount it independently
  // so it doesn't pull in the full app shell or any store initialisation.
  if (window.location.pathname === "/connect") {
    const { default: ConnectPage } = await import("@/components/ConnectPage");
    createRoot(root).render(
      <StrictMode>
        <ConnectPage />
      </StrictMode>
    );
    return;
  }

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void init();
