import { useCallback, useEffect } from "react";
import { isDesktop } from "@/lib/api";

// Module-level singleton — shared across all components that call useWindowDrag()
// so we never install more than one set of document listeners.
let dragOrigin: { x: number; y: number } | null = null;
let dragActive = false;
let listenersInstalled = false;

async function onMouseMove(e: MouseEvent) {
  if (!dragOrigin || dragActive) return;
  if (Math.hypot(e.clientX - dragOrigin.x, e.clientY - dragOrigin.y) > 4) {
    dragActive = true;
    dragOrigin = null;
    window.getSelection()?.removeAllRanges();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    void getCurrentWindow().startDragging();
  }
}

function onMouseUp() {
  dragOrigin = null;
  dragActive = false;
}

function ensureListeners() {
  if (listenersInstalled) return;
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
  listenersInstalled = true;
}

/**
 * Returns an onMouseDown handler to attach to a drag-region container.
 * Any mousedown within 4px of movement starts window dragging via Tauri.
 * Components that should NOT initiate drag (window control buttons) should
 * call e.stopPropagation() on their own mousedown handlers.
 */
export function useWindowDrag() {
  useEffect(() => {
    if (isDesktop()) ensureListeners();
  }, []);

  return useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || !isDesktop()) return;
    dragOrigin = { x: e.clientX, y: e.clientY };
    dragActive = false;
  }, []);
}
