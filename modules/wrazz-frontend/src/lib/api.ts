declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __WRAZZ_API_PORT__?: number;
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ != null;
}

/** Base URL prefix for API calls.
 *  - Browser/server mode: "" (relative URLs, same origin)
 *  - Desktop mode: "http://127.0.0.1:{port}" (embedded axum server)
 */
export function apiBase(): string {
  if (isDesktop() && window.__WRAZZ_API_PORT__ != null) {
    return `http://127.0.0.1:${window.__WRAZZ_API_PORT__}`;
  }
  return "";
}
