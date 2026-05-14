import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import App from "@/App.tsx";

async function init() {
  // In desktop (Tauri) mode, resolve the embedded server port before mounting
  // so that all API calls in the initial render already have the base URL.
  if (window.__TAURI__) {
    const { invoke } = await import("@tauri-apps/api/core");
    window.__WRAZZ_API_PORT__ = await invoke<number>("get_api_port");
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void init();
